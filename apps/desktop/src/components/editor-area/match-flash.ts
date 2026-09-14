import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";

/** A document range to flash, in the coordinates CodeMirror indexes by. */
export interface FlashRange {
  from: number;
  to: number;
}

/** How long a flash stays on screen. A fade that ran its course is transparent
 *  by the time the mark is removed — but only then: `prefers-reduced-motion`
 *  holds the colour flat on purpose. Re-rendering the line does not restart the
 *  fade; only a mark CodeMirror considers new does, which is `flashMark`'s job. */
export const MATCH_FLASH_MS = 1200;

const setMatchFlash = StateEffect.define<{ ranges: readonly FlashRange[]; serial: number }>();

// The duration rides on the span rather than being written again in the
// stylesheet: the fade has to end when the decoration is removed, and two
// literals drift.
//
// `data-match-flash` has no reader but CodeMirror's own decoration equality.
// Marks that compare equal let it reuse the rendered span out of its DOM cache,
// and a CSS animation belongs to the element, not to the decoration — so a
// second jump to a range already flashing inherited the first flash's elapsed
// time and went dark while its fresh expiry timer still held the span. A serial
// that differs every flash makes the marks unequal, so the span is rebuilt and
// the animation starts over.
function flashMark(serial: number) {
  return Decoration.mark({
    class: "cm-match-flash",
    attributes: {
      style: `--match-flash-duration: ${MATCH_FLASH_MS.toString()}ms`,
      "data-match-flash": serial.toString(),
    },
  });
}

/** The ranges currently flashing. Also the extension that paints them. */
export const matchFlashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(flash, tr) {
    // A tab swap or a watcher reload — both stamped "writer" — brings in text
    // the ranges were never measured against. Today's swap replaces the whole
    // document, so mapping would drop them anyway; keying on the user event is
    // what keeps that true of a swap that reuses part of the text.
    if (tr.isUserEvent("writer")) return Decoration.none;

    // The ranges follow the text the user edits; ranges whose text is deleted
    // collapse and CodeMirror drops them.
    let next = flash.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setMatchFlash)) continue;
      const mark = flashMark(effect.value.serial);
      // Sorted here: the ranges keep the order the scan listed them in, which
      // is not document order when a later match on the line is ranked first.
      next = Decoration.set(
        effect.value.ranges.map((range) => mark.range(range.from, range.to)),
        true,
      );
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// Per view, so a flash in one pane cannot cancel the timer that would clear
// another pane's — which would leave that one lit until its next edit or swap.
const expiries = new WeakMap<EditorView, ReturnType<typeof setTimeout>>();

// Bumped here rather than in the field's `update`, which has to stay a pure
// function of the transaction it is handed.
let flashSerial = 0;

/** Flash `ranges` in `view`, replacing whatever it was showing; an empty
 *  `ranges` is how a flash goes out early. Bare timer globals, not `window.*`:
 *  this runs under the test runner's node environment. Dispatching into a
 *  destroyed view is a no-op — `update` stores the state and returns — so an
 *  expiry that outlives its pane needs no guard. */
export function flashMatchRanges(view: EditorView, ranges: readonly FlashRange[]): void {
  const pending = expiries.get(view);
  if (pending !== undefined) clearTimeout(pending);

  view.dispatch({ effects: setMatchFlash.of({ ranges, serial: ++flashSerial }) });

  // Nothing lit, nothing to put out. A swap or a reload empties the field
  // behind the timer's back; that timer still fires and dispatches an effect
  // against an already-empty field — one spare transaction, cheaper than
  // wiring the field's update path back to the timer.
  if (ranges.length === 0) return;
  expiries.set(
    view,
    setTimeout(() => {
      view.dispatch({ effects: setMatchFlash.of({ ranges: [], serial: ++flashSerial }) });
    }, MATCH_FLASH_MS),
  );
}
