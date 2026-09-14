import { describe, expect, test } from "vite-plus/test";
import type { EditorView } from "@codemirror/view";
import {
  getEditorView,
  registerEditorView,
  unregisterEditorView,
} from "../src/components/editor-area/editor-view-registry";

// The registry only stores and hands back the view; nothing here touches
// CodeMirror, so a tagged stand-in is enough under `environment: "node"`.
function fakeView(name: string): EditorView {
  return { name } as unknown as EditorView;
}

describe("editor-view-registry", () => {
  test("hands back the view registered for a path", () => {
    const view = fakeView("a");
    registerEditorView("/a.md", view);

    expect(getEditorView("/a.md")).toBe(view);
  });

  test("a path with no registration has no view", () => {
    expect(getEditorView("/unregistered.md")).toBeUndefined();
  });

  test("is keyed by path: one path's view is not handed back for another", () => {
    const a = fakeView("a");
    const b = fakeView("b");
    registerEditorView("/keyed-a.md", a);
    registerEditorView("/keyed-b.md", b);

    expect(getEditorView("/keyed-a.md")).toBe(a);
    expect(getEditorView("/keyed-b.md")).toBe(b);
  });

  test("unregistering drops the view", () => {
    const view = fakeView("gone");
    registerEditorView("/gone.md", view);

    unregisterEditorView("/gone.md", view);

    expect(getEditorView("/gone.md")).toBeUndefined();
  });

  test("unregistering one path leaves another intact", () => {
    const a = fakeView("a");
    const b = fakeView("b");
    registerEditorView("/left-a.md", a);
    registerEditorView("/left-b.md", b);

    unregisterEditorView("/left-a.md", a);

    expect(getEditorView("/left-a.md")).toBeUndefined();
    expect(getEditorView("/left-b.md")).toBe(b);
  });

  test("re-registering a path replaces its view", () => {
    const first = fakeView("first");
    const second = fakeView("second");
    registerEditorView("/replaced.md", first);

    registerEditorView("/replaced.md", second);

    expect(getEditorView("/replaced.md")).toBe(second);
  });

  test("a stale view unregistering does not drop the current one", () => {
    const first = fakeView("first");
    const second = fakeView("second");
    registerEditorView("/two-tabs.md", first);
    registerEditorView("/two-tabs.md", second);

    unregisterEditorView("/two-tabs.md", first);

    expect(getEditorView("/two-tabs.md")).toBe(second);
  });
});
