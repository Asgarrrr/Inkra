import { useResolvedDocumentTitle } from "@/hooks/use-tabs";
import { getFileStem } from "@/lib/paths";
import type { DirEntry } from "@/types/fs";

/**
 * The persisted label for a file-tree entry, honoring `appearance.sidebar-file-label`:
 * folders show their name; files show the filename stem in `"filename"` mode,
 * otherwise the title read from disk with a stem fallback. This is the key the
 * tree sorts by, so ordering and labels never disagree.
 */
export function fileTreeLabel(entry: DirEntry, fileLabelMode?: string): string {
  if (entry.is_dir) return entry.name;
  if (fileLabelMode === "filename") return getFileStem(entry.name);
  return entry.title || getFileStem(entry.name);
}

/**
 * The label shown for a file-tree entry. Same as {@link fileTreeLabel}, except an
 * open document's live editor title wins while it is being edited, so the row
 * tracks the heading as the user types. Shared by the tree rows and the drag
 * ghost so they always display the same text.
 */
export function useFileTreeLabel(entry: DirEntry, fileLabelMode?: string): string {
  const editorTitle = useResolvedDocumentTitle(entry.is_dir ? null : entry.path);
  if (entry.is_dir) return entry.name;
  if (fileLabelMode === "filename") return getFileStem(entry.name);
  return editorTitle || fileTreeLabel(entry, fileLabelMode);
}
