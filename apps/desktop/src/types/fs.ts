export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_markdown: boolean;
  modified_at: number;
  title: string | null;
}

export interface FileContent {
  path: string;
  content: string;
  modified_at: number;
}

export interface WriteResult {
  path: string;
  modified_at: number;
}

export interface WorkspaceInfo {
  root: string;
  name: string;
  file_count: number;
  epoch: number;
}

export interface SearchResult {
  path: string;
  filename: string;
  relative_path: string;
  score: number;
  match_indices: number[];
}

export interface ContentSearchResult {
  path: string;
  relative_path: string;
  /** 1-based and relative to the document body: the editor never holds the
   *  frontmatter, so a file-relative number would land too low. */
  line_number: number;
  line_content: string;
  /** Codepoint offsets into `line_content`, never UTF-16 indices — slice with
   *  `Array.from`, never `String.prototype.slice`. */
  match_ranges: [number, number][];
  /** Codepoint offset of `line_content` within the source line, 0 unless the
   *  line was windowed. Add it to a range to address the line the editor holds. */
  line_content_offset: number;
  /** `line_content` is a window cut out of a longer source line. */
  line_truncated: boolean;
  score: number;
}

/** Why the scan stopped. `completed` also covers stopping on the total cap,
 *  which is reported by `truncated`. */
export type ContentSearchOutcome = "completed" | "cancelled" | "aborted" | "failed";

export interface ContentSearchStats {
  total: number;
  truncated: boolean;
  skipped_files: number;
  outcome: ContentSearchOutcome;
}

export interface IndexStats {
  file_count: number;
  duration_ms: number;
}
