import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { forceParsing, syntaxTreeAvailable } from "@codemirror/language";

const PARSE_OVERSHOOT = 2000;
const PARSE_BUDGET_MS = 50;
const IDLE_PARSE_BUDGET_MS = 50;
const IDLE_PARSE_TIMEOUT_MS = 2000;

function parseTarget(view: EditorView, pos: number): number {
  return Math.min(view.state.doc.length, pos + PARSE_OVERSHOOT);
}

/** The one place a parse target is derived from a position. */
export function parseThrough(view: EditorView, pos: number) {
  forceParsing(view, parseTarget(view, pos), PARSE_BUDGET_MS);
}

/** Parse through the current viewport (plus overshoot) synchronously, then
 *  finish the document in an idle slice. Called on mount and tab swap so
 *  tree-derived decorations don't render the first screen stale. */
export function advanceViewportParse(view: EditorView, isDisposed: () => boolean) {
  parseThrough(view, view.viewport.to);

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(
      () => {
        if (isDisposed()) return;
        forceParsing(view, view.state.doc.length, IDLE_PARSE_BUDGET_MS);
      },
      { timeout: IDLE_PARSE_TIMEOUT_MS },
    );
  }
}

// Keep the committed syntax tree caught up with the viewport during
// scrolling. The language plugin's background worker parses in
// requestIdleCallback slices, which starve while the user scrolls and are
// budget-capped on long documents — until it catches up, every tree-derived
// decoration field (list geometry, hidden markers, folds) renders the
// scrolled-into region as bare paragraphs (see the list hanging-indent bug).
// `forceParsing` dispatches when the tree advanced, which commits a fresh
// LanguageState and fires those fields' rebuild guards. `syntaxTreeAvailable`
// makes the caught-up steady state a no-op, and the parse-commit dispatch
// itself doesn't change the viewport, so this can't loop.
export const viewportParsePlugin = ViewPlugin.fromClass(
  class {
    private timeout = -1;

    update(update: ViewUpdate) {
      if (!update.viewportChanged || this.timeout >= 0) return;
      const view = update.view;
      if (syntaxTreeAvailable(view.state, parseTarget(view, view.viewport.to))) return;
      // Defer: dispatching (which forceParsing does) is illegal inside an
      // update cycle.
      this.timeout = window.setTimeout(() => {
        this.timeout = -1;
        if (!syntaxTreeAvailable(view.state, parseTarget(view, view.viewport.to))) {
          parseThrough(view, view.viewport.to);
        }
      }, 0);
    }

    destroy() {
      if (this.timeout >= 0) window.clearTimeout(this.timeout);
    }
  },
);
