Writer indexes file names and searches them well, but it cannot search what is
inside the documents. For an app aimed at Obsidian vaults and docs repos, that
is the gap you feel first: a note you remember the content of but not the name
of is unreachable.

`Cmd+P` — or the new `Cmd+Shift+F`, which opens the same palette — now lists an
**In documents** group under the commands and file names: the matching lines,
highlighted, grouped by file, with their line numbers, ranked by relevance.
Selecting one opens the file, scrolls to the line, and flashes the words that
matched. Plain words look for files containing all of them, close together; a
`/` prefix searches for that exact string instead. Smart case in both modes.
Content scanning starts at three characters, so jumping to a file by name stays
as instant as it was.

Spec is `SPECs/fuzzy-search-grep-spec.md`, execution plan and the reasoning
behind each slice is `SPECs/fuzzy-search-grep-plan.md`.

## Decisions worth knowing before reading the diff

Fuzzy matching is **file-level**: all tokens somewhere in the file, ranked by
how close together they are. Per-line matching was the first design and it
returns nothing for `channels throughput` the moment the first token is a
heading and the second is the paragraph under it — or for any prose wrapped at
80 columns.

Line numbers are **relative to the document body**, frontmatter excluded,
because the editor never holds the frontmatter: `frontmatter.ts` strips the
block and its delimiters before the document reaches CodeMirror. A raw file line
number lands `frontmatter_lines + 2` too low and throws outright at the end of a
file. The Rust side mirrors `FRONTMATTER_RE` exactly, including its lack of
`\r\n` support, and splits lines the way CodeMirror's `DefaultSplit` does — a
lone `\r` would otherwise shift every later line number in a way that stays in
range and is silently wrong.

Offsets travel as **codepoints**, never bytes and never UTF-16 indices. One
accent shifts a highlight by one, one emoji by two.

There is **one search surface**. The plan originally had a second palette for
content; that was dropped mid-way. `Cmd+Shift+F` opens the same palette as
`Cmd+P`, with the same behaviour.

## Verifying

```
cd apps/desktop           && vp check   → 0 errors, 1 warning (pre-existing, e2e/wdio.conf.js)
cd apps/desktop           && vp test    → 697 passed
cd apps/desktop/src-tauri && cargo test → 207 passed
cd apps/desktop/e2e       && pnpm exec wdio run ./wdio.conf.js --spec ./specs/content-search.spec.js
                                        → 13 scenarios
```

The e2e bundle only builds through `e2e/package.json`'s `build:app`. A bare
`cargo tauri build` produces an app with no WebDriver plugin — which surfaces as
a session-creation timeout rather than as a missing feature — and overwrites the
good bundle on its way.

Most of the diff is tests, and deliberately so: the render layer is out of the
node runner's reach, so everything decidable was pulled into pure modules and
the rest is covered by the e2e spec, which went from 6 scenarios to 13.

One commit per slice, readable in order: dependencies, the Rust scan and
ranking, the streamed command and transport, the palette, the pending-target
carrier plus the navigation fixes it exposed, the line jump, the flash. The
`ignore` bump is the first commit and can be reverted on its own.

## Risk and rollback

The scan reads the disk, the user reads their buffer: a phrase you just typed is
findable once the file is saved. Recorded in the spec.

One scan in flight per window, cancelled cooperatively by a generation counter.
Tauri has no first-class cancellation, and `Channel::send` is fire-and-forget —
the generation is the only stop signal that survives a destroyed webview, so the
error path cannot be relied on for it.

Not in scope, by the spec: regex, search-and-replace, non-markdown files, an
inverted index, unsaved buffers, and a case toggle in the UI.

To roll back, revert the slice commit. The last two slices are additive: without
the flash the jump still works, without the jump the file still opens.

## What is not measured: behaviour at scale

This has never run on anything larger than a test vault, and that is the main
thing I would want a second opinion on.

The scan is sequential and reads every file in the index, stopping early only
when a cap is hit (`total_cap` 500, `per_file_cap` 10, `max_bytes` 2 MiB per
file). A frequent token hits the cap quickly and returns; a rare one forces a
full walk, which is both the worst case and a real usage pattern. The index is
also cloned per invocation — measured at roughly 186 bytes per entry during
slice 2, so about 3 MB at 20k files, and by the same arithmetic about 186 MB at
a million, which nobody has checked.

Characterizing it properly needs a synthetic vault generator and a run across
1k / 10k / 100k / 1M files in release, on four query shapes, reporting
time-to-first-batch rather than just total time. That is a separate PR; it is
characterization work, and the harness is worth keeping for the next change to
the scan. Tracked in `TODOS.md`.

## Known follow-ups

`e2e/specs/latex-math.spec.js` fails all four of its scenarios. Pre-existing and
unrelated — verified identical on `master` with this branch stashed and the
bundle rebuilt. Tracked in `TODOS.md`.

`prefers-reduced-motion` is not proven end to end for the flash. The CSS rule and
the resting colour are measured; getting the media query to match from the
WebDriver harness did not work on this machine.

`@tauri-apps/api` resolves to 2.10.1 against the `tauri` crate at 2.11.2, both
declared `^2`. tauri-cli 2.11.4 treats that as a build error; I worked around it
with `--ignore-version-mismatches` rather than touch the lockfile. A `vp install`
closes it, but it deserves its own commit.
