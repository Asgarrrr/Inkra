import { describe, expect, test, vi } from "vitest";

// The Tauri menu modules pull in `@tauri-apps/api/core` at import time, so we
// stub them up front. The pure helper under test
// (`buildSidebarSurfaceMenuItemsSpec`) never touches these stubs.
vi.mock("@tauri-apps/api/menu/menu", () => ({ Menu: { new: vi.fn() } }));
vi.mock("@tauri-apps/api/menu/checkMenuItem", () => ({ CheckMenuItem: { new: vi.fn() } }));
vi.mock("@tauri-apps/api/menu/menuItem", () => ({ MenuItem: { new: vi.fn() } }));
vi.mock("@tauri-apps/api/menu/predefinedMenuItem", () => ({
  PredefinedMenuItem: { new: vi.fn() },
}));

import {
  buildSidebarSurfaceMenuItemsSpec,
  type SidebarSurfaceMenuState,
} from "../src/components/sidebar/sidebar-surface-context-menu";

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
          onNewFile: () => calls.push("new-file"),
          onNewFolder: () => calls.push("new-folder"),
          onOpenInTerminal: () => calls.push("open-terminal"),
          onOpenInFileManager: () => calls.push("open-file-manager"),
        }
      : null,
    onToggleSearch: (visible) => calls.push(`search:${visible}`),
    onToggleRecents: (visible) => calls.push(`recents:${visible}`),
  };
}

describe("buildSidebarSurfaceMenuItemsSpec", () => {
  test("lists workspace actions and visibility toggles in native menu order", () => {
    const spec = buildSidebarSurfaceMenuItemsSpec(makeState(true, false), "macos");

    expect(
      spec.map((entry) =>
        entry.kind === "separator"
          ? "---"
          : `${entry.kind}:${entry.id}:${entry.text}${entry.kind === "check" ? `:${entry.checked}` : ""}`,
      ),
    ).toEqual([
      "item:new-file:New File",
      "item:new-folder:New Folder",
      "---",
      "item:open-terminal:Open in Terminal",
      "item:open-file-manager:Open in Finder",
      "---",
      "check:toggle-search:Search:true",
      "check:toggle-recents:Recents:false",
    ]);
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
      if (entry.kind !== "separator") entry.action();
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
