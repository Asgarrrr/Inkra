import type { EditorView } from "@codemirror/view";

// Keyed by path, not by pane: file tabs are `keepAlive`, so several mounted
// panes can hold the same path. Only the active one registers, and the others
// must not drop its entry when they unmount — hence the identity check.
const views = new Map<string, EditorView>();

export function registerEditorView(path: string, view: EditorView): void {
  views.set(path, view);
}

export function unregisterEditorView(path: string, view: EditorView): void {
  if (views.get(path) === view) views.delete(path);
}

export function getEditorView(path: string): EditorView | undefined {
  return views.get(path);
}
