import type { DirEntry } from "@/types/fs";
import { fileTreeLabel } from "./use-file-tree-label";

export interface FlatTreeItem {
  entry: DirEntry;
  depth: number;
}

/** Natural, case- and accent-insensitive ordering ("file2" before "file10"). */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Order a directory's entries the way the tree displays them: folders first,
 * then files, each group A–Z by its visible label. The backend sorts by raw
 * filename, which drifts from the label once titles are shown, so the tree
 * re-sorts by the same label function it renders with. Returns a new array;
 * the cached array from the store is never mutated.
 */
export function sortTreeEntries(items: DirEntry[], fileLabelMode?: string): DirEntry[] {
  return items
    .map((entry) => ({ entry, label: fileTreeLabel(entry, fileLabelMode) }))
    .sort(
      (a, b) =>
        Number(b.entry.is_dir) - Number(a.entry.is_dir) ||
        collator.compare(a.label, b.label) ||
        collator.compare(a.entry.name, b.entry.name),
    )
    .map(({ entry }) => entry);
}

export function flattenTree(
  items: DirEntry[],
  depth: number,
  directoryCache: Map<string, DirEntry[]>,
  expandedDirs: Set<string>,
  fileLabelMode?: string,
  result: FlatTreeItem[] = [],
): FlatTreeItem[] {
  for (const entry of sortTreeEntries(items, fileLabelMode)) {
    result.push({ entry, depth });
    if (entry.is_dir && expandedDirs.has(entry.path)) {
      flattenTree(
        directoryCache.get(entry.path) ?? [],
        depth + 1,
        directoryCache,
        expandedDirs,
        fileLabelMode,
        result,
      );
    }
  }
  return result;
}
