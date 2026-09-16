import { memo, useEffect, useRef, type MouseEvent, type PointerEvent } from "react";
import { useIsActive } from "@/hooks/use-tabs";
import { getFileStem } from "@/lib/paths";
import type { DirEntry } from "@/types/fs";
import { FileIcon, FolderIcon } from "./file-tree-icons";
import { FileTreeRow } from "./file-tree-row";

interface FileTreeNodeProps {
  entry: DirEntry;
  depth: number;
  isExpanded: boolean;
  isRenaming: boolean;
  isSelected: boolean;
  /** Dimmed because it is part of the active drag. */
  isDragging?: boolean;
  /** Required: the tree owns selection, so every click goes to the parent,
   *  which then decides whether to also open or toggle. */
  onClick: (event: MouseEvent<HTMLElement>, entry: DirEntry) => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>, entry: DirEntry) => void;
  onPointerDown?: (event: PointerEvent<HTMLElement>, entry: DirEntry) => void;
  onRenameSubmit?: (entry: DirEntry, nextStem: string) => void;
  onRenameCancel?: () => void;
  fileLabelMode?: string;
}

/**
 * A row of the `Everything` tree: nests, expands, takes part in multi-select
 * and drag, and swaps to an inline input while being renamed. The flat
 * Pinned/Recents lists use `FileRow` instead — same row, none of this.
 */
export const FileTreeNode = memo(function FileTreeNode({
  entry,
  depth,
  isExpanded,
  isRenaming,
  isSelected,
  isDragging,
  onClick,
  onContextMenu,
  onPointerDown,
  onRenameSubmit,
  onRenameCancel,
  fileLabelMode,
}: FileTreeNodeProps) {
  const isActive = useIsActive(entry.path);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus and select the stem when entering rename mode.
  useEffect(() => {
    if (!isRenaming) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [isRenaming]);

  if (isRenaming) {
    // Directories show the full name; files show only the stem (extension is appended on submit).
    const initialValue = entry.is_dir ? entry.name : getFileStem(entry.name);
    return (
      <div
        onContextMenu={(event) => event.stopPropagation()}
        className={`flex h-[32px] w-full items-center gap-1.5 overflow-hidden rounded-lg pr-2 text-[13px] leading-[1.15] ${
          isActive ? "bg-[var(--surface-subtle)]" : ""
        }`}
        style={{ paddingLeft: depth === 0 ? 10 : depth * 12 + 6 }}
      >
        <span
          className="flex w-5 antialiased shrink-0 items-center justify-center text-current"
          aria-hidden="true"
        >
          {entry.is_dir ? <FolderIcon isExpanded={isExpanded} /> : <FileIcon />}
        </span>
        <input
          ref={inputRef}
          type="text"
          defaultValue={initialValue}
          aria-label={`Rename ${entry.name}`}
          className="min-w-0 flex-1 rounded border border-[var(--surface-border)] bg-[var(--surface-elevated)] px-1 py-px text-[13px] leading-[1.15] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onRenameSubmit?.(entry, event.currentTarget.value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onRenameCancel?.();
            }
          }}
          onBlur={(event) => onRenameSubmit?.(entry, event.currentTarget.value)}
        />
      </div>
    );
  }

  return (
    <FileTreeRow
      entry={entry}
      depth={depth}
      isExpanded={isExpanded}
      isSelected={isSelected}
      isDragging={isDragging ?? false}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      fileLabelMode={fileLabelMode}
    />
  );
});
