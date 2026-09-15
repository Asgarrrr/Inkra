import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
  resolveTarget,
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
  type PendingTarget,
  setPendingTarget,
} from "../src/lib/pending-target";
import { createSettingsTab, useEditorStore } from "../src/stores/editor-store";

const mockedInvoke = vi.mocked(invoke);
const mockedResolveLinkTarget = vi.mocked(resolveLinkTarget);

vi.stubGlobal("getComputedStyle", (node: { overflowY?: string }) => ({
  overflowY: node.overflowY ?? "visible",
}));

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

const LINE_BLOCK_HEIGHT = 100;

/** The scrollable counterpart: `findOuterScroller` walks `parentElement`
 *  reading computed styles, so a view that can scroll needs both stubbed. Line
 *  blocks sit at `pos * LINE_BLOCK_HEIGHT`, which makes the landing offset name
 *  the document position the jump was aimed at. `state.field` and `dispatch`
 *  exist only so the forced parse doesn't throw on the way through: with no
 *  language field there is nothing to parse, and what it parses is pinned in
 *  `viewport-parse.test.ts`. */
function scrollableView(doc: string) {
  const scroller = {
    overflowY: "auto",
    parentElement: null,
    scrollTop: 0,
    scrollHeight: 100_000,
    clientHeight: 800,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo: ({ top }: ScrollToOptions) => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      scroller.scrollTop = Math.max(0, Math.min(top ?? 0, max));
    },
  };
  const view = {
    dom: { parentElement: scroller },
    hasFocus: false,
    get documentTop() {
      return -scroller.scrollTop;
    },
    state: { doc: Text.of(doc.split("\n")), field: () => undefined },
    dispatch: () => {},
    lineBlockAt: (pos: number) => ({ top: pos * LINE_BLOCK_HEIGHT }),
    requestMeasure: () => {},
  };
  return { view: view as unknown as EditorView, scroller };
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

function withSettingsTabActive() {
  useEditorStore.setState({
    tabs: [createSettingsTab("settings-tab")],
    activeTabId: "settings-tab",
    activeFilePath: null,
    openFiles: new Map(),
  });
}

function tabKinds() {
  return useEditorStore.getState().tabs.map((tab) => tab.location.kind);
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

/** A line target, spelled once: only the ranges vary across these cases. */
function line(number: number, matchRanges: [number, number][] = []): PendingTarget {
  return { kind: "line", line: number, matchRanges };
}

describe("resolveTarget", () => {
  test("resolves a heading target to the heading's document position", () => {
    const doc = Text.of(["intro text", "", "## Details", "", "more"]);

    expect(resolveTarget(doc, { kind: "heading", slug: "details" })).toEqual({
      pos: 12,
      flash: [],
    });
  });

  test("a heading the document doesn't contain resolves to nothing", () => {
    const doc = Text.of(["## Details"]);

    expect(resolveTarget(doc, { kind: "heading", slug: "missing" })).toBeNull();
  });

  test("resolves a line target to the start of that line", () => {
    const doc = Text.of(["one", "two", "three", "four"]);

    expect(resolveTarget(doc, line(3))).toEqual({ pos: 8, flash: [] });
  });

  test("a line past the end of a document that shrank lands on its last line", () => {
    const doc = Text.of(["one", "two", "three", "four"]);

    expect(resolveTarget(doc, line(99))?.pos).toBe(14);
  });

  test("a line at or below zero lands on the first line", () => {
    const doc = Text.of(["one", "two", "three"]);

    expect(resolveTarget(doc, line(0))?.pos).toBe(0);
    expect(resolveTarget(doc, line(-3))?.pos).toBe(0);
  });

  test("a single-line document answers its one line for any number", () => {
    const doc = Text.of(["only"]);

    expect(resolveTarget(doc, line(7))?.pos).toBe(0);
  });

  test("match ranges become document ranges on the line they belong to", () => {
    const doc = Text.of(["one", "needle here", "three"]);

    // The line starts at 4; "needle" is codepoints 0..6 of it, "here" 7..11.
    expect(
      resolveTarget(
        doc,
        line(2, [
          [0, 6],
          [7, 11],
        ]),
      )?.flash,
    ).toEqual([
      { from: 4, to: 10 },
      { from: 11, to: 15 },
    ]);
  });

  test("counts the codepoints the scan counted, not UTF-16 units", () => {
    // "é" is one codepoint and one UTF-16 unit, the emoji is one codepoint and
    // two: taking the offsets as indices puts the highlight two characters off.
    const accented = Text.of(["Café déjà vu"]);
    const emoji = Text.of(["Un émoji 🎉 avant throughput"]);

    expect(resolveTarget(accented, line(1, [[5, 9]]))?.flash).toEqual([{ from: 5, to: 9 }]);
    expect(accented.sliceString(5, 9)).toBe("déjà");
    expect(resolveTarget(emoji, line(1, [[17, 27]]))?.flash).toEqual([{ from: 18, to: 28 }]);
    expect(emoji.sliceString(18, 28)).toBe("throughput");
  });

  test("ranges the line no longer reaches are dropped, not clamped onto its end", () => {
    // The file changed between the scan and the click, and the line is shorter
    // than the one that matched.
    const doc = Text.of(["one", "short", "three"]);

    expect(
      resolveTarget(
        doc,
        line(2, [
          [0, 5],
          [40, 46],
        ]),
      )?.flash,
    ).toEqual([{ from: 4, to: 9 }]);
  });

  test("ranges listed out of document order all survive", () => {
    // The scan ranks its ranges, so the later match on a line can come first.
    // Resolving them against an unsorted cursor pins every offset behind the
    // cursor to the end of the line, and those ranges collapse to nothing.
    const doc = Text.of(["needle here"]);

    expect(
      resolveTarget(
        doc,
        line(1, [
          [7, 11],
          [0, 6],
        ]),
      )?.flash,
    ).toEqual([
      { from: 7, to: 11 },
      { from: 0, to: 6 },
    ]);
  });

  test("a range that outruns the end of the line stops there", () => {
    const doc = Text.of(["one", "short", "three"]);

    expect(resolveTarget(doc, line(2, [[2, 46]]))?.flash).toEqual([{ from: 6, to: 9 }]);
  });

  test("empty and inverted ranges never reach the editor", () => {
    // `Decoration.mark` rejects an empty range, and an inverted one would paint
    // backwards over text that never matched.
    const doc = Text.of(["needle here"]);

    expect(
      resolveTarget(
        doc,
        line(1, [
          [3, 3],
          [8, 2],
        ]),
      )?.flash,
    ).toEqual([]);
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

    await navigateToTarget("/gone.md", { kind: "line", line: 12, matchRanges: [] });

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

  test("a line target in the file on screen scrolls its live view", async () => {
    readsReturning({ "/a.md": "one\ntwo\nthree\nfour\n" });
    await useEditorStore.getState().openFile("/a.md");
    const { view, scroller } = scrollableView("one\ntwo\nthree\nfour\n");
    register("/a.md", view);

    await navigateToTarget("/a.md", { kind: "line", line: 3, matchRanges: [] });
    const atLine3 = scroller.scrollTop;
    await navigateToTarget("/a.md", { kind: "line", line: 4, matchRanges: [] });

    expect(atLine3).toBeGreaterThan(0);
    // Lines 3 and 4 start at document positions 8 and 14; the safe-zone margin
    // is common to both, so their distance is the block height times six.
    expect(scroller.scrollTop - atLine3).toBe(6 * LINE_BLOCK_HEIGHT);
    expect(consumePendingTarget("/a.md")).toBeUndefined();
  });

  test("opens a file the way the palette's file rows open one", async () => {
    // Both kinds of row sit in the same list. `navigateToFile` would replace the
    // Settings tab in place where `openFile` opens beside it, so a content row
    // and a file row would answer the same click differently.
    readsReturning({ "/a.md": "one\ntwo\nthree\n" });

    withSettingsTabActive();
    await useEditorStore.getState().openFile("/a.md");
    const viaFileRow = tabKinds();

    withSettingsTabActive();
    await navigateToTarget("/a.md", { kind: "line", line: 2, matchRanges: [] });

    expect(viaFileRow).toEqual(["settings", "file"]);
    expect(tabKinds()).toEqual(viaFileRow);
    expect(consumePendingTarget("/a.md")).toEqual({ kind: "line", line: 2, matchRanges: [] });
  });

  test("the file on screen but not yet mounted gets the target for its first mount", async () => {
    readsReturning({ "/a.md": "# Intro\n" });
    await useEditorStore.getState().openFile("/a.md");

    await navigateToTarget("/a.md", { kind: "line", line: 3, matchRanges: [] });

    expect(consumePendingTarget("/a.md")).toEqual({ kind: "line", line: 3, matchRanges: [] });
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
