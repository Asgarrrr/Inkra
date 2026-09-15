# Sidebar Sort Options

## Goal

Let the user choose how files are ordered in the sidebar's Everything tree from the sidebar's right-click menu, matching the six modes writers know from Obsidian: name A→Z / Z→A, modified time new→old / old→new, created time new→old / old→new.

## Behavior

- Right-click on empty sidebar space or a section header shows a "Sort files by" submenu with the six modes in three separated groups. Exactly one mode is checked; picking one applies immediately and persists.
- "Name" means whatever the sidebar displays for a file: the document title in the default label mode, the filename stem in `filename` mode. The menu never says "file name", and the sort key is always the label the row renders, so ordering and labels can't disagree.
- Only files move. Folders stay first and alphabetical in every mode. A folder's modified time changes when its contents are added, removed, or renamed, not when a file inside is edited, so sorting folders by time would reorder for reasons the user can't see.
- Time modes break ties (whole-second timestamps) by the name order, so the result is deterministic and matches name mode for files saved together.
- Saving a file in Writer updates the tree's copy of its modified time, so under a modified-time sort the file moves on save (not per keystroke, since the save path is throttled). It moves once and then stays put, because it is already the newest.
- The same setting appears as `Sidebar Sort` under Preferences → Appearance, since every enum setting renders there automatically.
- Recents and Pinned keep their own ordering; the file-browser palette is unaffected.

## Implementation Notes

- One registry, `sidebar-sort.ts`, owns the mode ids, menu labels, group boundaries, and the comparator. The context menu renders from it, `sortTreeEntries` sorts from it, and a test asserts its ids equal the `appearance.sidebar-sort` options in `settings.schema.json`, which stays the source of truth for the setting.
- `sortTreeEntries(items, fileLabelMode, sortMode)` compares folders by label and files by mode; an unknown or missing mode falls back to name so a stale setting value can never scramble the tree.
- `DirEntry` gains `created_at` from Rust, read via `Metadata::created()` with a fallback to the modified time on filesystems without a birth time, so created-time sorting degrades to modified-time sorting rather than collapsing to zero. Creation times are only as trustworthy as the filesystem: sync tools and `git checkout` can reset them.
- The watcher suppresses Writer's own saves, so the tree's cached `modified_at` would otherwise go stale. `write_file` already emitted `sidebar:metadata-changed` with the path; it now emits the whole `WriteResult`, and the frontend listener patches the cached entry through a new `updateEntryModifiedAt` store action. The patch is a no-op when the parent folder isn't cached or the timestamp is unchanged, so it allocates nothing on saves within the same second.
- The surface menu spec gains a `submenu` kind; the Tauri builder recurses into it and uses `CheckMenuItem` for the modes so the checkmark comes from the OS.

## Out of Scope

- Per-folder sort order (needs its own persistence).
- Manual reordering.
- Holding a re-sort while the tree is being dragged or range-selected. Time sorts only change on save, which is throttled, so this hasn't been needed.
