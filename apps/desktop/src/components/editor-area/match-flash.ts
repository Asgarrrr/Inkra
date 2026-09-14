import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";

/** Document offsets, not the codepoint ranges the scan emits. */
export interface FlashRange {
  from: number;
  to: number;
}

export const MATCH_FLASH_MS = 1200;

const setMatchFlash = StateEffect.define<{ ranges: readonly FlashRange[]; serial: number }>();

// Marks that compare equal let CodeMirror reuse the rendered span from its DOM
// cache, and a CSS animation belongs to the element, not to the decoration — so
// without a serial that differs every time, re-flashing a range already lit
// inherits the previous fade's elapsed time. The duration rides on the span for
// the same reason a second literal in the stylesheet would drift from this one.
function flashMark(serial: number) {
  return Decoration.mark({
    class: "cm-match-flash",
    attributes: {
      style: `--match-flash-duration: ${MATCH_FLASH_MS.toString()}ms`,
      "data-match-flash": serial.toString(),
    },
  });
}

export const matchFlashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(flash, tr) {
    // A tab swap or a watcher reload — both stamped "writer" — brings in text
    // the ranges were never measured against. Today's swap replaces the whole
    // document, so mapping would drop them anyway; keying on the user event is
    // what keeps that true of a swap that reuses part of the text.
    if (tr.isUserEvent("writer")) return Decoration.none;

    let next = flash.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setMatchFlash)) continue;
      const mark = flashMark(effect.value.serial);
      // The scan lists ranges by rank, which is not document order.
      next = Decoration.set(
        effect.value.ranges.map((range) => mark.range(range.from, range.to)),
        true,
      );
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// Per view: a shared timer would let one pane's flash cancel another pane's
// expiry and leave it lit until that pane's next edit.
const expiries = new WeakMap<EditorView, ReturnType<typeof setTimeout>>();

// Not in the field's `update`, which stays a pure function of its transaction.
let flashSerial = 0;

/** Flash `ranges` in `view`, replacing whatever it was showing. An empty
 *  `ranges` is how a flash goes out early. Needs no destroyed-view guard:
 *  `update` on a destroyed view stores the state and returns. */
export function flashMatchRanges(view: EditorView, ranges: readonly FlashRange[]): void {
  const pending = expiries.get(view);
  if (pending !== undefined) clearTimeout(pending);

  view.dispatch({ effects: setMatchFlash.of({ ranges, serial: ++flashSerial }) });

  if (ranges.length === 0) return;
  expiries.set(
    view,
    setTimeout(() => {
      view.dispatch({ effects: setMatchFlash.of({ ranges: [], serial: ++flashSerial }) });
    }, MATCH_FLASH_MS),
  );
}
