import { useEffect } from "react";
import type { EditorView } from "@codemirror/view";
import { registerEditorView, unregisterEditorView } from "../editor-view-registry";
import { applyRegisteredViewTarget } from "../link-navigation";

/** Publishes a pane's live view so navigation can scroll it in place. Only the
 *  active pane registers: two tabs can hold the same file, and scrolling the
 *  hidden one reads as the click doing nothing. */
export function useRegisterEditorView(path: string, view: EditorView | null, isActive: boolean) {
  // isActive/view come from store state and a ref callback; no host event handler exists to carry the registration.
  /* eslint-disable react-doctor/no-event-handler */
  useEffect(() => {
    if (!view || !isActive) return;
    registerEditorView(path, view);
    applyRegisteredViewTarget(path, view);
    return () => unregisterEditorView(path, view);
  }, [path, view, isActive]);
  /* eslint-enable react-doctor/no-event-handler */
}
