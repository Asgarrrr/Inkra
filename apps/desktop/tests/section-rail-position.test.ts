import { describe, expect, test } from "vite-plus/test";
import { readingPosition } from "../src/components/editor-area/section-rail/use-active-headings";

// Tops and threshold share one coordinate space; which one is the caller's
// business. The hook passes document coordinates — heading tops that scrolling
// does not move, against a threshold shifted by `view.documentTop` — so that it
// can measure the tops once and cache them.
const THRESHOLD = 140;

describe("readingPosition", () => {
  test("is invariant under a shift of the shared coordinate space", () => {
    // The guard on the caching: converting the threshold into document
    // coordinates must give what converting every top into screen ones would.
    const tops = [-500, 40, 240, 900];
    const screen = readingPosition(tops, THRESHOLD, false);
    for (const documentTop of [-2400, -13, 0, 777]) {
      const shifted = tops.map((top) => top - documentTop);
      expect(readingPosition(shifted, THRESHOLD - documentTop, false)).toBeCloseTo(screen, 10);
    }
  });

  test("is a whole number when a heading sits on the threshold", () => {
    expect(readingPosition([-200, 140, 500, 900], THRESHOLD, false)).toBe(1);
  });

  test("interpolates across a segment instead of stepping", () => {
    // Heading 1 is 100px above the threshold, heading 2 is 100px below it.
    expect(readingPosition([-500, 40, 240], THRESHOLD, false)).toBe(1.5);
    expect(readingPosition([-500, -10, 240], THRESHOLD, false)).toBeCloseTo(1.6, 10);
  });

  test("stays at 0 until the first heading crosses the threshold", () => {
    expect(readingPosition([300, 700, 1100], THRESHOLD, false)).toBe(0);
  });

  test("pins to the last heading at the scroll end", () => {
    // The last heading never reached the threshold — the clamp still gives it
    // full width so the rail does not stall one tick short.
    expect(readingPosition([-400, 60, 400], THRESHOLD, true)).toBe(2);
    expect(readingPosition([-900, -500, -100], THRESHOLD, true)).toBe(2);
  });

  test("holds the last heading once nothing follows it", () => {
    expect(readingPosition([-900, -500, -100], THRESHOLD, false)).toBe(2);
  });

  test("stays finite when folded headings share a top", () => {
    const position = readingPosition([-500, 40, 40, 900], THRESHOLD, false);
    expect(Number.isFinite(position)).toBe(true);
    expect(position).toBeCloseTo(2 + 100 / 860, 10);
  });

  test("returns 0 without headings", () => {
    expect(readingPosition([], THRESHOLD, false)).toBe(0);
    expect(readingPosition([], THRESHOLD, true)).toBe(0);
  });
});
