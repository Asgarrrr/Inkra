import { describe, expect, test } from "vite-plus/test";
import contract from "../shared/content-search-event.contract.json";
import type { ContentSearchEvent } from "../src/lib/tauri";
import type {
  ContentSearchOutcome,
  ContentSearchResult,
  ContentSearchStats,
} from "../src/types/fs";

/** Typed against the hand-written TS types, compared against the fixture the
 *  Rust test serializes into. A rename on either side then breaks a test
 *  instead of rendering `undefined` in the palette. The annotations are what
 *  makes the TS side fail: excess-property checking does not reach into a
 *  literal nested under a union. */
const contractMatch: ContentSearchResult = {
  path: "/ws/notes/a.md",
  relative_path: "notes/a.md",
  line_number: 3,
  line_content: "needle here",
  match_ranges: [[0, 6]],
  line_truncated: true,
  score: 4000500,
};

const contractStats: ContentSearchStats = {
  total: 1,
  truncated: true,
  skipped_files: 2,
  outcome: "cancelled",
};

const events: ContentSearchEvent[] = [
  { event: "matches", data: [contractMatch] },
  { event: "done", data: contractStats },
];

const outcomes: ContentSearchOutcome[] = ["completed", "cancelled", "aborted", "failed"];

describe("content search wire contract", () => {
  test("the shared fixture is the shape the TS types describe", () => {
    expect(contract.events).toEqual(events);
    expect(contract.outcomes).toEqual(outcomes);
  });
});
