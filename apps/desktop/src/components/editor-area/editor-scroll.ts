import type { EditorView } from "@codemirror/view";
import * as editorApi from "@/hooks/editor-api";
import { EDITOR_SAFE_SCROLL_MARGIN } from "./editor-scroll-container";
import { type FlashRange, flashMatchRanges } from "./match-flash";
import { parseThrough } from "./viewport-parse";

/** Where a jump goes and what it highlights once it is there. */
export interface JumpTarget {
  pos: number;
  /** Document ranges to flash on arrival; empty for a destination that is not
   *  a match, such as a heading anchor. */
  flash: readonly FlashRange[];
}

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
  scroller.scrollTo({ top: safeTopFor(view, scroller, pos), behavior });
}

function safeTopFor(view: EditorView, scroller: HTMLElement, pos: number): number {
  const block = view.lineBlockAt(Math.min(pos, view.state.doc.length));
  const screenY = view.documentTop + block.top;
  const scrollerRect = scroller.getBoundingClientRect();
  const delta = screenY - scrollerRect.top - EDITOR_SAFE_SCROLL_MARGIN;
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  return Math.max(0, Math.min(scroller.scrollTop + delta, max));
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

// Each correction moves the viewport, which can parse more and shift the
// heights again — so this is a bound, not a loop run to convergence.
const MAX_SCROLL_CORRECTIONS = 2;
// `scrollTop` is fractional on HiDPI and `scrollTo` rounds to the physical
// pixel, so exact equality is never reached. CodeMirror draws the same band.
const SCROLL_DEAD_BAND_PX = 1;

/** `scrollPosToSafeTop` with the same write-back, plus the parse, the flash and
 *  the drift correction a jump outside the rendered viewport needs. */
export function jumpToPos(
  view: EditorView,
  scroller: HTMLElement,
  filePath: string,
  target: JumpTarget,
) {
  const { pos } = target;
  // Heights in an unparsed region are estimates: aiming at them lands next to
  // the line once its decorations materialise.
  parseThrough(view, pos);
  scrollPosToSafeTop(view, scroller, pos, "auto");
  const landedAt = scroller.scrollTop;
  editorApi.updateScrollPos(filePath, landedAt);
  // Unconditional: this is also the only way a flash goes out early, so a jump
  // with nothing to light has to put out the one lit on the line it just left.
  // After the scroll, so the transaction cannot land between the parse and the
  // measurement it feeds; decoration marks change no heights, so the correction
  // below still measures what the jump aimed at.
  flashMatchRanges(view, target.flash);
  correctDrift(view, scroller, filePath, pos, landedAt);
}

/** Re-aim at `pos` once the measure loop has run, for the heights the forced
 *  parse could not settle inside its budget. */
function correctDrift(
  view: EditorView,
  scroller: HTMLElement,
  filePath: string,
  pos: number,
  landedFrom: number,
) {
  // `pos` and the offsets below only mean anything against the document the
  // jump measured. A tab swap or a watcher reload in between replaces it
  // without necessarily moving `scrollTop` (the browser only re-clamps when the
  // incoming document is shorter), and the reload path never re-applies a
  // target, so nothing downstream would undo a correction aimed at the old one.
  // `Text` is immutable, so reference identity is the exact test.
  const doc = view.state.doc;
  let landedAt = landedFrom;
  let remaining = MAX_SCROLL_CORRECTIONS;

  const schedule = () => {
    // CodeMirror re-anchors the ancestor scroller across height changes while
    // the editor has focus, and it does so after our requests have drained
    // without seeing our write — the two compensations would add up. Its other
    // trigger, a wheel/touch event under 100ms old, has no public accessor, so
    // an unfocused jump right after a wheel stays uncovered.
    if (view.hasFocus) return;
    view.requestMeasure({
      read: () =>
        view.state.doc === doc
          ? { at: scroller.scrollTop, wanted: safeTopFor(view, scroller, pos) }
          : null,
      write: (measured) => {
        if (measured === null || view.state.doc !== doc) return;
        // Anything else that moved the scroller — a user scroll, a later jump —
        // outranks this correction.
        if (measured.at !== landedAt) return;
        if (Math.abs(measured.wanted - measured.at) <= SCROLL_DEAD_BAND_PX) return;
        scroller.scrollTo({ top: measured.wanted, behavior: "auto" });
        landedAt = scroller.scrollTop;
        editorApi.updateScrollPos(filePath, landedAt);
        remaining -= 1;
        if (remaining > 0) schedule();
      },
    });
  };
  schedule();
}
