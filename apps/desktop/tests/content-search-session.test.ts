import { describe, expect, test } from "bun:test";
import { applyContentSearchEvent, emptySession } from "../src/lib/content-search-session";
import type { ContentSearchEvent } from "../src/lib/tauri";
import type { ContentSearchResult, ContentSearchStats } from "../src/types/fs";

function match(relativePath: string, lineNumber: number): ContentSearchResult {
  return {
    path: `/ws/${relativePath}`,
    relative_path: relativePath,
    line_number: lineNumber,
    line_content: "needle here",
    match_ranges: [[0, 6]],
    line_content_offset: 0,
    line_truncated: false,
    score: 1,
  };
}

function stats(overrides: Partial<ContentSearchStats> = {}): ContentSearchStats {
  return { total: 0, truncated: false, skipped_files: 0, outcome: "completed", ...overrides };
}

function reduce(events: ContentSearchEvent[]) {
  return events.reduce(applyContentSearchEvent, emptySession());
}

describe("content search session reducer", () => {
  test("accumulates batches in arrival order", () => {
    const session = reduce([
      { event: "matches", data: [match("a.md", 1), match("a.md", 4)] },
      { event: "matches", data: [match("b.md", 2)] },
    ]);

    expect(session.results.map((r) => [r.relative_path, r.line_number])).toEqual([
      ["a.md", 1],
      ["a.md", 4],
      ["b.md", 2],
    ]);
    expect(session.isComplete).toBe(false);
    expect(session.stats).toBeNull();
  });

  test("done records the stats and marks the session complete", () => {
    const done = stats({ total: 1, truncated: true, skipped_files: 3 });
    const session = reduce([
      { event: "matches", data: [match("a.md", 1)] },
      { event: "done", data: done },
    ]);

    expect(session.isComplete).toBe(true);
    expect(session.stats).toEqual(done);
    expect(session.results).toHaveLength(1);
  });

  test("events after done are ignored", () => {
    const completed = reduce([{ event: "done", data: stats({ total: 0 }) }]);

    const late = applyContentSearchEvent(completed, {
      event: "matches",
      data: [match("late.md", 9)],
    });
    const secondDone = applyContentSearchEvent(completed, {
      event: "done",
      data: stats({ total: 99, outcome: "cancelled" }),
    });

    expect(late).toBe(completed);
    expect(secondDone).toBe(completed);
    expect(completed.results).toHaveLength(0);
  });

  test("an empty batch returns the same object so React bails out", () => {
    const session = reduce([{ event: "matches", data: [match("a.md", 1)] }]);

    expect(applyContentSearchEvent(session, { event: "matches", data: [] })).toBe(session);
    expect(
      applyContentSearchEvent(session, { event: "matches", data: [match("b.md", 2)] }),
    ).not.toBe(session);
  });

  test("an unknown event tag leaves the session untouched", () => {
    const session = reduce([{ event: "matches", data: [match("a.md", 1)] }]);

    const next = applyContentSearchEvent(session, {
      event: "progress",
    } as unknown as ContentSearchEvent);

    expect(next).toBe(session);
  });
});
