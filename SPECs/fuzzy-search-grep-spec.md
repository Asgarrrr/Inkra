# Fuzzy Search And Grep Spec

## Summary

Add full-content fuzzy search and grep across the workspace. Today Writer only has fuzzy file-name search through the command palette; users cannot search the text inside their documents.

## Goals

- Let the user search the text content of every markdown file in the workspace.
- Rank results by relevance, not just recency.
- Show inline result snippets with the match highlighted.
- Clicking a result opens the file and jumps to the matched line.
- Keep performance acceptable on workspaces with thousands of files.

## Non-Goals

- Regex search in v1 (follow-up).
- Search-and-replace in v1.
- Searching non-markdown files.
- Case-sensitive toggle UI in v1 (defaults to smart case).

## Freshness Contract (v1 Limitation)

The scan reads the files on disk. The user reads the buffer in the editor. A phrase just typed is not findable until the file is saved, and an edit that deleted a phrase still matches until the save lands.

This is accepted for v1 and is not a bug. Searching unsaved buffers would mean either a second, differently-shaped search path over the open documents or flushing every buffer before each keystroke's scan.

## Search Surface

### Entry points

One search zone, not two. The command palette is the search surface, and it
returns commands, file names, and document content (see `[D-3]` in the
execution plan).

- `Cmd+P` opens it. Content results appear in it alongside file names.
- `Cmd+Shift+F` opens the same palette. Like `Cmd+P`, it needs a workspace: a
  compact single-file window has no index and no content to scan, so the
  shortcut does nothing there.
- The sidebar's existing `Search ⌘P` bar (`file-browser.tsx`, shown when
  `appearance.sidebar-show-search` is on) stays the single clickable entry
  point, unchanged. No new icon is added to the sidebar.

### Threshold

Content scanning only starts once the trimmed query reaches **3 characters**;
below that the palette is filename-only. Filename fuzzy search still runs from
the first character. Without the floor, every `Cmd+P` used to jump to a file
would trigger a workspace-wide disk scan. The `/` grep prefix counts toward the
3 characters as typed.

### Palette layout

- Search input at the top.
- Scrollable results list below: one row per match, grouped by file.
- Each result row shows: file title, matched line with the query highlighted, line number, and workspace-relative parent path. A file at the vault root shows no parent path.
- Arrow keys navigate rows; Enter opens the active row.
- **Sticky file headers are descoped.** The palette surface is deliberately
  translucent (`[cmdk-dialog]::before` paints `--bg-base` at 55% under a
  backdrop blur), and a sticky header needs an opaque fill to hide the rows
  passing under it. Nothing in the app is sticky today, so there is no pattern
  to follow and no way to judge the result short of running it. Revisit with a
  runtime pass if the headers prove hard to keep track of at `per_file_cap`
  = 10.

### Snippet rule

One snippet line per match row. The scan picks, per file, the line carrying the
most query tokens, ties broken by the first such line; that line heads the
file's group. Lines are windowed to 400 characters around the first match and
carry a `line_truncated` flag, rendered as a single trailing ellipsis.

## Backend Strategy

- Use ripgrep's `grep-regex` and `grep-matcher` sub-crates on the Rust side to match lines. Not the umbrella `grep` crate, and not `grep-searcher` — see `[D-1]` in the execution plan.
- Honor `.gitignore` (reuse the workspace ignore matcher already wired up for the file index).
- Iterate the in-memory workspace file index rather than walking the disk, so there is no walk to parallelize and no need for `rayon`. The scan runs on one blocking thread and streams its batches.
- Return at most N results per file (default ~10) and M total (default ~500) to keep the palette responsive.

### Search modes

- **Fuzzy mode** (default): tokenize the query and rank files whose content contains the tokens, weighted by proximity.
- **Grep mode**: triggered by prefixing the query with `/`. Matches lines literally. Snippets show the exact matched range.

Fuzzy mode is for "I kind of remember writing about foo and bar"; grep mode is for "find me this exact string".

## Ranking

For fuzzy mode:

- Prefer matches in headings over matches in body text.
- Prefer files where all query tokens appear close together.
- Use filename-stem matches as a tiebreaker.
- Recency bias is secondary to relevance.

## Incremental Index vs. Live Scan

Start with live scans: ripgrep is fast enough that a naive full-workspace scan is acceptable for v1 up to medium-sized workspaces.

If performance becomes a problem:

- Add an in-memory inverted index built from the existing workspace file index.
- Invalidate per file on watcher updates.

Do not design v1 around the inverted index.

## UX Decisions

- Results appear as the user types, debounced 150ms. The 120ms first written
  here predates the split between filename search (in memory, 50ms) and the
  content scan, which reads the disk.
- Show a "Searching..." indicator only if results take longer than ~200ms. That
  rule governs the indicator beside results; it never leaves the list blank —
  a scan with nothing on screen yet says "Searching documents...".
- **The fuzzy-vs-grep hint is descoped.** It was written for a dedicated
  content palette with an empty state to put it in. Under `[D-3]` the empty
  query shows the full command list, so there is no empty state left.
- Clicking a result opens the file in the active tab (honoring the existing tab-reuse rules) and scrolls to the matched line.
- The editor highlights the matched range briefly on arrival.

## Implementation Notes

- Add a Rust command `search_workspace_content(query, options) -> Vec<ContentMatch>`.
- `ContentMatch` includes `path`, `line_number`, `line_text`, and `match_ranges` for highlighting.
- Debounce in the frontend hook, not the backend.
- Reuse the command palette's fuzzy-match highlighting style for consistency.
- Share the existing workspace ignore matcher so the file index and content search apply the same filter.

## Files Expected To Change

- `apps/desktop/src-tauri/Cargo.toml` (add `grep-regex` / `grep-matcher`)
- `apps/desktop/src-tauri/src/commands/search.rs`
- `apps/desktop/src-tauri/src/state.rs`
- `apps/desktop/src/components/command-palette/` — `use-content-search.ts`,
  `group-content-results.ts`, `highlight-ranges.ts`, `content-results.tsx` (new),
  and `index.tsx`. No separate content palette: see `[D-3]`.
- `apps/desktop/src/hooks/use-keyboard-shortcuts.ts`
- `apps/desktop/src/components/editor-area/use-prosemark-editor.ts` (line-jump + brief highlight)
- frontend and Rust tests

## Acceptance Criteria

- `Cmd+Shift+F` opens the command palette, which searches across every markdown file in the workspace alongside commands and file names.
- Typing a query returns ranked results with inline snippets and highlighted matches.
- A `/query` prefix switches to literal grep mode.
- Clicking a result opens the file in the current tab and scrolls to the matched line with a brief highlight.
- Search honors the workspace's `.gitignore` filter.
- Performance remains responsive (< ~250ms to first results) on workspaces with up to a few thousand markdown files.
