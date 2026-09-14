import type { EditorView } from "@codemirror/view";
import * as editorApi from "@/hooks/editor-api";
import { EDITOR_SAFE_SCROLL_MARGIN } from "./editor-scroll-container";

/** The nearest ancestor of `root` that actually scrolls. Writer's `.cm-scroller`
 *  is `overflow: visible`; the real scroller is `EditorScrollContainer`. */
export function findOuterScroller(root: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = root.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

/** Scroll `scroller` so the line block at `pos` lands at the top of the safe
 *  zone (below the fade mask). Uses the layout model, not `coordsAtPos`, so it
 *  works for positions outside the rendered viewport (see docs/editor.md). */
export function scrollPosToSafeTop(
  view: EditorView,
  scroller: HTMLElement,
  pos: number,
  behavior: ScrollBehavior,
) {
  const block = view.lineBlockAt(Math.min(pos, view.state.doc.length));
  const screenY = view.documentTop + block.top;
  const scrollerRect = scroller.getBoundingClientRect();
  const delta = screenY - scrollerRect.top - EDITOR_SAFE_SCROLL_MARGIN;
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const next = Math.max(0, Math.min(scroller.scrollTop + delta, max));
  scroller.scrollTo({ top: next, behavior });
}

// A programmatic jump must record where it landed, because the scroll listener
// gets there first and persists whatever it saw: a position clamped against
// the outgoing document on a swap, or an intermediate frame. Reading `scrollTop`
// back covers clamping and sub-pixel rounding, and `updateScrollPos` bails on an
// equal value, so the jump's own scroll event is then a no-op.

/** Scroll `scroller` to `top` and record where it landed for `filePath`. */
export function jumpScrollTop(scroller: HTMLElement, filePath: string, top: number) {
  scroller.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  editorApi.updateScrollPos(filePath, scroller.scrollTop);
}

/** `scrollPosToSafeTop` with the same write-back. */
export function jumpToPos(view: EditorView, scroller: HTMLElement, filePath: string, pos: number) {
  scrollPosToSafeTop(view, scroller, pos, "auto");
  editorApi.updateScrollPos(filePath, scroller.scrollTop);
}
