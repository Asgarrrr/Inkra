import type { DirEntry } from "@/types/fs";
import { sortTreeEntries } from "./sidebar-sort";

export { sortTreeEntries } from "./sidebar-sort";

export interface FlatTreeItem {
  entry: DirEntry;
  depth: number;
}

export function flattenTree(
  items: DirEntry[],
  depth: number,
  directoryCache: Map<string, DirEntry[]>,
  expandedDirs: Set<string>,
  fileLabelMode?: string,
  sortMode?: string,
  result: FlatTreeItem[] = [],
): FlatTreeItem[] {
  for (const entry of sortTreeEntries(items, fileLabelMode, sortMode)) {
    result.push({ entry, depth });
    if (entry.is_dir && expandedDirs.has(entry.path)) {
      flattenTree(
        directoryCache.get(entry.path) ?? [],
        depth + 1,
        directoryCache,
        expandedDirs,
        fileLabelMode,
        sortMode,
        result,
      );
    }
  }
  return result;
}
