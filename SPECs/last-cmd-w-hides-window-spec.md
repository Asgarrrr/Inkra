# Last Cmd+W Hides the Window

## Goal

Cmd+W when only the launcher tab is left should put the window away instead of doing nothing visible. The window is hidden, not destroyed, so the app stays running the macOS way and a Dock click brings it straight back with its workspace and tabs intact.

## Behavior

- Cmd+W with any tab other than a lone launcher (file tabs, the Settings tab, extra launcher tabs) closes the active tab, as before.
- Cmd+W when the launcher is the only tab left requests a window close. Closing that tab would only recreate it.
- A close request on the main window (Cmd+W, the red traffic light, Window → Close) hides it. Secondary workspace windows and standalone file windows still close for real.
- Clicking the Dock icon with no visible window shows the main window again.
- Opening a file or workspace from Finder, the Dock menu, or a second `writer` launch while the main window is hidden reveals it when the open lands in that window. Opens routed to a new window leave the hidden one alone.
- Compact single-file windows are unchanged: Cmd+W falls through to the native Close Window item, which now hides the main window and closes any other.

## Implementation Notes

- The decision to hide lives in one place: the main window's close-requested handler in `lib.rs` (`attach_window_handlers`). It is compiled for macOS only; on other platforms there is no Dock to bring a hidden window back, so a close stays a close. The frontend only asks for a close via `getCurrentWindow().close()`, which needs `core:window:allow-close`.
- `RunEvent::Reopen { has_visible_windows: false }` shows and focuses the main window. It can only ever be hidden, never destroyed, so it always exists.
- Every "focus the existing window" path (`open_new_workspace_window`, `open_standalone_file_window`, single-instance relaunch, the `RunEvent::Opened` standalone match) goes through `reveal_window`, since `set_focus` does nothing on a hidden window.
- `handleOpenPayload` now reports whether the open landed in this window; the runtime drainer calls `showMainWindow` in that case. Runtime opens only run after startup has resolved and shown the window once, so this never reveals a half-hydrated window.
- A hidden main window keeps its webview and file watcher alive until Cmd+Q. That is idle cost only and matches standard macOS document-app behavior.
