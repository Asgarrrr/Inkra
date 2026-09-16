import type { DirEntry } from "@/types/fs";
import { fileTreeLabel } from "./use-file-tree-label";

/**
 * Registry of the sidebar's file sort modes. The ids are the values of the
 * `appearance.sidebar-sort` setting (the schema lists the same ids, and a test
 * keeps the two in step); `text` is the menu label; `group` clusters the menu
 * into name / modified / created sections. With folders first (the default)
 * folders are never sorted by these modes: they stay above the files and
 * alphabetical so only files move when the mode changes. With folders first
 * off, every entry is ordered by the mode, like `ls`.
 */
export const SIDEBAR_SORT_MODES = [
  { id: "name-asc", text: "Name (A to Z)", group: "name" },
  { id: "name-desc", text: "Name (Z to A)", group: "name" },
  { id: "modified-desc", text: "Modified time (new to old)", group: "modified" },
  { id: "modified-asc", text: "Modified time (old to new)", group: "modified" },
  { id: "created-desc", text: "Created time (new to old)", group: "created" },
  { id: "created-asc", text: "Created time (old to new)", group: "created" },
] as const;

export type SidebarSortMode = (typeof SIDEBAR_SORT_MODES)[number]["id"];

export const DEFAULT_SIDEBAR_SORT_MODE: SidebarSortMode = "name-asc";

export function isSidebarSortMode(value: unknown): value is SidebarSortMode {
  return SIDEBAR_SORT_MODES.some((mode) => mode.id === value);
}

/** Natural, case- and accent-insensitive ordering ("file2" before "file10"). */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

interface KeyedEntry {
  entry: DirEntry;
  label: string;
}

function byLabel(a: KeyedEntry, b: KeyedEntry): number {
  return collator.compare(a.label, b.label) || collator.compare(a.entry.name, b.entry.name);
}

/**
 * Comparator for two entries under `mode`. Time modes fall back to the name
 * order on equal timestamps (whole seconds), so the result is deterministic
 * and matches what the user sees in name mode. Unknown or missing modes sort
 * by name so a stale or mistyped setting value can never scramble the tree.
 */
function compareByMode(mode: string | undefined, a: KeyedEntry, b: KeyedEntry): number {
  switch (mode) {
    case "name-desc":
      return byLabel(b, a);
    case "modified-desc":
      return b.entry.modified_at - a.entry.modified_at || byLabel(a, b);
    case "modified-asc":
      return a.entry.modified_at - b.entry.modified_at || byLabel(a, b);
    case "created-desc":
      return b.entry.created_at - a.entry.created_at || byLabel(a, b);
    case "created-asc":
      return a.entry.created_at - b.entry.created_at || byLabel(a, b);
    default:
      return byLabel(a, b);
  }
}

/**
 * Order a directory's entries the way the tree displays them. With
 * `foldersFirst` (the default): folders first, A–Z by name, then files by
 * `sortMode`. Without it: folders and files together by `sortMode`. "Name"
 * means the visible label (title or filename stem per `fileLabelMode`). The
 * backend sorts by raw filename, which drifts from the label once titles are
 * shown, so the tree re-sorts by the same label function it renders with.
 * Returns a new array; the cached array from the store is never mutated.
 */
export function sortTreeEntries(
  items: DirEntry[],
  fileLabelMode?: string,
  sortMode?: string,
  foldersFirst = true,
): DirEntry[] {
  return items
    .map((entry) => ({ entry, label: fileTreeLabel(entry, fileLabelMode) }))
    .sort((a, b) => {
      if (!foldersFirst) return compareByMode(sortMode, a, b);
      const folderFirst = Number(b.entry.is_dir) - Number(a.entry.is_dir);
      if (folderFirst !== 0) return folderFirst;
      return a.entry.is_dir ? byLabel(a, b) : compareByMode(sortMode, a, b);
    })
    .map(({ entry }) => entry);
}
