import { memo, type MouseEvent } from "react";
import type { DirEntry } from "@/types/fs";
import { FileTreeRow } from "./file-tree-row";

interface FileRowProps {
  entry: DirEntry;
  onOpenFile: (path: string) => Promise<void>;
  onContextMenu?: (event: MouseEvent<HTMLElement>, entry: DirEntry) => void;
  fileLabelMode?: string;
}

/**
 * A row of the flat Pinned and Recents lists. Entries there are files at a
 * single level, so there is nothing to nest, expand, select or drag — a click
 * opens the file and that is the whole interaction. The `Everything` tree uses
 * `FileTreeNode` instead.
 */
export const FileRow = memo(function FileRow({
  entry,
  onOpenFile,
  onContextMenu,
  fileLabelMode,
}: FileRowProps) {
  return (
    <FileTreeRow
      entry={entry}
      depth={0}
      isExpanded={false}
      isSelected={false}
      isDragging={false}
      onClick={() => void onOpenFile(entry.path)}
      onContextMenu={onContextMenu}
      fileLabelMode={fileLabelMode}
    />
  );
});
