Inkra forked from Writer at `3f724ed`. Upstream has moved 22 commits since,
and none of that work had reached us. This brings it across.

The sidebar gains a **Sort by** submenu: name A to Z or Z to A, modified time,
created time, each in both directions, plus a **Folders first** toggle that is
on by default. Cmd+W on the last remaining launcher tab now puts the window
away instead of doing nothing. The editor's headroom scales with the window
height rather than sitting at a fixed 128–144px. The section rail's ticks are
one width, and the rail hides itself on short notes. The marketing site's
stacked layout below 900px is rebuilt, and its badge reads Beta.

## Why a merge and not a cherry-pick

Our divergence is almost entirely cosmetic to upstream's work: the rename to
Inkra, the version, and the move to Bun. Eleven files conflicted and every one
of them resolved mechanically.

A cherry-pick would have left no merge base, so the next sync would conflict on
these same 20 commits all over again. Merging pays the cost once.

Two commits are deliberately not taken: upstream's bump to 0.6.1, since we are
at 0.7.0, and the repair of their own `TODOS.md`, which does not exist in ours.

## Decisions worth knowing before reading the diff

Conflicts resolved toward **our identity and their behaviour**. Version,
product name, and bundle identifier stay Inkra at 0.7.0 under `com.inkra`.
Upstream's height-driven padding structure comes across under our `--inkra-*`
variable names. The shortcut table keeps our content-search rows and takes
their Cmd+W note.

Upstream shipped the sidebar sort as two changelog entries, one per commit —
first the sort modes, then the Folders first toggle that renamed the menu. Both
land in the same release here, so they are **folded into one entry** that
describes the end state. The same applies to the `TODOS.md` Done section.

Imported changelog prose is **renamed from Writer to Inkra**, including the
`writer` command-line tool in the Cmd+W entry.

## Two defects in the imported code, fixed in the second commit

The Cmd+W handler was **not platform-gated**, while the Rust
close-requested handler it depends on is `#[cfg(target_os = "macos")]`. Off
macOS the close is a real close, so clearing the last launcher tab destroyed
the only window and quit the app. The decision now lives in a pure
`shouldCloseWindowOnCmdW(tabs, platform)` with five tests around it. Its
`tabs.every(...)` guard was also redundant with the `tabs.length <= 1` beside
it, and an empty tab array passed it.

`read_directory_impl` called `fs::metadata` **twice per entry**, once for each
timestamp, doubling the syscalls for every directory listing. One `entry_times`
helper reads the metadata once and returns the pair. The created-time fallback
to the modified time is unchanged, so created-time sorting still degrades
rather than collapsing to zero on filesystems with no birth time.

## Verifying

```
vp check                                       → 0 errors, 1 warning (pre-existing, e2e/wdio.conf.js)
vp test                                        → 59 files, 726 passed
cd apps/desktop/src-tauri && cargo test --all-targets → 207 passed
cd apps/desktop/src-tauri && cargo fmt --check        → exit 0
cd apps/desktop/src-tauri && cargo clippy             → 12 warnings, all pre-existing
```

The clippy warnings sit in `config.rs`, `images.rs`, `search.rs`, and the two
`sort_by` calls in `fs.rs` that the merge only re-commented. The set is
identical before and after.

The platform gate was checked by removing it: `never closes the window off
macOS` fails, and passes again once restored.

Not verified: the GUI. Nothing here was exercised in a running app. The sidebar
sort has 227 lines of imported unit tests behind it, the Cmd+W decision has
five, and the rest — editor padding, section rail, website layout — is CSS and
layout that only an eye can judge.

## Risk and rollback

The two commits revert independently, and the fixes commit reverts without the
merge.

Created time falls back to modified time where the filesystem exposes no birth
time, which is many Linux mounts. Created-time sorting is then indistinguishable
from modified-time sorting rather than broken, but it is not an error either.

`sortTreeEntries` sorts by the title **saved on disk**, not the one in the
editor buffer. A row moves when you save a changed heading, not while you type
it. That is upstream's deliberate choice and it is what keeps rows from
reshuffling under the cursor.

Own saves bypass the file watcher, so the tree's cached `modified_at` is
patched directly from the write result. If that path ever breaks, time-based
sorting silently stops reacting to edits — it will not throw.

## Known follow-ups

`flattenTree` now takes seven positional parameters, three of them optional and
inserted before `result`. It works, and every caller in the tree passes them
correctly, but an options object would survive the next addition better.

`MIN_HEADINGS = 5` is hard-coded in the section rail. A note with four headings
loses its rail with no way to ask for it back.

Four upstream branches appeared alongside this sync and are not looked at:
`feature/sidebar-folders-first`, `fix/pr-review-followups`,
`fix/website-mobile-layout`, and `guillermo-feedback`.
