use crate::error::AppError;
use crate::state::{self, AppState, IndexedFile};
use grep_matcher::Matcher;
use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use ignore::WalkBuilder;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashSet;
use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub path: String,
    pub filename: String,
    pub relative_path: String,
    pub score: u32,
    pub match_indices: Vec<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct IndexStats {
    pub file_count: usize,
    pub duration_ms: u64,
}

#[tauri::command]
pub fn index_workspace(
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<IndexStats, AppError> {
    let state = app.state::<AppState>().get_or_create(webview.label());
    let (root, epoch) = state.workspace_snapshot().ok_or(AppError::NoWorkspace)?;
    let cancel = Arc::clone(&state.cancel_index.read());

    let start = std::time::Instant::now();
    let (indexed, dirs) = index_workspace_impl(&root, cancel);
    let file_count = indexed.len();
    let duration_ms = start.elapsed().as_millis() as u64;

    let displaced = state.with_workspace_snapshot(&root, epoch, || {
        let old_index = std::mem::replace(&mut *state.file_index.write(), indexed);
        let old_cache = state.recent_files_cache.write().take();
        let old_dirs = std::mem::replace(&mut *state.dirs_with_markdown.write(), dirs);
        state.file_index_revision.fetch_add(1, Ordering::SeqCst);
        state.index_ready.store(true, Ordering::Relaxed);
        (old_index, old_cache, old_dirs)
    });
    let Some(displaced) = displaced else {
        return Ok(IndexStats {
            file_count: 0,
            duration_ms,
        });
    };
    drop(displaced);

    Ok(IndexStats {
        file_count,
        duration_ms,
    })
}

#[tauri::command]
pub fn fuzzy_search(
    query: String,
    limit: Option<u32>,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<Vec<SearchResult>, AppError> {
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let state = app.state::<AppState>().get_or_create(webview.label());
    let limit = limit.unwrap_or(50) as usize;
    let index = state.file_index.read();
    fuzzy_search_from(&query, &index, limit)
}

fn fuzzy_search_from(
    query: &str,
    index: &[IndexedFile],
    limit: usize,
) -> Result<Vec<SearchResult>, AppError> {
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let normalized_query = query.to_lowercase();
    let mut needles = Vec::from([normalized_query.clone()]);
    let hyphen_query = normalized_query.replace(' ', "-");
    if !needles.contains(&hyphen_query) {
        needles.push(hyphen_query);
    }
    let space_query = normalized_query.replace('-', " ");
    if !needles.contains(&space_query) {
        needles.push(space_query);
    }

    let mut results: Vec<SearchResult> = index
        .iter()
        .filter_map(|file| {
            let haystack = file.relative_path.to_lowercase();
            let (byte_start, needle) = needles
                .iter()
                .filter_map(|needle| haystack.find(needle).map(|start| (start, needle)))
                .min_by_key(|(start, _)| *start)?;

            let char_start = haystack[..byte_start].chars().count();
            let char_len = needle.chars().count();

            let filename_start_bytes = file.relative_path.rfind('/').map(|i| i + 1).unwrap_or(0);
            let in_filename = byte_start >= filename_start_bytes;

            // Higher score ranks first. Matches inside the filename beat matches
            // in a parent directory; earlier matches beat later ones; shorter
            // paths tiebreak.
            let mut score: u32 = 0;
            if in_filename {
                score += 1_000_000;
            }
            score += 10_000u32.saturating_sub(byte_start as u32);
            score +=
                1_000u32.saturating_sub((file.relative_path.chars().count() as u32).min(1_000));

            let match_indices: Vec<u32> = (char_start..char_start + char_len)
                .map(|i| i as u32)
                .collect();

            Some(SearchResult {
                path: file.path.to_string_lossy().to_string(),
                filename: file.name.clone(),
                relative_path: file.relative_path.clone(),
                score,
                match_indices,
            })
        })
        .collect();

    results.sort_by(|a, b| b.score.cmp(&a.score));
    results.truncate(limit);
    Ok(results)
}

/// Parallel file indexing using the `ignore` crate's walker.
/// Returns the indexed files and a set of directories containing markdown.
///
/// The `cancel` flag lets a concurrent workspace switch stop this walk early:
/// each walker thread checks the flag at every directory entry and returns
/// `WalkState::Quit` as soon as it's flipped. The returned results may be
/// partial in that case; callers should compare `cancel.load` or the workspace
/// epoch against expectations before acting on them.
pub fn index_workspace_impl(
    root: &Path,
    cancel: Arc<AtomicBool>,
) -> (Vec<IndexedFile>, HashSet<PathBuf>) {
    let root = root.to_path_buf();
    let results: Arc<Mutex<Vec<IndexedFile>>> = Arc::new(Mutex::new(Vec::new()));

    let threads = std::thread::available_parallelism()
        .map(|n| n.get().min(8))
        .unwrap_or(4);

    let results_ref = Arc::clone(&results);
    let root_ref = root.clone();

    WalkBuilder::new(&root)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .threads(threads)
        .build_parallel()
        .run(move || {
            let results = Arc::clone(&results_ref);
            let root = root_ref.clone();
            let cancel = Arc::clone(&cancel);
            Box::new(move |entry| {
                if cancel.load(Ordering::Relaxed) {
                    return ignore::WalkState::Quit;
                }
                let entry = match entry {
                    Ok(e) => e,
                    Err(_) => return ignore::WalkState::Continue,
                };
                // Safety net: skip node_modules even without .gitignore
                if entry.file_type().is_some_and(|ft| ft.is_dir()) {
                    if entry.file_name() == "node_modules" {
                        return ignore::WalkState::Skip;
                    }
                    return ignore::WalkState::Continue;
                }
                if entry.file_type().is_some_and(|ft| ft.is_file())
                    && entry.path().extension().and_then(|e| e.to_str()) == Some("md")
                {
                    let rel = entry
                        .path()
                        .strip_prefix(&root)
                        .unwrap_or(entry.path())
                        .to_string_lossy()
                        .to_string();
                    results.lock().push(IndexedFile {
                        path: entry.path().to_path_buf(),
                        relative_path: rel,
                        name: entry.file_name().to_string_lossy().to_string(),
                        modified_at: crate::commands::fs::modified_time(entry.path()),
                    });
                }
                ignore::WalkState::Continue
            })
        });

    let indexed = Arc::try_unwrap(results).unwrap().into_inner();
    let dirs = state::rebuild_dirs_from_index(&indexed, &root);
    (indexed, dirs)
}

/// Test-only convenience: run an uncancellable index.
#[cfg(test)]
fn index_workspace_test(root: &Path) -> (Vec<IndexedFile>, HashSet<PathBuf>) {
    index_workspace_impl(root, Arc::new(AtomicBool::new(false)))
}

pub fn fuzzy_search_impl(query: &str, index: &[IndexedFile], limit: usize) -> Vec<SearchResult> {
    fuzzy_search_from(query, index, limit).unwrap_or_default()
}

/// Find a file under `root` by case-insensitive basename. Used by Obsidian
/// wiki image embeds (`![[image.png]]`), which reference attachments by bare
/// filename regardless of where they live in the vault. The workspace file
/// index only covers markdown, so this walks on demand (gitignore-aware,
/// parallel) instead of maintaining a second media index plus watcher
/// plumbing; callers cache positive results.
///
/// Deterministic on duplicates: the match with the fewest path components
/// wins, ties broken lexicographically — "shortest path" like Obsidian.
pub fn find_file_by_name_impl(root: &Path, file_name: &str) -> Option<PathBuf> {
    let matches: Arc<Mutex<Vec<PathBuf>>> = Arc::new(Mutex::new(Vec::new()));
    let target = file_name.to_lowercase();

    let threads = std::thread::available_parallelism()
        .map(|n| n.get().min(8))
        .unwrap_or(4);

    let matches_ref = Arc::clone(&matches);
    WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .threads(threads)
        .build_parallel()
        .run(move || {
            let matches = Arc::clone(&matches_ref);
            let target = target.clone();
            Box::new(move |entry| {
                let Ok(entry) = entry else {
                    return ignore::WalkState::Continue;
                };
                if entry.file_type().is_some_and(|ft| ft.is_dir()) {
                    if entry.file_name() == "node_modules" {
                        return ignore::WalkState::Skip;
                    }
                    return ignore::WalkState::Continue;
                }
                if entry.file_type().is_some_and(|ft| ft.is_file())
                    && entry.file_name().to_string_lossy().to_lowercase() == target
                {
                    matches.lock().push(entry.path().to_path_buf());
                }
                ignore::WalkState::Continue
            })
        });

    let mut matches = Arc::try_unwrap(matches).unwrap().into_inner();
    matches.sort_by(|a, b| {
        let depth_a = a.components().count();
        let depth_b = b.components().count();
        depth_a.cmp(&depth_b).then_with(|| a.cmp(b))
    });
    matches.into_iter().next()
}

#[tauri::command]
pub async fn find_file_by_name(
    root: String,
    file_name: String,
) -> Result<Option<String>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(find_file_by_name_impl(Path::new(&root), &file_name)
            .map(|path| path.to_string_lossy().to_string()))
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchMode {
    Fuzzy,
    Literal,
}

#[derive(Debug, Clone)]
pub struct ContentQuery {
    pub tokens: Vec<String>,
    pub mode: SearchMode,
    pub case_sensitive: bool,
}

#[derive(Debug, Clone)]
pub struct ContentSearchOpts {
    pub per_file_cap: usize,
    pub total_cap: usize,
    pub max_bytes: u64,
    pub batch_size: usize,
}

impl Default for ContentSearchOpts {
    fn default() -> Self {
        Self {
            per_file_cap: 10,
            total_cap: 500,
            max_bytes: 2 * 1024 * 1024,
            batch_size: 32,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ContentMatch {
    pub path: String,
    pub relative_path: String,
    /// 1-based and relative to the document **body**: the editor never holds
    /// the frontmatter, so a file-relative number would land too low.
    pub line_number: u32,
    pub line_content: String,
    /// Codepoint offsets into `line_content`, never bytes.
    pub match_ranges: Vec<(u32, u32)>,
    /// `line_content` is a window cut out of a longer source line.
    pub line_truncated: bool,
    pub score: u32,
}

#[derive(Debug, Default, Serialize)]
pub struct ContentSearchStats {
    pub total: usize,
    pub truncated: bool,
    pub skipped_files: usize,
    pub outcome: ContentSearchOutcome,
}

/// Why the scan stopped. `Completed` also covers stopping on `total_cap`,
/// which is reported by `truncated`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ContentSearchOutcome {
    #[default]
    Completed,
    Cancelled,
    Aborted,
    Failed,
}

// Score banding: every tier's total range stays strictly below the step of the
// tier above it, so a lower criterion can never override a higher one. Editing
// one constant without re-checking the others silently reorders the ranking.
const PROXIMITY_BASE: u32 = 4_000_000_000;
const PROXIMITY_STEP: u32 = 4_000_000;
const HEADING_BONUS: u32 = 1_000_000;
const HIT_WEIGHT: u32 = 1_000;
const MAX_SCORED_HITS: u32 = 900;
const STEM_BONUS: u32 = 500;

/// Longest `line_content` emitted, in codepoints. Without it a single match on
/// a multi-megabyte line ships the whole line over the IPC channel.
pub const MAX_SNIPPET_CHARS: usize = 400;
/// Codepoints of context kept before the first match inside the window.
const SNIPPET_LEAD_CHARS: usize = 40;
/// Ranges collected per line. A pathological line can match hundreds of
/// thousands of times; the extra ranges fall outside the window anyway.
pub const MAX_RANGES_PER_LINE: usize = 50;

/// `/` switches to literal mode and the remainder stays a single token.
pub fn parse_content_query(raw: &str) -> Option<ContentQuery> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(rest) = trimmed.strip_prefix('/') {
        let literal = rest.trim();
        if literal.is_empty() {
            return None;
        }
        return Some(ContentQuery {
            tokens: Vec::from([literal.to_string()]),
            mode: SearchMode::Literal,
            case_sensitive: literal.chars().any(char::is_uppercase),
        });
    }

    Some(ContentQuery {
        tokens: trimmed.split_whitespace().map(str::to_string).collect(),
        mode: SearchMode::Fuzzy,
        case_sensitive: trimmed.chars().any(char::is_uppercase),
    })
}

/// Byte offset where the document body starts, mirroring `FRONTMATTER_RE`
/// (`src/lib/frontmatter.ts:3`) exactly — including its lack of `\r\n`
/// support. `commands/fs.rs` `extract_title` diverges on that point and must
/// not be reused here: a one-line disagreement shifts every emitted line
/// number.
fn body_offset(content: &str) -> usize {
    const OPEN: &str = "---\n";
    if !content.starts_with(OPEN) {
        return 0;
    }

    let mut offset = OPEN.len();
    while offset < content.len() {
        let rest = &content[offset..];
        match rest.find('\n') {
            Some(i) => {
                if &rest[..i] == "---" {
                    return offset + i + 1;
                }
                offset += i + 1;
            }
            None => {
                if rest == "---" {
                    return content.len();
                }
                break;
            }
        }
    }
    0
}

/// One `RegexMatcher` per token. An alternation would be leftmost-first and
/// miss overlapping tokens (`{ab, bc}` over `abc`), wrongly failing the AND
/// filter.
///
/// `None` on an empty token list or a blank token: a blank token matches at
/// every position, which multiplies into the per-line range budget. Rejecting
/// rather than dropping it keeps the matcher indices aligned with
/// `query.tokens`, which the stem test and `min_line_span` both rely on.
fn build_matchers(query: &ContentQuery) -> Option<Vec<RegexMatcher>> {
    if query.tokens.is_empty() || query.tokens.iter().any(|t| t.trim().is_empty()) {
        return None;
    }
    let mut builder = RegexMatcherBuilder::new();
    builder
        .fixed_strings(true)
        .case_insensitive(!query.case_sensitive);
    query
        .tokens
        .iter()
        .map(|token| builder.build(token).ok())
        .collect()
}

fn is_heading_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    // `hashes` is a char count used as a byte index: sound only because '#' is
    // ASCII. CommonMark accepts a space or a tab after the hashes, nothing else.
    let hashes = trimmed.chars().take_while(|c| *c == '#').count();
    (1..=6).contains(&hashes) && trimmed[hashes..].starts_with([' ', '\t'])
}

/// Lowercase and fold the separators writers alternate between, so a token and
/// a stem spelled differently still compare equal.
fn normalize_stem(value: &str) -> String {
    value.to_lowercase().replace(['-', '_'], " ")
}

fn stem_matches(relative_path: &str, tokens: &[String]) -> bool {
    let Some(stem) = Path::new(relative_path).file_stem() else {
        return false;
    };
    let stem = normalize_stem(&stem.to_string_lossy());
    tokens
        .iter()
        .any(|token| stem.contains(&normalize_stem(token)))
}

/// `None` when some token never occurs.
/// `hits` must be ordered by line number.
fn min_line_span(hits: &[(u32, usize)], token_count: usize) -> Option<u32> {
    if token_count == 0 {
        return None;
    }
    let mut counts = vec![0usize; token_count];
    let mut covered = 0usize;
    let mut left = 0usize;
    let mut best: Option<u32> = None;

    for right in 0..hits.len() {
        let (_, token) = hits[right];
        counts[token] += 1;
        if counts[token] == 1 {
            covered += 1;
        }
        while covered == token_count {
            let span = hits[right].0 - hits[left].0;
            best = Some(best.map_or(span, |b: u32| b.min(span)));
            let (_, left_token) = hits[left];
            counts[left_token] -= 1;
            if counts[left_token] == 0 {
                covered -= 1;
            }
            left += 1;
        }
    }

    best
}

/// Merge overlapping or adjacent ranges so the frontend renders flat,
/// non-nested spans.
fn merge_ranges(mut ranges: Vec<(u32, u32)>) -> Vec<(u32, u32)> {
    ranges.sort_unstable();
    let mut merged: Vec<(u32, u32)> = Vec::with_capacity(ranges.len());
    for (start, end) in ranges {
        match merged.last_mut() {
            Some(last) if start <= last.1 => last.1 = last.1.max(end),
            _ => merged.push((start, end)),
        }
    }
    merged
}

fn read_searchable(path: &Path, max_bytes: u64) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if metadata.len() > max_bytes {
        return None;
    }
    // UTF-8 validation doubles as the binary guard.
    String::from_utf8(std::fs::read(path).ok()?).ok()
}

/// Split exactly like CodeMirror's `DefaultSplit` (`/\r\n?|\n/`), which this
/// repo never overrides with a `lineSeparator` facet. `str::lines` ignores a
/// bare `\r`, so one of them would shift every later line number away from the
/// editor's — in range, silently wrong, and undetectable by the `doc.lines`
/// clamp on the frontend.
fn split_lines(body: &str) -> impl Iterator<Item = &str> + '_ {
    let mut rest = Some(body);
    std::iter::from_fn(move || {
        let current = rest?;
        match current.find(['\n', '\r']) {
            Some(i) => {
                let crlf = current.as_bytes()[i] == b'\r' && current[i + 1..].starts_with('\n');
                rest = Some(&current[i + if crlf { 2 } else { 1 }..]);
                Some(&current[..i])
            }
            None => {
                rest = None;
                Some(current)
            }
        }
    })
}

/// Emit a window of the line around its first match instead of the whole line,
/// rebasing the ranges into window coordinates. Returns `None` when the line
/// already fits.
fn snippet_window(line: &str, ranges: &[(u32, u32)]) -> Option<(String, Vec<(u32, u32)>)> {
    let char_len = line.chars().count();
    if char_len <= MAX_SNIPPET_CHARS {
        return None;
    }

    let first_match = ranges.first().map_or(0, |r| r.0 as usize);
    let start = first_match
        .saturating_sub(SNIPPET_LEAD_CHARS)
        .min(char_len - MAX_SNIPPET_CHARS);
    let end = start + MAX_SNIPPET_CHARS;

    let content: String = line.chars().skip(start).take(MAX_SNIPPET_CHARS).collect();
    let rebased = ranges
        .iter()
        .filter_map(|&(range_start, range_end)| {
            let (range_start, range_end) = (range_start as usize, range_end as usize);
            (range_start < end && range_end > start).then(|| {
                (
                    (range_start.max(start) - start) as u32,
                    (range_end.min(end) - start) as u32,
                )
            })
        })
        .collect();
    Some((content, rebased))
}

struct LineHit {
    line_number: u32,
    distinct_tokens: usize,
    line_content: String,
    ranges: Vec<(u32, u32)>,
    line_truncated: bool,
}

fn scan_file(
    body: &str,
    matchers: &[RegexMatcher],
    query: &ContentQuery,
    relative_path: &str,
) -> Option<(Vec<LineHit>, u32)> {
    let mut lines: Vec<LineHit> = Vec::new();
    let mut token_hits: Vec<(u32, usize)> = Vec::new();
    let mut total_hits: usize = 0;
    let mut heading_hit = false;

    for (index, line) in split_lines(body).enumerate() {
        let line_number = index as u32 + 1;
        let mut ranges: Vec<(u32, u32)> = Vec::new();
        let mut distinct_tokens = 0usize;

        for (token, matcher) in matchers.iter().enumerate() {
            let mut found = false;
            // `find_iter` yields ascending, non-overlapping matches, so one
            // forward cursor converts every offset. Rescanning from byte 0 per
            // match is quadratic in the line length.
            let mut byte_pos = 0usize;
            let mut char_pos = 0u32;
            let Ok(()) = matcher.find_iter(line.as_bytes(), |m| {
                found = true;
                total_hits += 1;
                char_pos += line[byte_pos..m.start()].chars().count() as u32;
                byte_pos = m.start();
                if ranges.len() < MAX_RANGES_PER_LINE {
                    let char_end = char_pos + line[m.start()..m.end()].chars().count() as u32;
                    ranges.push((char_pos, char_end));
                }
                true
            }) else {
                unreachable!("RegexMatcher::Error is NoError");
            };
            if found {
                distinct_tokens += 1;
                token_hits.push((line_number, token));
            }
        }

        if distinct_tokens == 0 {
            continue;
        }
        if is_heading_line(line) {
            heading_hit = true;
        }
        let ranges = merge_ranges(ranges);
        let (line_content, ranges, line_truncated) = match snippet_window(line, &ranges) {
            Some((content, rebased)) => (content, rebased, true),
            None => (line.to_string(), ranges, false),
        };
        lines.push(LineHit {
            line_number,
            distinct_tokens,
            line_content,
            ranges,
            line_truncated,
        });
    }

    if lines.is_empty() {
        return None;
    }

    // The AND filter applies in both modes; only the ranking is fuzzy-only.
    let span = min_line_span(&token_hits, matchers.len())?;
    let score = match query.mode {
        SearchMode::Literal => 0,
        SearchMode::Fuzzy => {
            let mut score = PROXIMITY_BASE.saturating_sub(span.saturating_mul(PROXIMITY_STEP));
            if heading_hit {
                score += HEADING_BONUS;
            }
            score += total_hits.min(MAX_SCORED_HITS as usize) as u32 * HIT_WEIGHT;
            if stem_matches(relative_path, &query.tokens) {
                score += STEM_BONUS;
            }
            score
        }
    };

    lines.sort_by(|a, b| {
        b.distinct_tokens
            .cmp(&a.distinct_tokens)
            .then(a.line_number.cmp(&b.line_number))
    });
    Some((lines, score))
}

/// Ordering across files is deliberately the index order: the frontend sorts
/// by score as batches land, so there is no global barrier here.
pub fn content_search_impl(
    files: &[IndexedFile],
    query: &ContentQuery,
    opts: &ContentSearchOpts,
    cancel: &dyn Fn() -> bool,
    emit: &mut dyn FnMut(Vec<ContentMatch>) -> ControlFlow<()>,
) -> ContentSearchStats {
    let mut stats = ContentSearchStats::default();
    let Some(matchers) = build_matchers(query) else {
        stats.outcome = ContentSearchOutcome::Failed;
        return stats;
    };

    let mut buffer: Vec<ContentMatch> = Vec::new();

    'files: for file in files {
        // Cooperative cancellation between files; a blocked `read` cannot
        // observe it. Break rather than return so buffered matches still
        // reach `emit` and `stats.total` stays equal to the emitted count.
        if cancel() {
            stats.outcome = ContentSearchOutcome::Cancelled;
            break;
        }
        let Some(content) = read_searchable(&file.path, opts.max_bytes) else {
            stats.skipped_files += 1;
            continue;
        };
        let body = &content[body_offset(&content)..];
        let Some((lines, score)) = scan_file(body, &matchers, query, &file.relative_path) else {
            continue;
        };

        let path = file.path.to_string_lossy().to_string();
        for hit in lines.into_iter().take(opts.per_file_cap) {
            // Checked before the push so `truncated` means a match was really
            // rejected, not that the cap was reached exactly.
            if stats.total >= opts.total_cap {
                stats.truncated = true;
                break 'files;
            }
            buffer.push(ContentMatch {
                path: path.clone(),
                relative_path: file.relative_path.clone(),
                line_number: hit.line_number,
                line_content: hit.line_content,
                match_ranges: hit.ranges,
                line_truncated: hit.line_truncated,
                score,
            });
            stats.total += 1;

            if buffer.len() >= opts.batch_size && emit(std::mem::take(&mut buffer)).is_break() {
                stats.outcome = ContentSearchOutcome::Aborted;
                break 'files;
            }
        }
    }

    if !buffer.is_empty()
        && emit(buffer).is_break()
        && stats.outcome == ContentSearchOutcome::Completed
    {
        stats.outcome = ContentSearchOutcome::Aborted;
    }
    stats
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup_workspace() -> TempDir {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("readme.md"), "# Readme").unwrap();
        fs::write(dir.path().join("notes.md"), "# Notes").unwrap();
        fs::write(dir.path().join("data.txt"), "not indexed").unwrap();
        fs::create_dir(dir.path().join("docs")).unwrap();
        fs::write(dir.path().join("docs").join("guide.md"), "# Guide").unwrap();
        // Hidden directory should be ignored
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".git").join("config.md"), "git").unwrap();
        dir
    }

    #[test]
    fn test_index_workspace_counts_md_files() {
        let dir = setup_workspace();
        let (index, _dirs) = index_workspace_test(dir.path());
        assert_eq!(index.len(), 3); // readme.md, notes.md, docs/guide.md
    }

    #[test]
    fn test_index_workspace_ignores_hidden() {
        let dir = setup_workspace();
        let (index, _dirs) = index_workspace_test(dir.path());
        // Should not include .git/config.md
        assert!(!index.iter().any(|f| f.relative_path.contains(".git")));
    }

    #[test]
    fn test_index_workspace_builds_dirs_with_markdown() {
        let dir = setup_workspace();
        let root = dir.path().to_path_buf();
        let (_index, dirs) = index_workspace_test(dir.path());
        // The root and docs/ should be in the set
        assert!(dirs.contains(&root));
        assert!(dirs.contains(&root.join("docs")));
        // .git should not be in the set
        assert!(!dirs.contains(&root.join(".git")));
    }

    #[test]
    fn test_cancel_flag_short_circuits_walk() {
        // Pre-cancelled walker should return before visiting any file.
        let dir = setup_workspace();
        let cancel = Arc::new(AtomicBool::new(true));
        let (index, dirs) = index_workspace_impl(dir.path(), cancel);
        assert!(index.is_empty());
        assert!(dirs.is_empty());
    }

    #[test]
    fn test_live_cancel_token_survives_after_swap() {
        // Mirror the workspace-switch contract: when the outgoing cancel flag
        // is flipped, any walker still holding a clone of the old Arc sees
        // the cancellation even after a fresh Arc replaces the state slot.
        let live = Arc::new(AtomicBool::new(false));
        let walker_view = Arc::clone(&live);
        live.store(true, Ordering::Relaxed);
        let _fresh = Arc::new(AtomicBool::new(false));
        assert!(walker_view.load(Ordering::Relaxed));
    }

    #[test]
    fn test_fuzzy_search_ranks_by_relevance() {
        let dir = setup_workspace();
        let (index, _dirs) = index_workspace_test(dir.path());
        let results = fuzzy_search_impl("readme", &index, 50);
        assert!(!results.is_empty());
        assert_eq!(results[0].filename, "readme.md");
    }

    #[test]
    fn test_fuzzy_search_matches_space_separated_names() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("No prior experience.md"), "# Note").unwrap();
        let (index, _dirs) = index_workspace_test(dir.path());

        let results = fuzzy_search_impl("No prior experience", &index, 50);

        assert!(!results.is_empty());
        assert_eq!(results[0].filename, "No prior experience.md");
    }

    #[test]
    fn test_fuzzy_search_returns_match_indices() {
        let dir = setup_workspace();
        let (index, _dirs) = index_workspace_test(dir.path());
        let results = fuzzy_search_impl("guide", &index, 50);
        assert!(!results.is_empty());
        assert!(!results[0].match_indices.is_empty());
    }

    #[test]
    fn test_fuzzy_search_empty_query() {
        let dir = setup_workspace();
        let (index, _dirs) = index_workspace_test(dir.path());
        let results = fuzzy_search_impl("", &index, 50);
        assert!(results.is_empty());
    }

    #[test]
    fn test_fuzzy_search_respects_limit() {
        let dir = setup_workspace();
        let (index, _dirs) = index_workspace_test(dir.path());
        let results = fuzzy_search_impl("md", &index, 1);
        assert!(results.len() <= 1);
    }

    #[test]
    fn test_find_file_by_name_case_insensitive() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("assets")).unwrap();
        fs::write(dir.path().join("assets").join("Diagram.PNG"), [0u8]).unwrap();

        let found = find_file_by_name_impl(dir.path(), "diagram.png").unwrap();
        assert_eq!(found, dir.path().join("assets").join("Diagram.PNG"));
    }

    #[test]
    fn test_find_file_by_name_prefers_shortest_path() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("a").join("b")).unwrap();
        fs::write(dir.path().join("a").join("b").join("pic.png"), [0u8]).unwrap();
        fs::write(dir.path().join("pic.png"), [0u8]).unwrap();

        let found = find_file_by_name_impl(dir.path(), "pic.png").unwrap();
        assert_eq!(found, dir.path().join("pic.png"));
    }

    #[test]
    fn test_find_file_by_name_missing_and_hidden() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".git").join("hidden.png"), [0u8]).unwrap();

        assert!(find_file_by_name_impl(dir.path(), "nope.png").is_none());
        assert!(find_file_by_name_impl(dir.path(), "hidden.png").is_none());
    }

    fn indexed(dir: &TempDir, relative_path: &str, content: &str) -> IndexedFile {
        let path = dir.path().join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&path, content).unwrap();
        indexed_entry(dir, relative_path)
    }

    fn indexed_bytes(dir: &TempDir, relative_path: &str, content: &[u8]) -> IndexedFile {
        fs::write(dir.path().join(relative_path), content).unwrap();
        indexed_entry(dir, relative_path)
    }

    fn indexed_entry(dir: &TempDir, relative_path: &str) -> IndexedFile {
        IndexedFile {
            path: dir.path().join(relative_path),
            relative_path: relative_path.to_string(),
            name: Path::new(relative_path)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            modified_at: 0,
        }
    }

    fn collect(
        files: &[IndexedFile],
        raw: &str,
        opts: &ContentSearchOpts,
    ) -> (Vec<ContentMatch>, ContentSearchStats) {
        let query = parse_content_query(raw).expect("query");
        let mut collected = Vec::new();
        let stats = content_search_impl(files, &query, opts, &|| false, &mut |batch| {
            collected.extend(batch);
            ControlFlow::Continue(())
        });
        (collected, stats)
    }

    fn search(files: &[IndexedFile], raw: &str) -> Vec<ContentMatch> {
        collect(files, raw, &ContentSearchOpts::default()).0
    }

    fn paths(results: Vec<ContentMatch>) -> Vec<String> {
        results.into_iter().map(|m| m.relative_path).collect()
    }

    fn ranked(files: &[IndexedFile], raw: &str) -> Vec<String> {
        let mut results = search(files, raw);
        results.sort_by_key(|m| std::cmp::Reverse(m.score));
        paths(results)
    }

    #[test]
    fn test_content_search_ranks_proximity_and_headings() {
        // Declared worst-first on purpose: the emitted order is the index
        // order, so a vacuous test would pass on declaration order alone.
        let dir = TempDir::new().unwrap();
        let files = [
            indexed(
                &dir,
                "far.md",
                "alpha here\nx\nx\nx\nx\nx\nx\nx\nx\nx\nx\nbeta here\n",
            ),
            indexed(&dir, "close.md", "alpha here\nbeta here\n"),
            indexed(&dir, "head.md", "# alpha\nbeta here\n"),
        ];

        assert_eq!(
            paths(search(&files, "alpha beta")),
            ["far.md", "far.md", "close.md", "close.md", "head.md", "head.md"]
        );

        assert_eq!(
            ranked(&files, "alpha beta"),
            ["head.md", "head.md", "close.md", "close.md", "far.md", "far.md"]
        );
    }

    #[test]
    fn test_content_search_ranks_by_hit_count() {
        let dir = TempDir::new().unwrap();
        let files = [
            indexed(&dir, "few.md", "alpha beta\n"),
            indexed(&dir, "many.md", "alpha beta alpha beta alpha\n"),
        ];

        assert_eq!(ranked(&files, "alpha beta"), ["many.md", "few.md"]);
    }

    #[test]
    fn test_content_search_stem_bonus_normalises_both_sides() {
        let dir = TempDir::new().unwrap();
        let files = [
            indexed(&dir, "other.md", "release-notes shipped\n"),
            indexed(&dir, "release-notes.md", "release-notes shipped\n"),
        ];

        assert_eq!(
            ranked(&files, "release-notes"),
            ["release-notes.md", "other.md"]
        );
        assert_eq!(
            ranked(&files, "release notes"),
            ["release-notes.md", "other.md"]
        );
    }

    #[test]
    fn test_content_search_and_across_distant_lines() {
        let dir = TempDir::new().unwrap();
        let mut body = String::from("# Channels\n");
        for _ in 0..20 {
            body.push_str("unrelated prose\n");
        }
        body.push_str("throughput is the metric\n");
        let files = [indexed(&dir, "notes.md", &body)];

        let results = search(&files, "channels throughput");

        let lines: Vec<u32> = results.iter().map(|m| m.line_number).collect();
        assert_eq!(lines, Vec::from([1, 22]));
    }

    #[test]
    fn test_content_search_excludes_file_missing_a_token() {
        let dir = TempDir::new().unwrap();
        let files = [
            indexed(&dir, "both.md", "channels\nthroughput\n"),
            indexed(&dir, "partial.md", "channels only\n"),
        ];

        let results = search(&files, "channels throughput");

        assert_eq!(paths(results), ["both.md", "both.md"]);
    }

    #[test]
    fn test_content_search_snippet_is_the_line_with_most_tokens() {
        let dir = TempDir::new().unwrap();
        let files = [indexed(
            &dir,
            "mix.md",
            "channels only\nchannels throughput\nthroughput only\n",
        )];

        let results = search(&files, "channels throughput");
        let lines: Vec<u32> = results.iter().map(|m| m.line_number).collect();
        assert_eq!(lines, Vec::from([2, 1, 3]));

        let opts = ContentSearchOpts {
            per_file_cap: 1,
            ..Default::default()
        };
        let (capped, _) = collect(&files, "channels throughput", &opts);
        assert_eq!(capped.len(), 1);
        assert_eq!(capped[0].line_number, 2);
    }

    #[test]
    fn test_content_search_matches_overlapping_tokens() {
        let dir = TempDir::new().unwrap();
        let files = [indexed(&dir, "over.md", "abc\n")];

        let results = search(&files, "ab bc");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].match_ranges, Vec::from([(0, 3)]));
    }

    #[test]
    fn test_content_search_literal_mode_is_unranked() {
        let dir = TempDir::new().unwrap();
        let files = [
            indexed(&dir, "a.md", "foo bar baz\n"),
            indexed(&dir, "b.md", "# foo bar\nfoo bar again\n"),
            indexed(&dir, "c.md", "foo only\n"),
        ];

        let results = search(&files, "/foo bar");

        assert_eq!(results.len(), 3);
        assert!(results.iter().all(|m| m.score == 0));
        assert!(!results.iter().any(|m| m.relative_path == "c.md"));
        assert_eq!(results[0].relative_path, "a.md");
        assert_eq!(results[0].match_ranges, Vec::from([(0, 7)]));
    }

    #[test]
    fn test_content_search_literal_multi_token_is_still_and() {
        let dir = TempDir::new().unwrap();
        let files = [
            indexed(&dir, "both.md", "alpha\nbeta\n"),
            indexed(&dir, "partial.md", "alpha only\n"),
        ];
        let query = ContentQuery {
            tokens: Vec::from([String::from("alpha"), String::from("beta")]),
            mode: SearchMode::Literal,
            case_sensitive: false,
        };
        let mut collected = Vec::new();
        content_search_impl(
            &files,
            &query,
            &ContentSearchOpts::default(),
            &|| false,
            &mut |batch| {
                collected.extend(batch);
                ControlFlow::Continue(())
            },
        );

        assert_eq!(paths(collected), ["both.md", "both.md"]);
    }

    #[test]
    fn test_content_search_smart_case_fuzzy() {
        let dir = TempDir::new().unwrap();
        let files = [indexed(&dir, "case.md", "Channels are fast\n")];

        assert_eq!(search(&files, "channels").len(), 1);
        assert_eq!(search(&files, "Channels").len(), 1);

        let lower = [indexed(&dir, "lower.md", "channels are fast\n")];
        assert!(search(&lower, "Channels").is_empty());
    }

    #[test]
    fn test_content_search_smart_case_literal() {
        let dir = TempDir::new().unwrap();
        let files = [indexed(&dir, "case.md", "Hello world\n")];

        assert_eq!(search(&files, "/hello world").len(), 1);

        let lower = [indexed(&dir, "lower.md", "hello world\n")];
        assert!(search(&lower, "/Hello world").is_empty());
    }

    #[test]
    fn test_content_search_line_numbers_are_body_relative() {
        let dir = TempDir::new().unwrap();
        let files = [indexed(
            &dir,
            "fm.md",
            "---\ntitle: Test\ndate: 2020\n---\n# Heading\n\nneedle here\n",
        )];

        let results = search(&files, "needle");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].line_number, 3);
        assert_eq!(results[0].line_content, "needle here");
    }

    #[test]
    fn test_content_search_does_not_match_inside_frontmatter() {
        let dir = TempDir::new().unwrap();
        let files = [indexed(&dir, "fm.md", "---\ntitle: needle\n---\nbody\n")];

        assert!(search(&files, "needle").is_empty());
    }

    #[test]
    fn test_body_offset_matches_frontmatter_regex() {
        // Parity with FRONTMATTER_RE (src/lib/frontmatter.ts:3). Deliberately
        // no \r\n support: the frontend regex has none.
        let re = regex_lite::Regex::new(r"^---\n([\s\S]*?\n)?---(?:\n|$)").unwrap();
        let cases = [
            ("---\n---\nbody", 8),
            ("---\nk: v\n---\nbody", 13),
            ("---\n---", 7),
            ("---\n\n---\nbody", 9),
            ("---\nunclosed\n", 0),
            ("no frontmatter\n---\n", 0),
            ("---\n---extra\nbody", 0),
            ("---\n", 0),
            ("---", 0),
        ];

        for (content, expected) in cases {
            assert_eq!(body_offset(content), expected, "offset for {content:?}");
            let via_regex = re.find(content).map(|m| m.end()).unwrap_or(0);
            assert_eq!(body_offset(content), via_regex, "parity for {content:?}");
        }
    }

    #[test]
    fn test_content_search_ranges_are_codepoints() {
        let dir = TempDir::new().unwrap();
        let files = [indexed(&dir, "uni.md", "café résumé\n🎉 party time\n")];

        let accented = &search(&files, "résumé")[0];
        assert_eq!(accented.match_ranges, Vec::from([(5, 11)]));

        let emoji = &search(&files, "party")[0];
        assert_eq!(emoji.match_ranges, Vec::from([(2, 7)]));
        let (start, end) = emoji.match_ranges[0];
        let sliced: String = emoji
            .line_content
            .chars()
            .skip(start as usize)
            .take((end - start) as usize)
            .collect();
        assert_eq!(sliced, "party");
    }

    #[test]
    fn test_content_search_merges_adjacent_ranges() {
        let dir = TempDir::new().unwrap();
        let files = [indexed(&dir, "merge.md", "alpha beta alpha\n")];

        let merged = &search(&files, "al ph")[0];
        assert_eq!(merged.match_ranges, Vec::from([(0, 4), (11, 15)]));

        let separate = &search(&files, "alpha")[0];
        assert_eq!(separate.match_ranges, Vec::from([(0, 5), (11, 16)]));
    }

    /// Slice codepoints, the way the frontend does with `Array.from`.
    fn slice_chars(value: &str, start: u32, end: u32) -> String {
        value
            .chars()
            .skip(start as usize)
            .take((end - start) as usize)
            .collect()
    }

    #[test]
    fn test_content_search_bounds_snippet_and_ranges_on_a_long_line() {
        let dir = TempDir::new().unwrap();
        // Leading multibyte char: a byte/codepoint mix-up shifts every range.
        let mut line = String::from("é");
        line.push_str(&"abc".repeat(70_000));
        let files = [indexed(&dir, "long.md", &format!("{line}\n"))];

        let results = search(&files, "ab");

        assert_eq!(results.len(), 1);
        let hit = &results[0];
        assert!(hit.line_truncated);
        assert_eq!(hit.line_content.chars().count(), MAX_SNIPPET_CHARS);
        assert_eq!(hit.match_ranges.len(), MAX_RANGES_PER_LINE);
        for &(start, end) in &hit.match_ranges {
            assert_eq!(slice_chars(&hit.line_content, start, end), "ab");
        }
    }

    #[test]
    fn test_content_search_window_follows_the_first_match() {
        let dir = TempDir::new().unwrap();
        let line = format!("{}néedle{}", "x".repeat(5_000), "y".repeat(5_000));
        let files = [indexed(&dir, "long.md", &format!("{line}\nnéedle\n"))];

        let results = search(&files, "néedle");

        assert_eq!(results.len(), 2);
        let windowed = results.iter().find(|m| m.line_number == 1).unwrap();
        assert!(windowed.line_truncated);
        assert_eq!(windowed.line_content.chars().count(), MAX_SNIPPET_CHARS);
        // 40 codepoints of lead-in before the first match.
        assert_eq!(windowed.match_ranges, Vec::from([(40, 46)]));
        let (start, end) = windowed.match_ranges[0];
        assert_eq!(slice_chars(&windowed.line_content, start, end), "néedle");

        let short = results.iter().find(|m| m.line_number == 2).unwrap();
        assert!(!short.line_truncated);
        assert_eq!(short.line_content, "néedle");
    }

    #[test]
    fn test_split_lines_matches_codemirror_default_split() {
        // CodeMirror's DefaultSplit; no `lineSeparator` facet is configured.
        let re = regex_lite::Regex::new(r"\r\n?|\n").unwrap();
        let cases = [
            "",
            "a",
            "a\nb",
            "a\r\nb",
            "a\rb",
            "a\r\rb",
            "a\n",
            "a\r",
            "\r\n",
            "a\r\nb\rc\nd",
        ];

        for case in cases {
            let ours: Vec<&str> = split_lines(case).collect();
            let theirs: Vec<&str> = re.split(case).collect();
            assert_eq!(ours, theirs, "split for {case:?}");
        }
    }

    #[test]
    fn test_content_search_line_numbers_survive_a_bare_cr() {
        let dir = TempDir::new().unwrap();
        let files = [indexed(
            &dir,
            "cr.md",
            "alpha\rneedle here\r\ngamma\nneedle tail\n",
        )];

        let results = search(&files, "needle");

        let lines: Vec<u32> = results.iter().map(|m| m.line_number).collect();
        assert_eq!(lines, Vec::from([2, 4]));
        assert_eq!(results[0].line_content, "needle here");
        assert!(results.iter().all(|m| !m.line_content.contains('\r')));
    }

    #[test]
    fn test_is_heading_line_requires_space_or_tab() {
        assert!(is_heading_line("# x"));
        assert!(is_heading_line("#\tx"));
        assert!(is_heading_line("###### x"));
        // U+00A0 is whitespace to Rust but not a CommonMark heading delimiter.
        assert!(!is_heading_line("#\u{a0}x"));
        assert!(!is_heading_line("#x"));
        assert!(!is_heading_line("#"));
        assert!(!is_heading_line("####### x"));
        assert!(!is_heading_line("plain"));
    }

    #[test]
    fn test_content_search_per_file_cap_keeps_the_best_lines() {
        let dir = TempDir::new().unwrap();
        let mut body = "alpha only\n".repeat(19);
        body.push_str("alpha beta\n");
        let files = [indexed(&dir, "many.md", &body)];
        let opts = ContentSearchOpts {
            per_file_cap: 3,
            ..Default::default()
        };

        let (results, stats) = collect(&files, "alpha beta", &opts);

        let lines: Vec<u32> = results.iter().map(|m| m.line_number).collect();
        assert_eq!(lines, Vec::from([20, 1, 2]));
        assert_eq!(stats.total, 3);
        assert!(!stats.truncated);
        assert_eq!(stats.outcome, ContentSearchOutcome::Completed);
    }

    #[test]
    fn test_content_search_total_cap_sets_truncated() {
        let dir = TempDir::new().unwrap();
        let files = [
            indexed(&dir, "a.md", &"needle\n".repeat(5)),
            indexed(&dir, "b.md", &"needle\n".repeat(5)),
            indexed(&dir, "c.md", &"needle\n".repeat(5)),
        ];
        let opts = ContentSearchOpts {
            total_cap: 7,
            ..Default::default()
        };

        let (results, stats) = collect(&files, "needle", &opts);

        assert_eq!(results.len(), 7);
        assert_eq!(stats.total, 7);
        assert!(stats.truncated);
        assert_eq!(stats.outcome, ContentSearchOutcome::Completed);
    }

    #[test]
    fn test_content_search_truncated_only_when_a_match_is_dropped() {
        let dir = TempDir::new().unwrap();
        let files = [indexed(&dir, "a.md", &"needle\n".repeat(5))];

        let exact = ContentSearchOpts {
            total_cap: 5,
            ..Default::default()
        };
        let (results, stats) = collect(&files, "needle", &exact);
        assert_eq!(results.len(), 5);
        assert!(!stats.truncated);

        let tight = ContentSearchOpts {
            total_cap: 4,
            ..Default::default()
        };
        let (results, stats) = collect(&files, "needle", &tight);
        assert_eq!(results.len(), 4);
        assert!(stats.truncated);

        let none = ContentSearchOpts {
            total_cap: 0,
            ..Default::default()
        };
        let (results, stats) = collect(&files, "needle", &none);
        assert!(results.is_empty());
        assert_eq!(stats.total, 0);
        assert!(stats.truncated);
    }

    #[test]
    fn test_content_search_stops_on_cancel() {
        let dir = TempDir::new().unwrap();
        let files = [
            indexed(&dir, "a.md", "needle\n"),
            indexed(&dir, "b.md", "needle\n"),
            indexed(&dir, "c.md", "needle\n"),
        ];

        let seen = std::cell::Cell::new(0usize);
        let cancel = || {
            let n = seen.get();
            seen.set(n + 1);
            n >= 1
        };
        let query = parse_content_query("needle").unwrap();
        let mut collected = Vec::new();
        let stats = content_search_impl(
            &files,
            &query,
            &ContentSearchOpts::default(),
            &cancel,
            &mut |batch| {
                collected.extend(batch);
                ControlFlow::Continue(())
            },
        );

        assert_eq!(stats.total, 1);
        assert_eq!(stats.outcome, ContentSearchOutcome::Cancelled);
        assert_eq!(collected.len(), 1);
        assert_eq!(collected[0].relative_path, "a.md");
    }

    #[test]
    fn test_content_search_stops_when_emit_breaks() {
        let dir = TempDir::new().unwrap();
        let files = [
            indexed(&dir, "a.md", "needle\nneedle\n"),
            indexed(&dir, "b.md", "needle\n"),
        ];
        let opts = ContentSearchOpts {
            batch_size: 1,
            ..Default::default()
        };
        let query = parse_content_query("needle").unwrap();

        let mut batches = 0;
        let stats = content_search_impl(&files, &query, &opts, &|| false, &mut |_| {
            batches += 1;
            ControlFlow::Break(())
        });

        assert_eq!(batches, 1);
        assert_eq!(stats.total, 1);
        assert_eq!(stats.outcome, ContentSearchOutcome::Aborted);
    }

    #[test]
    fn test_content_search_outcome_completed_and_failed() {
        let dir = TempDir::new().unwrap();
        let files = [indexed(&dir, "a.md", "needle\n")];

        let (_, stats) = collect(&files, "needle", &ContentSearchOpts::default());
        assert_eq!(stats.total, 1);
        assert_eq!(stats.outcome, ContentSearchOutcome::Completed);

        // A blank token would match at every position; the scan refuses it
        // instead of returning an all-zero result that looks like "no hits".
        let blank = ContentQuery {
            tokens: Vec::from([String::from("needle"), String::from("  ")]),
            mode: SearchMode::Fuzzy,
            case_sensitive: false,
        };
        let mut collected = Vec::new();
        let stats = content_search_impl(
            &files,
            &blank,
            &ContentSearchOpts::default(),
            &|| false,
            &mut |batch| {
                collected.extend(batch);
                ControlFlow::Continue(())
            },
        );
        assert!(collected.is_empty());
        assert_eq!(stats.outcome, ContentSearchOutcome::Failed);
    }

    #[test]
    fn test_content_search_skips_non_utf8_file() {
        let dir = TempDir::new().unwrap();
        let files = [
            indexed_bytes(&dir, "binary.md", &[0xff, 0xfe, b'n', b'e', 0x00]),
            indexed(&dir, "text.md", "needle\n"),
        ];

        let (results, stats) = collect(&files, "needle", &ContentSearchOpts::default());

        assert_eq!(stats.skipped_files, 1);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_content_search_skips_oversized_file() {
        let dir = TempDir::new().unwrap();
        let files = [indexed(&dir, "big.md", "needle needle needle\n")];
        let opts = ContentSearchOpts {
            max_bytes: 4,
            ..Default::default()
        };

        let (results, stats) = collect(&files, "needle", &opts);

        assert_eq!(stats.skipped_files, 1);
        assert!(results.is_empty());
    }

    #[test]
    fn test_min_line_span() {
        // Token 0 on lines 1 and 6, token 1 on line 5: the tight window is 5..6.
        let hits = [(1u32, 0usize), (5, 1), (6, 0)];
        assert_eq!(min_line_span(&hits, 2), Some(1));
        assert_eq!(min_line_span(&hits, 3), None);
        assert_eq!(min_line_span(&[(4u32, 0usize), (4, 1)], 2), Some(0));
        assert_eq!(min_line_span(&[], 1), None);
    }

    #[test]
    fn test_parse_content_query() {
        assert!(parse_content_query("").is_none());
        assert!(parse_content_query("   ").is_none());
        assert!(parse_content_query("/").is_none());
        assert!(parse_content_query("/  ").is_none());

        let literal = parse_content_query("/foo bar").unwrap();
        assert_eq!(literal.mode, SearchMode::Literal);
        assert_eq!(literal.tokens, Vec::from(["foo bar".to_string()]));
        assert!(!literal.case_sensitive);

        let fuzzy = parse_content_query("  foo   bar  ").unwrap();
        assert_eq!(fuzzy.mode, SearchMode::Fuzzy);
        assert_eq!(
            fuzzy.tokens,
            Vec::from(["foo".to_string(), "bar".to_string()])
        );
        assert!(!fuzzy.case_sensitive);

        assert!(parse_content_query("Foo bar").unwrap().case_sensitive);
        assert!(parse_content_query("/Foo bar").unwrap().case_sensitive);
    }
}
