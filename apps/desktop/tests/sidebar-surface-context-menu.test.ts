import { describe, expect, test, vi } from "vite-plus/test";

// The Tauri menu modules pull in `@tauri-apps/api/core` at import time, so we
// stub them up front. The pure helper under test
// (`buildSidebarSurfaceMenuItemsSpec`) never touches these stubs.
vi.mock("@tauri-apps/api/menu/menu", () => ({ Menu: { new: vi.fn() } }));
vi.mock("@tauri-apps/api/menu/checkMenuItem", () => ({ CheckMenuItem: { new: vi.fn() } }));
vi.mock("@tauri-apps/api/menu/menuItem", () => ({ MenuItem: { new: vi.fn() } }));
vi.mock("@tauri-apps/api/menu/predefinedMenuItem", () => ({
  PredefinedMenuItem: { new: vi.fn() },
}));
vi.mock("@tauri-apps/api/menu/submenu", () => ({ Submenu: { new: vi.fn() } }));

import {
  buildSidebarSurfaceMenuItemsSpec,
  type SidebarSurfaceMenuEntry,
  type SidebarSurfaceMenuState,
} from "../src/components/sidebar/sidebar-surface-context-menu";

function describeEntry(entry: SidebarSurfaceMenuEntry): string {
  switch (entry.kind) {
    case "separator":
      return "---";
    case "submenu":
      return `submenu:${entry.id}:${entry.text}`;
    case "check":
      return `check:${entry.id}:${entry.text}:${entry.checked}`;
    default:
      return `item:${entry.id}:${entry.text}`;
  }
}

function makeState(
  showSearch: boolean,
  showRecents: boolean,
  hasWorkspace = true,
): SidebarSurfaceMenuState & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    showSearch,
    showRecents,
    workspaceActions: hasWorkspace
      ? {
          sortMode: "modified-desc",
          foldersFirst: true,
          onNewFile: () => calls.push("new-file"),
          onNewFolder: () => calls.push("new-folder"),
          onOpenInTerminal: () => calls.push("open-terminal"),
          onOpenInFileManager: () => calls.push("open-file-manager"),
          onSortModeChange: (mode) => calls.push(`sort:${mode}`),
          onFoldersFirstChange: (value) => calls.push(`folders-first:${value}`),
        }
      : null,
    onToggleSearch: (visible) => calls.push(`search:${visible}`),
    onToggleRecents: (visible) => calls.push(`recents:${visible}`),
  };
}

describe("buildSidebarSurfaceMenuItemsSpec", () => {
  test("lists workspace actions and visibility toggles in native menu order", () => {
    const spec = buildSidebarSurfaceMenuItemsSpec(makeState(true, false), "macos");

    expect(spec.map(describeEntry)).toEqual([
      "item:new-file:New File",
      "item:new-folder:New Folder",
      "---",
      "item:open-terminal:Open in Terminal",
      "item:open-file-manager:Open in Finder",
      "---",
      "submenu:sort:Sort by",
      "---",
      "check:toggle-search:Search:true",
      "check:toggle-recents:Recents:false",
    ]);
  });

  test("the sort submenu checks the current mode, separates the groups, and ends with folders first", () => {
    const state = makeState(true, true);
    const spec = buildSidebarSurfaceMenuItemsSpec(state, "macos");
    const sort = spec.find((entry) => entry.kind === "submenu");
    if (sort?.kind !== "submenu") throw new Error("expected a sort submenu");

    expect(sort.items.map(describeEntry)).toEqual([
      "check:name-asc:Name (A to Z):false",
      "check:name-desc:Name (Z to A):false",
      "---",
      "check:modified-desc:Modified time (new to old):true",
      "check:modified-asc:Modified time (old to new):false",
      "---",
      "check:created-desc:Created time (new to old):false",
      "check:created-asc:Created time (old to new):false",
      "---",
      "check:folders-first:Folders first:true",
    ]);

    for (const entry of sort.items) if (entry.kind === "check") entry.action();
    expect(state.calls).toEqual([
      "sort:name-asc",
      "sort:name-desc",
      "sort:modified-desc",
      "sort:modified-asc",
      "sort:created-desc",
      "sort:created-asc",
      "folders-first:false",
    ]);
  });

  test("the folders first item reflects the setting and toggles it back on", () => {
    const state = makeState(true, true);
    if (state.workspaceActions) state.workspaceActions.foldersFirst = false;
    const spec = buildSidebarSurfaceMenuItemsSpec(state, "macos");
    const sort = spec.find((entry) => entry.kind === "submenu");
    if (sort?.kind !== "submenu") throw new Error("expected a sort submenu");
    const foldersFirst = sort.items.at(-1);
    if (foldersFirst?.kind !== "check") throw new Error("expected a folders-first check");

    expect(foldersFirst.checked).toBe(false);
    foldersFirst.action();
    expect(state.calls).toEqual(["folders-first:true"]);
  });

  test("omits workspace actions when no workspace is open", () => {
    const spec = buildSidebarSurfaceMenuItemsSpec(makeState(true, false, false), "windows");

    expect(spec.map((entry) => (entry.kind === "separator" ? "---" : entry.id))).toEqual([
      "toggle-search",
      "toggle-recents",
    ]);
  });

  test.each([
    ["macos", "Open in Finder"],
    ["windows", "Open in Explorer"],
    ["linux", "Open in File Manager"],
  ] as const)("uses the %s file-manager label", (platform, expected) => {
    const spec = buildSidebarSurfaceMenuItemsSpec(makeState(true, true), platform);
    const fileManager = spec.find(
      (entry) => entry.kind === "item" && entry.id === "open-file-manager",
    );
    expect(fileManager && fileManager.kind === "item" ? fileManager.text : undefined).toBe(
      expected,
    );
  });

  test("each entry invokes its matching handler", () => {
    const state = makeState(true, false);

    const spec = buildSidebarSurfaceMenuItemsSpec(state, "macos");
    for (const entry of spec) {
      if (entry.kind === "item" || entry.kind === "check") entry.action();
    }

    expect(state.calls).toEqual([
      "new-file",
      "new-folder",
      "open-terminal",
      "open-file-manager",
      "search:false",
      "recents:true",
    ]);
  });
});
