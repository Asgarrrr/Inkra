import { create } from "zustand";

const DISMISS_AFTER_MS = 4000;

interface EditorNoticeState {
  message: string | null;
  showNotice: (message: string) => void;
  dismissNotice: () => void;
}

// Bare timer globals, not `window.*`: the store is reachable from logic that
// runs under the test runner's `environment: "node"`.
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

/** Transient, self-dismissing notices shown over the editor: unresolved anchor
 *  links, rejected pastes, and similar "that didn't happen, here's why" cases. */
export const useEditorNoticeStore = create<EditorNoticeState>((set, get) => ({
  message: null,
  showNotice: (message) => {
    if (dismissTimer !== null) clearTimeout(dismissTimer);
    set({ message });
    dismissTimer = setTimeout(() => {
      dismissTimer = null;
      get().dismissNotice();
    }, DISMISS_AFTER_MS);
  },
  dismissNotice: () => {
    if (dismissTimer !== null) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    set({ message: null });
  },
}));

export function showEditorNotice(message: string) {
  useEditorNoticeStore.getState().showNotice(message);
}

export function dismissEditorNotice() {
  useEditorNoticeStore.getState().dismissNotice();
}
