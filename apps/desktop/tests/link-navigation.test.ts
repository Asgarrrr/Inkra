import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("@/lib/theme", () => ({
  applyTheme: vi.fn(),
  applyCssVarBindings: vi.fn(),
}));

vi.mock("@/lib/paths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/paths")>()),
  resolveLinkTarget: vi.fn(),
}));

import { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  applyRegisteredViewTarget,
  followLink,
  navigateToTarget,
  targetDocPos,
} from "../src/components/editor-area/link-navigation";
import { useEditorNoticeStore } from "../src/components/editor-area/editor-notice-store";
import {
  registerEditorView,
  unregisterEditorView,
} from "../src/components/editor-area/editor-view-registry";
import { resolveLinkTarget } from "../src/lib/paths";
import {
  clearAllPendingTargets,
  consumePendingTarget,
  setPendingTarget,
} from "../src/lib/pending-target";
import { useEditorStore } from "../src/stores/editor-store";

const mockedInvoke = vi.mocked(invoke);
const mockedResolveLinkTarget = vi.mocked(resolveLinkTarget);

// `environment: "node"` has no layout, so `findOuterScroller` — which walks
// `parentElement` reading computed styles — can never succeed. A parentless dom
// is therefore the "view that cannot scroll" case, and everything upstream of
// the scroller lookup stays observable.
function unscrollableView(doc: string): EditorView {
  return {
    dom: { parentElement: null },
    state: { doc: Text.of(doc.split("\n")) },
  } as unknown as EditorView;
}

function readsReturning(contents: Record<string, string>) {
  mockedInvoke.mockImplementation((command, args) => {
    if (command !== "read_file") return Promise.resolve(undefined);
    const path = String((args as { path?: string } | undefined)?.path);
    const content = contents[path];
    if (content === undefined) return Promise.reject(new Error(`ENOENT: ${path}`));
    return Promise.resolve({ path, content, modified_at: 1 });
  });
}

let registered: [string, EditorView] | null = null;

function register(path: string, view: EditorView) {
  registerEditorView(path, view);
  registered = [path, view];
}

beforeEach(() => {
  vi.clearAllMocks();
  clearAllPendingTargets();
  useEditorStore.setState({
    tabs: [],
    activeTabId: null,
    activeFilePath: null,
    openFiles: new Map(),
  });
  useEditorNoticeStore.getState().dismissNotice();
});

// Unregistering in the test body leaks the view into the next test whenever an
// assertion throws first, and the next test then takes the wrong branch.
afterEach(() => {
  if (registered) unregisterEditorView(registered[0], registered[1]);
  registered = null;
});

describe("targetDocPos", () => {
  test("resolves a heading target to the heading's document position", () => {
    const doc = Text.of(["intro text", "", "## Details", "", "more"]);

    expect(targetDocPos(doc, { kind: "heading", slug: "details" })).toBe(12);
  });

  test("a heading the document doesn't contain resolves to nothing", () => {
    const doc = Text.of(["## Details"]);

    expect(targetDocPos(doc, { kind: "heading", slug: "missing" })).toBeNull();
  });

  test("a line target resolves to nothing until slice 5 converts it", () => {
    // Pins the placeholder: handing `line` back would put a line number where a
    // document offset is expected, which is what the conversion exists to avoid.
    const doc = Text.of(["one", "two", "three", "four"]);

    expect(targetDocPos(doc, { kind: "line", line: 3 })).toBeNull();
  });
});

describe("navigateToTarget", () => {
  test("hands the target to the editor that will swap to another file", async () => {
    readsReturning({ "/a.md": "a", "/b.md": "# Intro\n" });
    await useEditorStore.getState().openFile("/a.md");

    await navigateToTarget("/b.md", { kind: "heading", slug: "intro" });

    expect(useEditorStore.getState().activeFilePath).toBe("/b.md");
    expect(consumePendingTarget("/b.md")).toEqual({ kind: "heading", slug: "intro" });
  });

  test("a failed navigation leaves no target behind", async () => {
    readsReturning({ "/a.md": "a" });
    await useEditorStore.getState().openFile("/a.md");

    await navigateToTarget("/gone.md", { kind: "line", line: 12 });

    expect(useEditorStore.getState().activeFilePath).toBe("/a.md");
    expect(consumePendingTarget("/gone.md")).toBeUndefined();
  });

  test("the file on screen reports a heading it doesn't contain instead of carrying it", async () => {
    readsReturning({ "/a.md": "# Intro\n" });
    await useEditorStore.getState().openFile("/a.md");
    register("/a.md", unscrollableView("# Intro\n"));

    await navigateToTarget("/a.md", { kind: "heading", slug: "missing" });

    expect(useEditorNoticeStore.getState().message).toBe(
      'Heading "#missing" not found in this document',
    );
    expect(consumePendingTarget("/a.md")).toBeUndefined();
  });

  test("a view that cannot scroll hands the target back to the carrier", async () => {
    readsReturning({ "/a.md": "# Intro\n" });
    await useEditorStore.getState().openFile("/a.md");
    register("/a.md", unscrollableView("# Intro\n"));

    await navigateToTarget("/a.md", { kind: "heading", slug: "intro" });

    expect(consumePendingTarget("/a.md")).toEqual({ kind: "heading", slug: "intro" });
  });

  test("the file on screen but not yet mounted gets the target for its first mount", async () => {
    readsReturning({ "/a.md": "# Intro\n" });
    await useEditorStore.getState().openFile("/a.md");

    await navigateToTarget("/a.md", { kind: "line", line: 3 });

    expect(consumePendingTarget("/a.md")).toEqual({ kind: "line", line: 3 });
  });
});

describe("applyRegisteredViewTarget", () => {
  test("consumes a target left for the path while the view was still unregistered", () => {
    setPendingTarget("/a.md", { kind: "heading", slug: "missing" });

    applyRegisteredViewTarget("/a.md", unscrollableView("# Intro\n"));

    expect(useEditorNoticeStore.getState().message).toBe(
      'Heading "#missing" not found in this document',
    );
    expect(consumePendingTarget("/a.md")).toBeUndefined();
  });

  test("leaves the target on the carrier when the view cannot scroll", () => {
    setPendingTarget("/a.md", { kind: "heading", slug: "intro" });

    applyRegisteredViewTarget("/a.md", unscrollableView("# Intro\n"));

    expect(consumePendingTarget("/a.md")).toEqual({ kind: "heading", slug: "intro" });
  });

  test("a path with no target is untouched", () => {
    applyRegisteredViewTarget("/a.md", unscrollableView("# Intro\n"));

    expect(useEditorNoticeStore.getState().message).toBeNull();
  });
});

describe("followLink", () => {
  test("carries the anchor of a cross-file internal link", async () => {
    readsReturning({ "/a.md": "a", "/b.md": "# Intro\n" });
    await useEditorStore.getState().openFile("/a.md");
    mockedResolveLinkTarget.mockResolvedValue({
      kind: "internal",
      path: "/b.md",
      anchor: "intro",
    });

    await followLink("b.md#intro", "/a.md");

    expect(useEditorStore.getState().activeFilePath).toBe("/b.md");
    expect(consumePendingTarget("/b.md")).toEqual({ kind: "heading", slug: "intro" });
  });

  test("an internal link without an anchor just opens the file", async () => {
    readsReturning({ "/a.md": "a", "/b.md": "# Intro\n" });
    await useEditorStore.getState().openFile("/a.md");
    mockedResolveLinkTarget.mockResolvedValue({ kind: "internal", path: "/b.md" });

    await followLink("b.md", "/a.md");

    expect(useEditorStore.getState().activeFilePath).toBe("/b.md");
    expect(consumePendingTarget("/b.md")).toBeUndefined();
  });

  test("a same-document anchor goes to the live view, never onto the carrier", async () => {
    // Routing this through `setPendingTarget` sets a target on the file that is
    // already active: no editor swaps, so nothing consumes it and it fires on
    // an unrelated later navigation.
    readsReturning({ "/a.md": "# Intro\n" });
    await useEditorStore.getState().openFile("/a.md");
    register("/a.md", unscrollableView("# Intro\n"));
    mockedResolveLinkTarget.mockResolvedValue({ kind: "same-doc-anchor", anchor: "missing" });

    await followLink("#missing", "/a.md");

    expect(useEditorNoticeStore.getState().message).toBe(
      'Heading "#missing" not found in this document',
    );
    expect(consumePendingTarget("/a.md")).toBeUndefined();
  });

  test("an external url hands off to the OS without touching the carrier", async () => {
    mockedResolveLinkTarget.mockResolvedValue({
      kind: "external-url",
      url: "https://example.com",
    });

    await followLink("https://example.com", "/a.md");

    expect(vi.mocked(openUrl)).toHaveBeenCalledWith("https://example.com");
    expect(consumePendingTarget("/a.md")).toBeUndefined();
  });
});
