import { memo, type MouseEvent, type PointerEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { useIsActive } from "@/hooks/use-tabs";
import type { DirEntry } from "@/types/fs";
import { FileIcon, FolderIcon } from "./file-tree-icons";
import { useFileTreeLabel } from "./use-file-tree-label";

export interface FileTreeRowProps {
  entry: DirEntry;
  depth: number;
  /** Only read for directories — files have no disclosure control. */
  isExpanded: boolean;
  isSelected: boolean;
  /** Dimmed because it is part of the active drag. */
  isDragging: boolean;
  onClick: (event: MouseEvent<HTMLElement>, entry: DirEntry) => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>, entry: DirEntry) => void;
  onPointerDown?: (event: PointerEvent<HTMLElement>, entry: DirEntry) => void;
  /** Tree-wide label mode from `appearance.sidebar-file-label`. `"filename"`
   *  shows the file stem; anything else (incl. `undefined` pre-hydration)
   *  shows the document title, falling back to the stem. */
  fileLabelMode?: string;
}

/**
 * The row itself, shared by the two places the sidebar lists entries: the
 * `Everything` tree (`FileTreeNode`) and the flat Pinned/Recents lists
 * (`FileRow`). Presentational — every decision about what a click means
 * belongs to the variant that owns it.
 */
export const FileTreeRow = memo(function FileTreeRow({
  entry,
  depth,
  isExpanded,
  isSelected,
  isDragging,
  onClick,
  onContextMenu,
  onPointerDown,
  fileLabelMode,
}: FileTreeRowProps) {
  const isActive = useIsActive(entry.path);
  const displayName = useFileTreeLabel(entry, fileLabelMode);
  const isHighlighted = isActive || isSelected;

  function handleContextMenu(event: MouseEvent<HTMLElement>) {
    if (!entry.is_dir && !entry.is_markdown) return;
    if (!onContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    onContextMenu(event, entry);
  }

  const bgClassName = isSelected
    ? "bg-[var(--surface-selected)]"
    : isActive
      ? "bg-[var(--surface-subtle)]"
      : "hover:bg-[var(--surface-subtle)]";

  return (
    <button
      type="button"
      role="treeitem"
      data-tree-path={entry.path}
      aria-selected={isActive}
      aria-expanded={entry.is_dir ? isExpanded : undefined}
      aria-label={entry.is_dir ? `${entry.name} folder` : displayName}
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={onPointerDown ? (event) => onPointerDown(event, entry) : undefined}
      onClick={(event) => onClick(event, entry)}
      onContextMenu={handleContextMenu}
      className={`group ${entry.is_dir ? "group/folder " : ""}flex h-[32px] w-full items-center gap-1.5 overflow-hidden rounded-lg pr-2 text-left text-[13px] leading-[1.15] text-[var(--fg-base)] ${isDragging ? "opacity-40" : ""} ${bgClassName}`}
      style={{ paddingLeft: depth === 0 ? 10 : depth * 12 + 6 }}
    >
      <span className="relative flex w-5 shrink-0 items-center justify-center">
        {entry.is_dir ? (
          <>
            <span className="flex items-center justify-center opacity-60 group-hover:opacity-100 group-hover/folder:opacity-0">
              <FolderIcon isExpanded={isExpanded} />
            </span>
            <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/folder:opacity-100">
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={16}
                color="currentColor"
                strokeWidth={2}
                className={`transition-transform duration-200 ease-out ${isExpanded ? "rotate-90" : ""}`}
              />
            </span>
          </>
        ) : (
          <span className="opacity-60 group-hover:opacity-100">
            <FileIcon />
          </span>
        )}
      </span>
      <span
        className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${isHighlighted ? "opacity-100" : "opacity-60 group-hover:opacity-100"}`}
      >
        {displayName}
      </span>
    </button>
  );
});
