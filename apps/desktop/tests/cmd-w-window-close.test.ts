import { describe, expect, test } from "vite-plus/test";
import { shouldCloseWindowOnCmdW } from "../src/hooks/use-keyboard-shortcuts";
import type { Tab } from "../src/stores/editor-store";

function launcherTab(id = "t1"): Tab {
  return { id, location: { kind: "launcher" }, back: [], forward: [] };
}

function fileTab(id = "t2"): Tab {
  return { id, location: { kind: "file", path: "/ws/note.md" }, back: [], forward: [] };
}

describe("shouldCloseWindowOnCmdW", () => {
  test("closes the window when the launcher is the only tab on macOS", () => {
    expect(shouldCloseWindowOnCmdW([launcherTab()], "macos")).toBe(true);
  });

  test("closes a tab instead when a file tab is still open", () => {
    expect(shouldCloseWindowOnCmdW([launcherTab(), fileTab()], "macos")).toBe(false);
  });

  test("closes a tab instead when the one tab is not the launcher", () => {
    expect(shouldCloseWindowOnCmdW([fileTab()], "macos")).toBe(false);
  });

  // Off macOS the Rust close-requested handler is compiled out, so the close
  // destroys the last window and quits the app. Cmd+W must stay a tab close.
  test("never closes the window off macOS", () => {
    expect(shouldCloseWindowOnCmdW([launcherTab()], "windows")).toBe(false);
    expect(shouldCloseWindowOnCmdW([launcherTab()], "linux")).toBe(false);
  });

  test("does not close the window with no tabs at all", () => {
    expect(shouldCloseWindowOnCmdW([], "macos")).toBe(false);
  });
});
