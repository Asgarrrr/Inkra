import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { useWorkspaceStore } from "../src/stores/workspace-store";
// Side-effect: registers the subscription that clears the sidebar tree's
// in-flight interaction whenever the workspace generation advances.
import { useSidebarTreeStore } from "../src/stores/sidebar-tree-store";

function bumpWorkspaceGeneration() {
  useWorkspaceStore.setState((state) => ({
    workspaceGeneration: state.workspaceGeneration + 1,
  }));
}

describe("sidebar tree store", () => {
  beforeEach(() => {
    useSidebarTreeStore.getState().reset();
  });

  test("holds the in-flight rename and collapse state", () => {
    useSidebarTreeStore.getState().setRenamingPath("/vault/note.md");
    useSidebarTreeStore.getState().setEverythingCollapsed(true);

    expect(useSidebarTreeStore.getState().renamingPath).toBe("/vault/note.md");
    expect(useSidebarTreeStore.getState().everythingCollapsed).toBe(true);
  });

  // The sidebar surface used to own this state in `useState` and was keyed on
  // `workspaceGeneration`, so switching workspaces remounted it and cleared
  // both values. Moving the state into a store removed that implicit reset;
  // this is the explicit replacement. Without it a rename started in the old
  // workspace stays armed against a path the new root has no row for.
  test("clears itself when the workspace generation advances", () => {
    useSidebarTreeStore.getState().setRenamingPath("/vault/note.md");
    useSidebarTreeStore.getState().setEverythingCollapsed(true);

    bumpWorkspaceGeneration();

    expect(useSidebarTreeStore.getState().renamingPath).toBeNull();
    expect(useSidebarTreeStore.getState().everythingCollapsed).toBe(false);
  });

  test("survives unrelated workspace updates", () => {
    useSidebarTreeStore.getState().setEverythingCollapsed(true);

    useWorkspaceStore.setState({ isIndexing: true });

    expect(useSidebarTreeStore.getState().everythingCollapsed).toBe(true);
  });
});
