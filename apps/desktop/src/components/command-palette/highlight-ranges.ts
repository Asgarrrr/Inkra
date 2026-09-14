export interface HighlightSegment {
  text: string;
  match: boolean;
}

/** Split `text` into at most three segments per range. Offsets are codepoints,
 *  so `String.prototype.slice` is wrong: on `"🎉 party time"` Rust emits
 *  `[2, 7]` and `slice(2, 7)` returns `" part"`.
 *
 *  Rust merges the ranges, so they arrive sorted and disjoint; the clamping
 *  here keeps an out-of-order or out-of-bounds range from producing garbage.
 *  Boundaries are not aligned on graphemes. */
export function splitHighlightRanges(
  text: string,
  ranges: readonly (readonly [number, number])[],
): HighlightSegment[] {
  const chars = Array.from(text);
  const segments: HighlightSegment[] = [];
  let cursor = 0;

  for (const [rangeStart, rangeEnd] of ranges) {
    const start = Math.min(Math.max(rangeStart, cursor), chars.length);
    const end = Math.min(Math.max(rangeEnd, start), chars.length);
    if (end === start) continue;

    if (start > cursor) segments.push({ text: chars.slice(cursor, start).join(""), match: false });
    segments.push({ text: chars.slice(start, end).join(""), match: true });
    cursor = end;
  }

  if (cursor < chars.length) {
    segments.push({ text: chars.slice(cursor).join(""), match: false });
  }

  return segments;
}
