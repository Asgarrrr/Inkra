import { describe, expect, test, vi } from "bun:test";
import { actualTauriCore } from "./helpers/actual-tauri-core";
import { stubGlobal } from "./helpers/vi-compat";

vi.mock("@tauri-apps/api/core", () => ({
  ...actualTauriCore,
  invoke: vi.fn(),
}));

vi.mock("@/lib/theme", () => ({
  applyTheme: vi.fn(),
  applyCssVarBindings: vi.fn(),
}));

import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, type DecorationSet } from "@codemirror/view";
import { createEditorExtensions } from "../src/components/editor-area/editor-extensions";
import { flashMatchRanges } from "../src/components/editor-area/match-flash";

// `environment: "node"` has no DOM, and building the list reads `document.body`
// to place the wiki-link tooltips. Nothing here mounts a view, so a stand-in
// the facet can hold is enough.
stubGlobal("document", { body: {} });

/** The extension list the app actually mounts. A field left out of it makes
 *  every effect dispatched at it a silent no-op, which no test of the field's
 *  own state can see. */
function productionState(doc: string) {
  let state = EditorState.create({
    doc,
    extensions: createEditorExtensions(
      () => "/a.md",
      () => false,
      new Compartment(),
    ),
  });
  const view = {
    get state() {
      return state;
    },
    dispatch: (spec: Parameters<EditorView["dispatch"]>[0]) => {
      state = state.update(spec as Parameters<EditorState["update"]>[0]).state;
    },
    // A view-plugin's decorations are read off its instance, and no plugin is
    // instantiated without a mounted view; those sources answer `Decoration.none`.
    plugin: () => null,
  };
  return view as unknown as EditorView;
}

/** What the view would paint: every set the `EditorView.decorations` facet
 *  holds, including the ones contributed as a function of the view. */
function paintedMarks(view: EditorView, className: string) {
  const painted: [number, number][] = [];
  for (const source of view.state.facet(EditorView.decorations)) {
    const set: DecorationSet = typeof source === "function" ? source(view) : source;
    const cursor = set.iter();
    while (cursor.value !== null) {
      if (cursor.value.spec.class === className) painted.push([cursor.from, cursor.to]);
      cursor.next();
    }
  }
  return painted;
}

describe("createEditorExtensions", () => {
  test("paints the match flash through the decorations facet", () => {
    const view = productionState("alpha beta gamma");

    flashMatchRanges(view, [
      { from: 0, to: 5 },
      { from: 11, to: 16 },
    ]);

    expect(paintedMarks(view, "cm-match-flash")).toEqual([
      [0, 5],
      [11, 16],
    ]);
  });
});
