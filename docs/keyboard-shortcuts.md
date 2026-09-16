# Keyboard Shortcuts

Canonical shortcut reference for Inkra.

## Global

These shortcuts are handled by the global `useKeyboardShortcuts` hook and work regardless of editor focus.

| Shortcut        | Action                                                             |
| --------------- | ------------------------------------------------------------------ |
| Cmd+P           | Search (command palette), needs a workspace                        |
| Cmd+Shift+P     | Search (the same palette), always                                  |
| Cmd+Shift+F     | Search (the same palette), needs a workspace                       |
| Cmd+O           | Go to file                                                         |
| Cmd+N           | Create new note                                                    |
| Cmd+T           | New tab                                                            |
| Cmd+W           | Close current tab; hides the window when only the launcher is left |
| Cmd+\\          | Toggle sidebar                                                     |
| Ctrl+Tab        | Next tab                                                           |
| Ctrl+Shift+Tab  | Previous tab                                                       |
| Cmd+1 ... Cmd+9 | Jump to Nth tab                                                    |
| Alt+ArrowLeft   | Navigate back                                                      |
| Alt+ArrowRight  | Navigate forward                                                   |

In compact single-file windows, sidebar and tab-management shortcuts do not
create hidden UI state: Cmd+\\, Cmd+T, Ctrl+Tab, Ctrl+Shift+Tab, and Cmd+1 ...
Cmd+9 are ignored. A compact window also has no workspace, so Cmd+P,
Cmd+Shift+F, Cmd+O and Cmd+N do nothing there; Cmd+Shift+P is the shortcut that
opens the palette, and it searches recent files only, never document content.
History navigation still works.

## Menu Accelerators

These shortcuts are bound to the native app menu (Tauri menu accelerators) rather than the global JS handler.

| Shortcut | Action                                                |
| -------- | ----------------------------------------------------- |
| Cmd+,    | Open Preferences (Settings tab) in the focused window |

## Editor Formatting

These shortcuts are handled by the `markdownFormatting` CodeMirror extension and only apply when the editor is focused.

| Shortcut                | Action                    |
| ----------------------- | ------------------------- |
| Cmd+B                   | Bold                      |
| Cmd+I                   | Italic                    |
| Cmd+K                   | Insert link               |
| Cmd+E                   | Inline code               |
| Cmd+Shift+X             | Strikethrough             |
| Cmd+Shift+8             | Bullet list               |
| Cmd+Shift+7             | Numbered list             |
| Cmd+Shift+.             | Blockquote                |
| Cmd+Shift+Enter         | Task list                 |
| Cmd+Alt+1 ... Cmd+Alt+6 | Heading 1-6               |
| Cmd+Alt+0               | Paragraph (strip heading) |

## Editor (inherited from CodeMirror)

Standard editing shortcuts provided by CodeMirror's basic setup.

| Shortcut             | Action                         |
| -------------------- | ------------------------------ |
| Cmd+Z                | Undo                           |
| Cmd+Shift+Z          | Redo                           |
| Cmd+A                | Select all                     |
| Cmd+D                | Select next occurrence         |
| Alt+ArrowUp          | Move line up                   |
| Alt+ArrowDown        | Move line down                 |
| Alt+Shift+ArrowUp    | Copy line up                   |
| Alt+Shift+ArrowDown  | Copy line down                 |
| Cmd+Shift+K          | Delete line                    |
| Cmd+Enter            | Insert line below              |
| Cmd+Shift+Enter      | Insert line above              |
| Tab                  | Indent / accept completion     |
| Shift+Tab            | Dedent                         |
| Cmd+]                | Indent more                    |
| Cmd+[                | Indent less                    |
| Cmd+F                | Find                           |
| Cmd+H                | Find and replace               |
| Cmd+G                | Find next                      |
| Cmd+Shift+G          | Find previous                  |
| Escape               | Close find                     |
| Alt+Shift+ArrowLeft  | Extend selection by word left  |
| Alt+Shift+ArrowRight | Extend selection by word right |
