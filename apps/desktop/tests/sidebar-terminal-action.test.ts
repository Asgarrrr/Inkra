import { describe, expect, test, vi } from "vitest";
import {
  createFolderTerminalAction,
  openSidebarDirectoryInTerminal,
} from "../src/components/sidebar/sidebar-terminal-action";

describe("openSidebarDirectoryInTerminal", () => {
  test("forwards the selected folder path exactly", async () => {
    const openDirectory = vi.fn().mockResolvedValue(undefined);

    await openSidebarDirectoryInTerminal("/workspace/drafts/chapter one", {
      openDirectory,
      showError: vi.fn(),
    });

    expect(openDirectory).toHaveBeenCalledTimes(1);
    expect(openDirectory).toHaveBeenCalledWith("/workspace/drafts/chapter one");
  });

  test("binds the folder-row handler to its entry path", async () => {
    const openDirectory = vi.fn().mockResolvedValue(undefined);
    const action = createFolderTerminalAction(
      { path: "/workspace/selected-folder" },
      { openDirectory, showError: vi.fn() },
    );

    action();
    await vi.waitFor(() => expect(openDirectory).toHaveBeenCalledTimes(1));

    expect(openDirectory).toHaveBeenCalledWith("/workspace/selected-folder");
  });

  test("uses null to request the workspace root", async () => {
    const openDirectory = vi.fn().mockResolvedValue(undefined);

    await openSidebarDirectoryInTerminal(null, {
      openDirectory,
      showError: vi.fn(),
    });

    expect(openDirectory).toHaveBeenCalledWith(null);
  });

  test("surfaces launch failures through the shared terminal message", async () => {
    const showError = vi.fn();

    await openSidebarDirectoryInTerminal("/workspace/stale", {
      openDirectory: vi.fn().mockRejectedValue(new Error("folder is no longer available")),
      showError,
    });

    expect(showError).toHaveBeenCalledWith(
      "Failed to open terminal: folder is no longer available",
    );
  });
});
