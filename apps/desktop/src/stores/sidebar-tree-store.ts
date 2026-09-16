import { create } from "zustand";
import { useWorkspaceStore } from "@/stores/workspace-store";

/**
 * Transient UI state for the sidebar's file tree: which row is being renamed
 * inline, and whether the `Everything` section is collapsed. Neither is
 * persisted — both describe an in-flight interaction, not a preference.
 *
 * This lives in a store rather than in `useSidebarSurface` because the two
 * consumers (`SidebarNavigator`, `FileTree`) sit three levels below it, and
 * `FileBrowser` in between has no use for either. Owning them here also lets
 * the surface context menu start a rename without a callback round-trip.
 */
interface SidebarTreeState {
  renamingPath: string | null;
  everythingCollapsed: boolean;

  setRenamingPath: (path: string | null) => void;
  setEverythingCollapsed: (collapsed: boolean) => void;
  /** Drop the in-flight interaction. Called when the workspace changes, where
   *  a surviving `renamingPath` would point at a file the new root has no row
   *  for. Previously implicit: the surface was keyed on `workspaceGeneration`
   *  and the remount reset both `useState` values. */
  reset: () => void;
}

export const useSidebarTreeStore = create<SidebarTreeState>((set) => ({
  renamingPath: null,
  everythingCollapsed: false,

  setRenamingPath: (path) => set({ renamingPath: path }),
  setEverythingCollapsed: (collapsed) => set({ everythingCollapsed: collapsed }),
  reset: () => set({ renamingPath: null, everythingCollapsed: false }),
}));

// The sidebar surface is keyed on `workspaceGeneration`, so a workspace change
// remounts it and clears the state it still owns (selection, page sizes). This
// subscription does the same for the state that moved into this store. It runs
// inside the workspace store's `set()`, ahead of the re-render, so the new
// workspace never paints one frame with the old workspace's collapse state.
//
// Unguarded by `typeof window`, unlike the subscriptions in `standalone-watch`
// and `global-recents`: this one reaches no browser API, and the guard would
// only make the reset untestable under the `node` test environment.
useWorkspaceStore.subscribe((state, prev) => {
  if (state.workspaceGeneration === prev.workspaceGeneration) return;
  useSidebarTreeStore.getState().reset();
});
