import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/lib/theme", () => ({
  applyTheme: vi.fn(),
  applyCssVarBindings: vi.fn(),
}));

// The jump's forced parse dispatches an empty transaction when the state has no
// language field, which is noise here; what it parses is pinned elsewhere.
vi.mock("../src/components/editor-area/viewport-parse", () => ({
  parseThrough: vi.fn(),
}));

import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { jumpToPos } from "../src/components/editor-area/editor-scroll";
import {
  MATCH_FLASH_MS,
  flashMatchRanges,
  matchFlashField,
} from "../src/components/editor-area/match-flash";

const PATH = "/a.md";

/** A real `EditorState` carrying the field, driven through a `dispatch` that
 *  applies transactions — `EditorView` itself needs a DOM. The layout members
 *  are what `jumpToPos` reads: line blocks sit at `pos * 100`, far enough down
 *  that the landing offset clears the safe-zone margin. */
function fakeView(doc: string) {
  let state = EditorState.create({ doc, extensions: [matchFlashField] });
  const scroller = {
    scrollTop: 0,
    scrollHeight: 100_000,
    clientHeight: 800,
    getBoundingClientRect: () => ({ top: 0 }),
    // The browser clamps to the scrollable range, not to `scrollHeight`.
    scrollTo: ({ top }: ScrollToOptions) => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      scroller.scrollTop = Math.max(0, Math.min(top ?? 0, max));
    },
  };
  const dispatched: { scrollTopWas: number }[] = [];
  const view = {
    hasFocus: false,
    get state() {
      return state;
    },
    get documentTop() {
      return -scroller.scrollTop;
    },
    dispatch: (spec: TransactionSpec) => {
      dispatched.push({ scrollTopWas: scroller.scrollTop });
      state = state.update(spec).state;
    },
    lineBlockAt: (pos: number) => ({ top: pos * 100 }),
    requestMeasure: () => {},
  };
  return {
    view: view as unknown as EditorView,
    scroller: scroller as unknown as HTMLElement,
    dispatched,
  };
}

/** The document ranges currently lit, and the class they are lit with. */
function flashing(view: EditorView): [number, number][] {
  const ranges: [number, number][] = [];
  const cursor = view.state.field(matchFlashField).iter();
  while (cursor.value !== null) {
    expect(cursor.value.spec.class).toBe("cm-match-flash");
    ranges.push([cursor.from, cursor.to]);
    cursor.next();
  }
  return ranges;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("flashMatchRanges", () => {
  test("lights the ranges it is given", () => {
    const { view } = fakeView("alpha beta gamma");

    flashMatchRanges(view, [
      { from: 0, to: 5 },
      { from: 11, to: 16 },
    ]);

    expect(flashing(view)).toEqual([
      [0, 5],
      [11, 16],
    ]);
  });

  test("takes the ranges in whatever order the scan listed them", () => {
    // `Decoration.set` throws on unsorted input unless it is told to sort, and
    // the ranges arrive ranked by the scan, not by document position.
    const { view } = fakeView("alpha beta gamma");

    flashMatchRanges(view, [
      { from: 11, to: 16 },
      { from: 0, to: 5 },
    ]);

    expect(flashing(view)).toEqual([
      [0, 5],
      [11, 16],
    ]);
  });

  test("carries the life of the flash into the stylesheet", () => {
    // The fade has to end exactly when the decoration is removed; a duration
    // written in the CSS too would be a second source for the same value.
    const { view } = fakeView("alpha beta");

    flashMatchRanges(view, [{ from: 0, to: 5 }]);

    const cursor = view.state.field(matchFlashField).iter();
    expect(cursor.value?.spec.attributes.style).toBe(
      `--match-flash-duration: ${MATCH_FLASH_MS.toString()}ms`,
    );
  });

  test("re-lighting a range it is already showing hands out a different mark", () => {
    // Marks that compare equal let CodeMirror reuse the span it already
    // rendered, and the CSS animation belongs to that element: the second flash
    // would resume the first one's fade instead of starting over. Observed in
    // the browser before this — a re-jump landed on a span 960 ms into its
    // 1200 ms fade. `eq` is the exact predicate CodeMirror's DOM cache uses.
    const { view } = fakeView("alpha beta");

    flashMatchRanges(view, [{ from: 0, to: 5 }]);
    const first = view.state.field(matchFlashField).iter().value;
    flashMatchRanges(view, [{ from: 0, to: 5 }]);
    const second = view.state.field(matchFlashField).iter().value;

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.eq(first!)).toBe(false);
  });

  test("goes out on its own", () => {
    const { view } = fakeView("alpha beta");

    flashMatchRanges(view, [{ from: 0, to: 5 }]);
    vi.advanceTimersByTime(MATCH_FLASH_MS - 1);
    const beforeExpiry = flashing(view);
    vi.advanceTimersByTime(1);

    expect(beforeExpiry).toEqual([[0, 5]]);
    expect(flashing(view)).toEqual([]);
  });

  test("a second jump replaces the first flash and keeps its own full life", () => {
    // The first flash's timer must not put the second one out: two content rows
    // opened in quick succession are the ordinary case.
    const { view } = fakeView("alpha beta gamma");

    flashMatchRanges(view, [{ from: 0, to: 5 }]);
    vi.advanceTimersByTime(MATCH_FLASH_MS - 10);
    flashMatchRanges(view, [{ from: 6, to: 10 }]);
    const afterSecond = flashing(view);
    vi.advanceTimersByTime(11);
    const atFirstExpiry = flashing(view);
    vi.advanceTimersByTime(MATCH_FLASH_MS);

    expect(afterSecond).toEqual([[6, 10]]);
    expect(atFirstExpiry).toEqual([[6, 10]]);
    expect(flashing(view)).toEqual([]);
  });

  test("a pane of its own keeps its flash when another pane flashes", () => {
    const first = fakeView("alpha beta");
    const second = fakeView("gamma delta");

    flashMatchRanges(first.view, [{ from: 0, to: 5 }]);
    flashMatchRanges(second.view, [{ from: 0, to: 5 }]);
    vi.advanceTimersByTime(MATCH_FLASH_MS);

    expect(flashing(first.view)).toEqual([]);
    expect(flashing(second.view)).toEqual([]);
  });

  test("a document swap puts it out rather than mapping it into new text", () => {
    // The change here is one the ranges would survive, on purpose: the real
    // swap replaces the whole document, so mapping alone would drop them and
    // the test would pass whatever the field did with the transaction. What
    // must hold is that the swap's user event is the signal, not the shape of
    // its changes — the same change without it carries the flash along, two
    // tests down.
    const { view } = fakeView("alpha beta");

    flashMatchRanges(view, [{ from: 6, to: 10 }]);
    view.dispatch({ changes: { from: 0, insert: "swapped " }, userEvent: "inkra.swap" });

    expect(flashing(view)).toEqual([]);
  });

  test("a watcher reload puts it out too", () => {
    const { view } = fakeView("alpha beta");

    flashMatchRanges(view, [{ from: 6, to: 10 }]);
    view.dispatch({ changes: { from: 0, insert: "reloaded " }, userEvent: "inkra.reload" });

    expect(flashing(view)).toEqual([]);
  });

  test("an edit above the flash carries it along", () => {
    const { view } = fakeView("alpha beta");

    flashMatchRanges(view, [{ from: 6, to: 10 }]);
    view.dispatch({ changes: { from: 0, insert: "typed " } });

    expect(flashing(view)).toEqual([[12, 16]]);
  });

  test("deleting the matched text takes the flash with it", () => {
    const { view } = fakeView("alpha beta");

    flashMatchRanges(view, [{ from: 6, to: 10 }]);
    view.dispatch({ changes: { from: 6, to: 10 } });

    expect(flashing(view)).toEqual([]);
  });
});

describe("jumpToPos", () => {
  test("flashes what the target carries, once it has landed", () => {
    const { view, scroller, dispatched } = fakeView("alpha beta gamma");

    jumpToPos(view, scroller, PATH, { pos: 11, flash: [{ from: 11, to: 16 }] });

    expect(flashing(view)).toEqual([[11, 16]]);
    // Dispatching before the scroll would put a transaction between the parse
    // and the measurement it feeds.
    expect(dispatched).toEqual([{ scrollTopWas: scroller.scrollTop }]);
    expect(scroller.scrollTop).toBeGreaterThan(0);
  });

  test("a target with nothing to flash puts out the one still burning", () => {
    // A result opened, then an anchor link followed a moment later: the reader
    // has left that line, and this jump is the only thing that can clear it.
    const { view, scroller, dispatched } = fakeView("alpha beta gamma");
    flashMatchRanges(view, [{ from: 0, to: 5 }]);

    jumpToPos(view, scroller, PATH, { pos: 11, flash: [] });

    expect(flashing(view)).toEqual([]);
    expect(dispatched).toHaveLength(2); // the flash, then the jump that clears it
    // Nothing lit, so nothing is left to expire.
    expect(vi.getTimerCount()).toBe(0);
  });
});
