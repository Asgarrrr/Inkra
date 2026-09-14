import type { ContentSearchSession } from "@/lib/content-search-session";
import { getParentDir } from "@/lib/paths";
import type { PendingTarget } from "@/lib/pending-target";
import type { ContentSearchResult } from "@/types/fs";

/** Filename search runs from the first character; a content scan reads the
 *  disk, so every `Cmd+P` would cost a workspace scan without a floor. */
export const CONTENT_SEARCH_MIN_QUERY_LENGTH = 3;

/** The single place the threshold is applied. `""` keeps the hook idle. The
 *  `/` grep prefix counts as typed — Rust parses it. */
export function contentSearchQuery(search: string): string {
  const trimmed = search.trim();
  return trimmed.length >= CONTENT_SEARCH_MIN_QUERY_LENGTH ? trimmed : "";
}

export interface ContentResultGroup {
  path: string;
  relativePath: string;
  score: number;
  results: ContentSearchResult[];
}

/** cmdk keys its selection on `value`, and a file can yield several hits. */
export function contentRowValue(result: ContentSearchResult): string {
  return `${result.path}:${result.line_number}`;
}

/** Where opening a result takes the editor. The row's ranges are relative to
 *  the snippet, which may be a window cut out of the line; the editor holds the
 *  whole line, so the window offset is applied here and the carrier never
 *  learns that snippets have windows. */
export function contentResultTarget(result: ContentSearchResult): PendingTarget {
  return {
    kind: "line",
    line: result.line_number,
    matchRanges: result.match_ranges.map(
      ([start, end]) =>
        [start + result.line_content_offset, end + result.line_content_offset] as const,
    ),
  };
}

/** `getParentDir` answers `/` for a name with no directory — true of an
 *  absolute path, wrong for a workspace-relative one at the vault root. */
export function contentParentDir(relativePath: string): string {
  const parent = getParentDir(relativePath);
  return parent === "/" ? "" : parent;
}

export function groupContentResults(results: readonly ContentSearchResult[]): ContentResultGroup[] {
  const groups = new Map<string, ContentResultGroup>();

  for (const result of results) {
    const group = groups.get(result.path);
    if (group) {
      group.results.push(result);
      continue;
    }
    groups.set(result.path, {
      path: result.path,
      relativePath: result.relative_path,
      score: result.score,
      results: [result],
    });
  }

  return [...groups.values()];
}

export function orderContentGroups(groups: ContentResultGroup[]): ContentResultGroup[] {
  return [...groups].sort(
    (a, b) => b.score - a.score || compareStrings(a.relativePath, b.relativePath),
  );
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export type ContentSection =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "empty" }
  | { kind: "unavailable" }
  | { kind: "active"; groups: ContentResultGroup[]; truncated: boolean; searching: boolean };

export interface ContentSectionInput {
  query: string;
  session: ContentSearchSession;
  isSearching: boolean;
  isStale: boolean;
}

export function contentSection(input: ContentSectionInput): ContentSection {
  if (!input.query) return { kind: "idle" };
  // A session opened on another query answers that one: its rows, its
  // completion and its outcome are all evidence about text the user has
  // already edited away, and Enter on one of its rows opens the wrong file.
  if (input.isStale) return { kind: "pending" };

  const groups = orderContentGroups(groupContentResults(input.session.results));
  if (groups.length > 0 || input.isSearching) {
    return {
      kind: "active",
      groups,
      truncated: input.session.stats?.truncated ?? false,
      searching: input.isSearching,
    };
  }

  if (!input.session.isComplete) return { kind: "pending" };
  // A scan that failed or was torn down never read the documents, so "no
  // matches" would be a verdict on files nothing opened.
  return input.session.stats?.outcome === "completed" ? { kind: "empty" } : { kind: "unavailable" };
}
