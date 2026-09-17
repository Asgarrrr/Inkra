import { describe, expect, test } from "vite-plus/test";

import {
  checkClockSanity,
  percentile,
  segmentsOf,
  summarize,
  type KeystrokeSample,
} from "../src/lib/keystroke-metrics";

/** A sample whose four stamps are spaced by the given segment widths. */
function sample(
  seq: number,
  { t0 = 1000, inputDelay = 1, processing = 4, presentation = 8 } = {},
  overrides: Partial<KeystrokeSample> = {},
): KeystrokeSample {
  const t1 = t0 + inputDelay;
  const t2 = t1 + processing;
  return {
    seq,
    key: "a",
    label: "type",
    origin: "keydown",
    trusted: true,
    t0,
    t1,
    t2,
    t3: t2 + presentation,
    docLength: 2048,
    ...overrides,
  };
}

describe("percentile", () => {
  // Nearest-rank, no interpolation: with 30 samples per cell, interpolating
  // between two neighbours invents a number no keystroke actually cost.
  test("selects by nearest rank", () => {
    const values = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5];
    expect(percentile(values, 0)).toBe(1);
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 95)).toBe(10);
    expect(percentile(values, 100)).toBe(10);
  });

  test("does not mutate its input", () => {
    const values = [3, 1, 2];
    percentile(values, 50);
    expect(values).toEqual([3, 1, 2]);
  });

  test("answers null for an empty set rather than NaN", () => {
    expect(percentile([], 50)).toBeNull();
  });

  test("returns the single value for a one-element set at any rank", () => {
    expect(percentile([7], 0)).toBe(7);
    expect(percentile([7], 95)).toBe(7);
  });
});

describe("segmentsOf", () => {
  test("splits the stamps into the three segments", () => {
    const s = segmentsOf(sample(1, { inputDelay: 2, processing: 5, presentation: 9 }));
    expect(s).not.toBeNull();
    expect(s?.inputDelay).toBe(2);
    expect(s?.processing).toBe(5);
    expect(s?.presentation).toBe(9);
  });

  // The reconciliation that catches a refactor swapping two stamps: the parts
  // are differences of the same four numbers, so they must close the total.
  test("segments sum to the totals", () => {
    for (const seq of [1, 2, 3]) {
      const s = segmentsOf(sample(seq, { inputDelay: seq, processing: seq * 3, presentation: 7 }));
      expect(s).not.toBeNull();
      if (!s) continue;
      expect(s.inputDelay + s.processing + s.presentation).toBeCloseTo(s.totalFromKeyEvent, 9);
      expect(s.processing + s.presentation).toBeCloseTo(s.totalFromListener, 9);
    }
  });

  test("is null when the keystroke changed no document", () => {
    expect(segmentsOf(sample(1, {}, { t2: null }))).toBeNull();
    expect(segmentsOf(sample(1, {}, { t3: null }))).toBeNull();
  });
});

describe("checkClockSanity", () => {
  test("accepts stamps that rise in dispatch order", () => {
    const samples = [sample(1, { t0: 100 }), sample(2, { t0: 200 }), sample(3, { t0: 300 })];
    expect(checkClockSanity(samples)).toMatchObject({ usable: true });
  });

  // WebDriver keys are driver-synthesized. Whether WebKit stamps them with a
  // real dispatch time is exactly what this predicate exists to find out.
  test("rejects a t0 that runs backwards between samples", () => {
    const samples = [sample(1, { t0: 300 }), sample(2, { t0: 100 })];
    const verdict = checkClockSanity(samples);
    expect(verdict.usable).toBe(false);
    expect(verdict.reason).toMatch(/monotonic/i);
  });

  test("rejects a keystroke observed before it was dispatched", () => {
    const samples = [sample(1, { t0: 100 }, { t1: 50 })];
    const verdict = checkClockSanity(samples);
    expect(verdict.usable).toBe(false);
    expect(verdict.reason).toMatch(/t0 <= t1/i);
  });

  test("rejects a zero stamp, which is a driver that never set one", () => {
    const samples = [sample(1, { t0: 0 })];
    expect(checkClockSanity(samples).usable).toBe(false);
  });

  // The case the ordering checks cannot see. A driver-synthesized event is
  // monotonic and well-ordered, and its `timeStamp` is still only the moment
  // the event object was constructed in-page — not when a key was pressed.
  // `isTrusted` is the only signal that separates the two.
  test("rejects an untrusted event, whose timeStamp is not a dispatch time", () => {
    const samples = [sample(1, { t0: 100 }, { trusted: false })];
    const verdict = checkClockSanity(samples);
    expect(verdict.usable).toBe(false);
    expect(verdict.reason).toMatch(/untrusted/i);
  });

  test("still rejects untrusted events that are perfectly ordered", () => {
    const ordered = [
      sample(1, { t0: 100 }, { trusted: false }),
      sample(2, { t0: 200 }, { trusted: false }),
    ];
    expect(checkClockSanity(ordered).usable).toBe(false);
  });
});

describe("summarize", () => {
  test("reports per-segment medians and p95", () => {
    const samples = Array.from({ length: 10 }, (_, i) =>
      sample(i + 1, { t0: 1000 + i * 100, processing: i + 1, presentation: 5 }),
    );

    const out = summarize(samples);
    expect(out.count).toBe(10);
    expect(out.complete).toBe(10);
    expect(out.segments.processing?.median).toBe(5);
    expect(out.segments.processing?.p95).toBe(10);
    expect(out.segments.presentation?.median).toBe(5);
  });

  test("counts keystrokes that produced no document change as incomplete", () => {
    const samples = [sample(1), sample(2, {}, { t2: null })];
    const out = summarize(samples);
    expect(out.count).toBe(2);
    expect(out.complete).toBe(1);
  });

  test("keeps a trusted-origin mix visible in the output", () => {
    const out = summarize([sample(1), sample(2, { t0: 2000 }, { origin: "beforeinput" })]);
    expect(out.origins).toEqual({ keydown: 1, beforeinput: 1 });
  });

  // The stated fallback: an input-delay column read off a clock that cannot be
  // trusted is worse than no column, so it is dropped and the reason kept.
  test("drops the input-delay column when the clock is unusable", () => {
    const samples = [sample(1, { t0: 300 }), sample(2, { t0: 100 })];
    const out = summarize(samples);
    expect(out.clock.usable).toBe(false);
    expect(out.segments.inputDelay).toBeNull();
    expect(out.segments.processing).not.toBeNull();
    expect(out.total?.basis).toBe("listener");
  });

  test("totals from the key event when the clock is trustworthy", () => {
    const out = summarize([sample(1), sample(2, { t0: 2000 })]);
    expect(out.clock.usable).toBe(true);
    expect(out.total?.basis).toBe("key-event");
  });

  test("reports a zero residual when the segments close the total", () => {
    const out = summarize(
      Array.from({ length: 5 }, (_, i) => sample(i + 1, { t0: 1000 + i * 50 })),
    );
    expect(out.maxResidual).toBeLessThan(1e-9);
  });

  test("survives an empty drain", () => {
    const out = summarize([]);
    expect(out.count).toBe(0);
    expect(out.segments.processing).toBeNull();
    expect(out.total).toBeNull();
  });
});
