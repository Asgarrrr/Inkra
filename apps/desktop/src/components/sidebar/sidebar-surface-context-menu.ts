import { Menu } from "@tauri-apps/api/menu/menu";
import { CheckMenuItem } from "@tauri-apps/api/menu/checkMenuItem";
import { MenuItem } from "@tauri-apps/api/menu/menuItem";
import { PredefinedMenuItem } from "@tauri-apps/api/menu/predefinedMenuItem";
import { Submenu } from "@tauri-apps/api/menu/submenu";
import { detectPlatform, openFolderLabelForPlatform, type Platform } from "./context-menu-utils";
import { SIDEBAR_SORT_MODES, type SidebarSortMode } from "./sidebar-sort";

export type SidebarSurfaceToggleId = "toggle-search" | "toggle-recents" | "folders-first";
export type SidebarSurfaceActionId =
  | "new-file"
  | "new-folder"
  | "open-terminal"
  | "open-file-manager";

interface SidebarSurfaceWorkspaceActions {
  sortMode: SidebarSortMode;
  foldersFirst: boolean;
  onNewFile: () => void;
  onNewFolder: () => void;
  onOpenInTerminal: () => void;
  onOpenInFileManager: () => void;
  onSortModeChange: (mode: SidebarSortMode) => void;
  onFoldersFirstChange: (foldersFirst: boolean) => void;
}

export interface SidebarSurfaceMenuState {
  showSearch: boolean;
  showRecents: boolean;
  workspaceActions: SidebarSurfaceWorkspaceActions | null;
  onToggleSearch: (visible: boolean) => void;
  onToggleRecents: (visible: boolean) => void;
}

export type SidebarSurfaceMenuEntry =
  | {
      kind: "item";
      id: SidebarSurfaceActionId;
      text: string;
      action: () => void;
    }
  | {
      kind: "check";
      id: SidebarSurfaceToggleId | SidebarSortMode;
      text: string;
      checked: boolean;
      action: () => void;
    }
  | { kind: "submenu"; id: "sort"; text: string; items: SidebarSurfaceMenuEntry[] }
  | { kind: "separator" };

/**
 * The "Sort by" submenu: one check item per sort mode, exactly one checked,
 * with a separator between the name / modified / created groups, then the
 * independent "Folders first" toggle at the bottom.
 */
function buildSortSubmenu(actions: SidebarSurfaceWorkspaceActions): SidebarSurfaceMenuEntry {
  const items: SidebarSurfaceMenuEntry[] = [];
  let lastGroup: string | null = null;
  for (const mode of SIDEBAR_SORT_MODES) {
    if (lastGroup !== null && mode.group !== lastGroup) items.push({ kind: "separator" });
    lastGroup = mode.group;
    items.push({
      kind: "check",
      id: mode.id,
      text: mode.text,
      checked: mode.id === actions.sortMode,
      action: () => actions.onSortModeChange(mode.id),
    });
  }
  items.push(
    { kind: "separator" },
    {
      kind: "check",
      id: "folders-first",
      text: "Folders first",
      checked: actions.foldersFirst,
      action: () => actions.onFoldersFirstChange(!actions.foldersFirst),
    },
  );
  return { kind: "submenu", id: "sort", text: "Sort by", items };
}

/**
 * Build the sidebar surface menu shown on empty space and section headers.
 * Workspace actions precede the always-present visibility checks. Pulled out
 * from `showSidebarSurfaceContextMenu` so it can be tested without Tauri.
 */
export function buildSidebarSurfaceMenuItemsSpec(
  state: SidebarSurfaceMenuState,
  platform: Platform = detectPlatform(),
): SidebarSurfaceMenuEntry[] {
  const toggles: SidebarSurfaceMenuEntry[] = [
    {
      kind: "check",
      id: "toggle-search",
      text: "Search",
      checked: state.showSearch,
      action: () => state.onToggleSearch(!state.showSearch),
    },
    {
      kind: "check",
      id: "toggle-recents",
      text: "Recents",
      checked: state.showRecents,
      action: () => state.onToggleRecents(!state.showRecents),
    },
  ];

  if (!state.workspaceActions) return toggles;

  return [
    {
      kind: "item",
      id: "new-file",
      text: "New File",
      action: state.workspaceActions.onNewFile,
    },
    {
      kind: "item",
      id: "new-folder",
      text: "New Folder",
      action: state.workspaceActions.onNewFolder,
    },
    { kind: "separator" },
    {
      kind: "item",
      id: "open-terminal",
      text: "Open in Terminal",
      action: state.workspaceActions.onOpenInTerminal,
    },
    {
      kind: "item",
      id: "open-file-manager",
      text: openFolderLabelForPlatform(platform),
      action: state.workspaceActions.onOpenInFileManager,
    },
    { kind: "separator" },
    buildSortSubmenu(state.workspaceActions),
    { kind: "separator" },
    ...toggles,
  ];
}

async function buildMenuItems(
  spec: SidebarSurfaceMenuEntry[],
): Promise<Array<MenuItem | CheckMenuItem | PredefinedMenuItem | Submenu>> {
  return Promise.all(
    spec.map(async (entry) => {
      if (entry.kind === "separator") {
        return PredefinedMenuItem.new({ item: "Separator" });
      }
      if (entry.kind === "submenu") {
        const items = await buildMenuItems(entry.items);
        return Submenu.new({ id: entry.id, text: entry.text, items });
      }
      if (entry.kind === "check") {
        return CheckMenuItem.new({
          id: entry.id,
          text: entry.text,
          checked: entry.checked,
          action: entry.action,
        });
      }
      return MenuItem.new({ id: entry.id, text: entry.text, action: entry.action });
    }),
  );
}

/**
 * Build a Tauri native menu of check items and pop it up at the cursor.
 * The menu dismisses through the OS, not via JS.
 */
export async function showSidebarSurfaceContextMenu(state: SidebarSurfaceMenuState): Promise<void> {
  const items = await buildMenuItems(buildSidebarSurfaceMenuItemsSpec(state));
  const menu = await Menu.new({ items });
  await menu.popup();
}
