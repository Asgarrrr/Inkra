import { describe, expect, test } from "vite-plus/test";

import {
  contentParentDir,
  contentRowValue,
  contentSearchQuery,
  contentSection,
  groupContentResults,
  orderContentGroups,
  type ContentSection,
} from "../src/components/command-palette/group-content-results";
import { splitHighlightRanges } from "../src/components/command-palette/highlight-ranges";
import type { ContentSearchSession } from "../src/lib/content-search-session";
import type { ContentSearchResult } from "../src/types/fs";

function hit(
  relativePath: string,
  lineNumber: number,
  score: number,
  overrides: Partial<ContentSearchResult> = {},
): ContentSearchResult {
  return {
    path: `/ws/${relativePath}`,
    relative_path: relativePath,
    line_number: lineNumber,
    line_content: "needle here",
    match_ranges: [[0, 6]],
    line_truncated: false,
    score,
    ...overrides,
  };
}

function session(
  results: ContentSearchResult[],
  overrides: Partial<ContentSearchSession> = {},
): ContentSearchSession {
  return { query: "alpha", results, stats: null, isComplete: false, ...overrides };
}

function activeGroups(section: ContentSection) {
  if (section.kind !== "active") throw new Error(`expected an active section, got ${section.kind}`);
  return section.groups;
}

describe("content search threshold", () => {
  test("a query shorter than three characters keeps the hook idle", () => {
    expect(contentSearchQuery("")).toBe("");
    expect(contentSearchQuery("a")).toBe("");
    expect(contentSearchQuery("ab")).toBe("");
    expect(contentSearchQuery("   ab   ")).toBe("");
  });

  test("three characters reach the hook, trimmed", () => {
    expect(contentSearchQuery("abc")).toBe("abc");
    expect(contentSearchQuery("  abc  ")).toBe("abc");
  });

  test("the grep prefix counts toward the threshold as typed", () => {
    expect(contentSearchQuery("/ab")).toBe("/ab");
    expect(contentSearchQuery("/a")).toBe("");
  });
});

describe("grouping", () => {
  test("groups hits by path, keeping arrival order inside and out", () => {
    const groups = groupContentResults([
      hit("b.md", 3, 10),
      hit("a.md", 7, 40),
      hit("b.md", 9, 10),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.path)).toEqual(["/ws/b.md", "/ws/a.md"]);
    expect(groups[0]!.results.map((result) => result.line_number)).toEqual([3, 9]);
    expect(groups[1]!.results.map((result) => result.line_number)).toEqual([7]);
  });

  test("a group carries its file's score and relative path", () => {
    const groups = groupContentResults([hit("notes/deep.md", 4, 42), hit("notes/deep.md", 8, 42)]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.score).toBe(42);
    expect(groups[0]!.relativePath).toBe("notes/deep.md");
  });

  test("rows from the same file get distinct cmdk values", () => {
    const values = [hit("notes.md", 4, 5), hit("notes.md", 12, 5)].map(contentRowValue);

    expect(values).toEqual(["/ws/notes.md:4", "/ws/notes.md:12"]);
    expect(new Set(values).size).toBe(2);
  });

  test("a file at the vault root has no parent directory to show", () => {
    expect(contentParentDir("README.md")).toBe("");
    expect(contentParentDir("notes/deep.md")).toBe("notes");
    expect(contentParentDir("a/b/c.md")).toBe("a/b");
  });
});

describe("group order", () => {
  test("sorts by score descending", () => {
    const ordered = orderContentGroups(
      groupContentResults([hit("low.md", 1, 1), hit("high.md", 1, 9), hit("mid.md", 1, 5)]),
    );

    expect(ordered.map((group) => group.relativePath)).toEqual(["high.md", "mid.md", "low.md"]);
  });

  test("breaks equal scores on relative path, whatever the arrival order", () => {
    const paths = ["zeta.md", "alpha.md", "mid.md"];
    const forward = orderContentGroups(groupContentResults(paths.map((path) => hit(path, 1, 5))));
    const backward = orderContentGroups(
      groupContentResults([...paths].reverse().map((path) => hit(path, 1, 5))),
    );

    expect(forward.map((group) => group.relativePath)).toEqual(["alpha.md", "mid.md", "zeta.md"]);
    expect(backward.map((group) => group.relativePath)).toEqual(["alpha.md", "mid.md", "zeta.md"]);
  });

  test("a late batch takes its place by score, not by arrival", () => {
    const delivered = [hit("mid.md", 1, 5), hit("low.md", 1, 1)];
    const late = activeGroups(
      contentSection({
        query: "alpha",
        session: session([...delivered, hit("top.md", 1, 99)]),
        isSearching: false,
        isStale: false,
      }),
    );

    expect(late.map((group) => group.relativePath)).toEqual(["top.md", "mid.md", "low.md"]);
  });
});

describe("content section state", () => {
  test("below the threshold the group renders nothing at all", () => {
    const section = contentSection({
      query: contentSearchQuery("ab"),
      session: session([hit("a.md", 1, 1)]),
      isSearching: false,
      isStale: false,
    });

    expect(section.kind).toBe("idle");
  });

  test("a scan still in flight is never a verdict", () => {
    const running = contentSection({
      query: "alpha",
      session: session([]),
      isSearching: false,
      isStale: false,
    });
    const staleButComplete = contentSection({
      query: "alphab",
      session: session([], { isComplete: true }),
      isSearching: false,
      isStale: true,
    });

    expect(running.kind).toBe("pending");
    expect(staleButComplete.kind).toBe("pending");
  });

  test("a previous query's results are never shown as the current ones", () => {
    const section = contentSection({
      query: "zzz",
      session: session([hit("authentication.md", 12, 80)], {
        isComplete: true,
        stats: { total: 1, truncated: false, skipped_files: 0, outcome: "completed" },
      }),
      isSearching: true,
      isStale: true,
    });

    expect(section.kind).toBe("pending");
  });

  test("only a finished scan on the current query says there is nothing", () => {
    const section = contentSection({
      query: "alpha",
      session: session([], {
        isComplete: true,
        stats: { total: 0, truncated: false, skipped_files: 0, outcome: "completed" },
      }),
      isSearching: false,
      isStale: false,
    });

    expect(section.kind).toBe("empty");
  });

  test("a scan that never read the documents does not claim zero matches", () => {
    for (const outcome of ["failed", "aborted", "cancelled"] as const) {
      const section = contentSection({
        query: "alpha",
        session: session([], {
          isComplete: true,
          stats: { total: 0, truncated: false, skipped_files: 0, outcome },
        }),
        isSearching: false,
        isStale: false,
      });

      expect(section.kind).toBe("unavailable");
    }
  });

  test("the searching affordance shows before the first batch lands", () => {
    const section = contentSection({
      query: "alpha",
      session: session([]),
      isSearching: true,
      isStale: false,
    });

    expect(section.kind).toBe("active");
    expect(section.kind === "active" && section.searching).toBe(true);
    expect(activeGroups(section)).toHaveLength(0);
  });

  test("a scan with no stats yet is not already truncated", () => {
    const section = contentSection({
      query: "alpha",
      session: session([hit("a.md", 1, 1)]),
      isSearching: true,
      isStale: false,
    });

    expect(section.kind === "active" && section.truncated).toBe(false);
  });

  test("a capped scan says so", () => {
    const section = contentSection({
      query: "alpha",
      session: session([hit("a.md", 1, 1)], {
        isComplete: true,
        stats: { total: 1, truncated: true, skipped_files: 0, outcome: "completed" },
      }),
      isSearching: false,
      isStale: false,
    });

    expect(section.kind === "active" && section.truncated).toBe(true);
  });
});

describe("range highlighting", () => {
  test("splits on codepoints, not UTF-16 units, with an emoji before the match", () => {
    // `"🎉 party time".slice(2, 7)` is `" part"` — the emoji is two UTF-16 units.
    expect(splitHighlightRanges("🎉 party time", [[2, 7]])).toEqual([
      { text: "🎉 ", match: false },
      { text: "party", match: true },
      { text: " time", match: false },
    ]);
  });

  test("handles an astral CJK ideograph before the match", () => {
    expect(splitHighlightRanges("𠮷野家 ramen", [[4, 9]])).toEqual([
      { text: "𠮷野家 ", match: false },
      { text: "ramen", match: true },
    ]);
  });

  test("handles accented Latin", () => {
    expect(splitHighlightRanges("café crème brûlée", [[5, 10]])).toEqual([
      { text: "café ", match: false },
      { text: "crème", match: true },
      { text: " brûlée", match: false },
    ]);
  });

  test("a range touching the start emits no leading segment", () => {
    expect(splitHighlightRanges("needle here", [[0, 6]])).toEqual([
      { text: "needle", match: true },
      { text: " here", match: false },
    ]);
  });

  test("a range touching the end emits no trailing segment", () => {
    expect(splitHighlightRanges("find needle", [[5, 11]])).toEqual([
      { text: "find ", match: false },
      { text: "needle", match: true },
    ]);
  });

  test("a line with no ranges stays one plain segment", () => {
    expect(splitHighlightRanges("plain line", [])).toEqual([{ text: "plain line", match: false }]);
    expect(splitHighlightRanges("", [])).toEqual([]);
  });

  test("walks several ranges in one pass", () => {
    expect(
      splitHighlightRanges("ab cd ab", [
        [0, 2],
        [6, 8],
      ]),
    ).toEqual([
      { text: "ab", match: true },
      { text: " cd ", match: false },
      { text: "ab", match: true },
    ]);
  });

  test("clamps ranges that run past the line instead of crashing", () => {
    expect(splitHighlightRanges("short", [[3, 99]])).toEqual([
      { text: "sho", match: false },
      { text: "rt", match: true },
    ]);
    expect(splitHighlightRanges("short", [[9, 12]])).toEqual([{ text: "short", match: false }]);
  });

  test("drops an inverted range instead of slicing backwards", () => {
    expect(splitHighlightRanges("needle", [[5, 2]])).toEqual([{ text: "needle", match: false }]);
  });

  test("a range that reaches back before the cursor is clamped forward", () => {
    expect(
      splitHighlightRanges("abcdefghij", [
        [6, 9],
        [0, 3],
      ]),
    ).toEqual([
      { text: "abcdef", match: false },
      { text: "ghi", match: true },
      { text: "j", match: false },
    ]);
  });
});
