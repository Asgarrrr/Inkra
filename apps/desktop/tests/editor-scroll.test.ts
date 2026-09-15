import { beforeEach, describe, expect, test, vi } from "bun:test";
import { actualTauriCore } from "./helpers/actual-tauri-core";
import { mocked } from "./helpers/vi-compat";

vi.mock("@tauri-apps/api/core", () => ({
  ...actualTauriCore,
  invoke: vi.fn(),
}));

vi.mock("@/lib/theme", () => ({
  applyTheme: vi.fn(),
  applyCssVarBindings: vi.fn(),
}));

// Which region the jump parses is pinned in `viewport-parse.test.ts`; what this
// file owns is that the jump asks for its own target and asks before measuring.
vi.mock("../src/components/editor-area/viewport-parse", () => ({
  parseThrough: vi.fn(),
}));

import type { EditorView } from "@codemirror/view";
import { jumpScrollTop, jumpToPos } from "../src/components/editor-area/editor-scroll";
import { parseThrough } from "../src/components/editor-area/viewport-parse";
import { useEditorStore, type OpenFile } from "../src/stores/editor-store";

const PATH = "/a.md";
const DOC_LENGTH = 100_000;
// `EDITOR_SAFE_SCROLL_MARGIN` lives in a `.tsx` module, which this test config
// cannot import. Pinned by value: changing the fade distance fails the tests
// below rather than silently moving where every jump lands.
const SAFE_MARGIN = 140;
const mockedParseThrough = mocked(parseThrough);

/** The browser clamps `scrollTop` to the scrollable range and reports the
 *  clamped value back, which is the whole point of the write-back. */
function fakeScroller({ scrollHeight = 10_000, clientHeight = 800, top = 0 }) {
  const scroller = {
    scrollTop: top,
    scrollHeight,
    clientHeight,
    scrollCalls: 0,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo: ({ top: next }: ScrollToOptions) => {
      scroller.scrollCalls++;
      scroller.scrollTop = Math.max(0, Math.min(next ?? 0, scrollHeight - clientHeight));
    },
  };
  return scroller as unknown as HTMLElement & { scrollTop: number; scrollCalls: number };
}

type QueuedMeasure<T = unknown> = {
  read: (view: EditorView) => T;
  write?: (measured: T, view: EditorView) => void;
};

type ViewProbe = {
  /** Every position `lineBlockAt` was asked for, in order. */
  measuredAt: number[];
  /** How many measurements had run when `parseThrough` was called, or null. */
  parsedAtMeasurement: number | null;
  pending: QueuedMeasure[];
};

type FakeView = EditorView & { probe: ViewProbe; swapDocument: () => void };

/** `lineBlockAt` answers `tops[i]` on the i-th measurement and repeats the last:
 *  the height under a jump target settles only once its region parses. It never
 *  throws out of range, because CodeMirror's answers its last block instead — so
 *  the clamp is observable only through the position it was asked for.
 *  `documentTop` follows the scroller, being a screen coordinate; a fixed one
 *  would never let a correction converge. */
function fakeView(
  scroller: { scrollTop: number },
  tops: number | number[],
  { hasFocus = false } = {},
): FakeView {
  const blockTops = Array.isArray(tops) ? tops : [tops];
  const probe: ViewProbe = { measuredAt: [], parsedAtMeasurement: null, pending: [] };
  let state = { doc: { length: DOC_LENGTH } };
  const view = {
    probe,
    hasFocus,
    get state() {
      return state;
    },
    get documentTop() {
      return -scroller.scrollTop;
    },
    // Every jump dispatches its flash, empty or not; which ranges it carries
    // and how long they stay lit belong to `match-flash.test.ts`.
    dispatch: () => {},
    lineBlockAt: (pos: number) => {
      probe.measuredAt.push(pos);
      return { top: blockTops[Math.min(probe.measuredAt.length - 1, blockTops.length - 1)] };
    },
    requestMeasure: (request: QueuedMeasure) => {
      probe.pending.push(request);
    },
    // A tab swap or a watcher reload replaces the document in place; `Text` is
    // immutable, so a new document is a new reference.
    swapDocument: () => {
      state = { doc: { length: DOC_LENGTH } };
    },
  };
  return view as unknown as FakeView;
}

/** One round stands for one measure-loop iteration. CodeMirror reads every
 *  queued request before writing any, so a write can land in the gap after
 *  another request was read. Bounded so an unbounded correction loop fails the
 *  test instead of hanging it. */
function flushMeasures(view: FakeView, maxRounds = 10) {
  let rounds = 0;
  while (view.probe.pending.length > 0 && rounds < maxRounds) {
    const requests = view.probe.pending.splice(0);
    const measured = requests.map((request) => request.read(view));
    requests.forEach((request, i) => request.write?.(measured[i], view));
    rounds++;
  }
}

/** A jump to a position with nothing to flash: what every anchor target is. */
function at(pos: number) {
  return { pos, flash: [] };
}

function openFileWith(scrollPos: number) {
  useEditorStore.setState({
    openFiles: new Map([[PATH, { path: PATH, scrollPos } as OpenFile]]),
  });
}

function savedScrollPos() {
  return useEditorStore.getState().openFiles.get(PATH)?.scrollPos;
}

describe("jumpScrollTop", () => {
  beforeEach(() => openFileWith(0));

  test("records the position it scrolled to", () => {
    const scroller = fakeScroller({});

    jumpScrollTop(scroller, PATH, 1280);

    expect(scroller.scrollTop).toBe(1280);
    expect(savedScrollPos()).toBe(1280);
  });

  test("records where the scroller landed, not what was asked for", () => {
    // A swap into a shorter document clamps; persisting the request would save
    // a position the container can never be at.
    const scroller = fakeScroller({ scrollHeight: 1000, clientHeight: 800 });

    jumpScrollTop(scroller, PATH, 1280);

    expect(scroller.scrollTop).toBe(200);
    expect(savedScrollPos()).toBe(200);
  });

  test("overwrites a position the scroll listener persisted in the meantime", () => {
    openFileWith(4200);
    const scroller = fakeScroller({});

    jumpScrollTop(scroller, PATH, 0);

    expect(savedScrollPos()).toBe(0);
  });
});

describe("jumpToPos", () => {
  beforeEach(() => {
    openFileWith(0);
    mockedParseThrough.mockReset();
    mockedParseThrough.mockImplementation((view) => {
      const { probe } = view as FakeView;
      probe.parsedAtMeasurement ??= probe.measuredAt.length;
    });
  });

  test("records the clamped landing position, not the one it aimed at", () => {
    const scroller = fakeScroller({ scrollHeight: 2000, clientHeight: 800 });

    jumpToPos(fakeView(scroller, 9000), scroller, PATH, at(42));

    expect(scroller.scrollTop).toBe(1200);
    expect(savedScrollPos()).toBe(1200);
  });

  test("overwrites a position the scroll listener persisted in the meantime", () => {
    openFileWith(4200);
    const scroller = fakeScroller({});

    jumpToPos(fakeView(scroller, 3000), scroller, PATH, at(42));

    expect(savedScrollPos()).not.toBe(4200);
    expect(savedScrollPos()).toBe(scroller.scrollTop);
  });

  test("parses through its own target before reading the heights it aims at", () => {
    const scroller = fakeScroller({});
    const view = fakeView(scroller, 5000);

    jumpToPos(view, scroller, PATH, at(42));

    expect(mockedParseThrough).toHaveBeenCalledWith(view, 42);
    expect(view.probe.parsedAtMeasurement).toBe(0);
  });

  test("measures the last position in the document for a target past its end", () => {
    // A file that shrank since the scan. `documentTop` is 0 here, so the landing
    // offset is the block top less the safe-zone margin, absolutely.
    const scroller = fakeScroller({});
    const view = fakeView(scroller, 5000);

    jumpToPos(view, scroller, PATH, at(DOC_LENGTH + 5_000));

    expect(view.probe.measuredAt).toEqual([DOC_LENGTH]);
    expect(scroller.scrollTop).toBe(5000 - SAFE_MARGIN);
  });

  test("does not chase a target that sits above the top of the scroller", () => {
    // The safe-zone margin puts the wanted offset below zero; without the clamp
    // the correction would spend both passes on an offset nothing can reach.
    const scroller = fakeScroller({});
    const view = fakeView(scroller, 10);

    jumpToPos(view, scroller, PATH, at(42));
    flushMeasures(view);

    expect(scroller.scrollTop).toBe(0);
    expect(scroller.scrollCalls).toBe(1);
  });

  test("does not chase a target past the end of the scroll range", () => {
    const scroller = fakeScroller({ scrollHeight: 2000, clientHeight: 800 });
    const view = fakeView(scroller, [9000, 9300]);

    jumpToPos(view, scroller, PATH, at(42));
    flushMeasures(view);

    expect(scroller.scrollTop).toBe(1200);
    expect(scroller.scrollCalls).toBe(1);
  });

  test("pulls the target back when the heights shift under it after the scroll", () => {
    const scroller = fakeScroller({});
    const view = fakeView(scroller, [5000, 5300]);

    jumpToPos(view, scroller, PATH, at(42));
    const landed = scroller.scrollTop;

    flushMeasures(view);

    // The target sank 300px while its region parsed; the jump follows it.
    expect(scroller.scrollTop).toBe(landed + 300);
    expect(savedScrollPos()).toBe(landed + 300);
  });

  test("stops correcting once its passes are spent, however the heights move", () => {
    const scroller = fakeScroller({});
    // Every measurement reports a new height, so nothing but the bound ends it.
    const view = fakeView(
      scroller,
      Array.from({ length: 12 }, (_, i) => 5000 + i * 300),
    );

    jumpToPos(view, scroller, PATH, at(42));
    flushMeasures(view);

    expect(scroller.scrollCalls).toBe(3); // the jump plus two corrections
    expect(view.probe.pending).toHaveLength(0);
  });

  test("gives up the correction when something else moved the scroller", () => {
    const scroller = fakeScroller({});
    const view = fakeView(scroller, [5000, 5300]);

    jumpToPos(view, scroller, PATH, at(42));
    const landed = scroller.scrollTop;
    scroller.scrollTop = 1000; // a user scroll between the jump and the measure

    flushMeasures(view);

    expect(scroller.scrollTop).toBe(1000);
    expect(scroller.scrollCalls).toBe(1);
    expect(savedScrollPos()).toBe(landed);
  });

  test("leaves the correction to CodeMirror while the editor has focus", () => {
    // The heading-anchor path reaches here from a click inside the editor, where
    // CodeMirror's own measure-loop anchoring is active and would add to ours.
    const scroller = fakeScroller({});
    const view = fakeView(scroller, [5000, 5300], { hasFocus: true });

    jumpToPos(view, scroller, PATH, at(42));
    const landed = scroller.scrollTop;
    flushMeasures(view);

    expect(view.probe.pending).toHaveLength(0);
    expect(scroller.scrollCalls).toBe(1);
    expect(savedScrollPos()).toBe(landed);
  });

  test("corrects drift above a pixel and ignores drift below it", () => {
    const subPixel = fakeScroller({});
    const subPixelView = fakeView(subPixel, [5000, 5000.75]);
    const wholePixels = fakeScroller({});
    const wholePixelsView = fakeView(wholePixels, [5000, 5002]);

    jumpToPos(subPixelView, subPixel, PATH, at(42));
    flushMeasures(subPixelView);
    jumpToPos(wholePixelsView, wholePixels, PATH, at(42));
    flushMeasures(wholePixelsView);

    // Both measured twice; the sub-pixel one then decided against moving.
    expect(subPixelView.probe.measuredAt).toHaveLength(2);
    expect(subPixel.scrollCalls).toBe(1);
    expect(subPixel.scrollTop).toBe(5000 - SAFE_MARGIN);
    expect(wholePixels.scrollTop).toBe(5002 - SAFE_MARGIN);
  });

  test("abandons the correction when the document was swapped under it", () => {
    const scroller = fakeScroller({});
    const view = fakeView(scroller, [5000, 5300]);

    jumpToPos(view, scroller, PATH, at(42));
    const landed = scroller.scrollTop;
    view.swapDocument(); // a tab swap or a watcher reload, before the measure

    flushMeasures(view);

    // `pos` came from the outgoing document, so even measuring against the
    // incoming one is wrong — and the write would name the outgoing file.
    expect(view.probe.measuredAt).toHaveLength(1);
    expect(scroller.scrollCalls).toBe(1);
    expect(savedScrollPos()).toBe(landed);
  });

  test("abandons the correction when the document is swapped between read and write", () => {
    const scroller = fakeScroller({});
    const view = fakeView(scroller, [5000, 5300]);
    // Queued first, so its write runs in the gap after our request was read.
    view.probe.pending.push({ read: () => null, write: () => view.swapDocument() });

    jumpToPos(view, scroller, PATH, at(42));
    const landed = scroller.scrollTop;

    flushMeasures(view);

    expect(scroller.scrollCalls).toBe(1);
    expect(savedScrollPos()).toBe(landed);
  });
});
