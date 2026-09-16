import { useSidebarTreeStore } from "@/stores/sidebar-tree-store";

export function useRenamingPath() {
  return useSidebarTreeStore((state) => state.renamingPath);
}

export function useSetRenamingPath() {
  return useSidebarTreeStore((state) => state.setRenamingPath);
}

export function useEverythingCollapsed() {
  return useSidebarTreeStore((state) => state.everythingCollapsed);
}

export function useSetEverythingCollapsed() {
  return useSidebarTreeStore((state) => state.setEverythingCollapsed);
}

/** Imperative entry points for non-React callers (context-menu actions). */
export function startRenaming(path: string | null) {
  useSidebarTreeStore.getState().setRenamingPath(path);
}

export function expandEverything() {
  useSidebarTreeStore.getState().setEverythingCollapsed(false);
}

export function resetSidebarTreeState() {
  useSidebarTreeStore.getState().reset();
}
