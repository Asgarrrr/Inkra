import { describe, expect, test, vi } from "vitest";
import { createSidebarEntryAndRename } from "../src/components/sidebar/create-sidebar-entry-and-rename";

describe("createSidebarEntryAndRename", () => {
  test("expands Everything, creates, refreshes, then starts inline rename", async () => {
    const calls: string[] = [];

    await createSidebarEntryAndRename("file", {
      expandParent: () => {
        calls.push("expand");
      },
      createEntry: vi.fn(async (kind) => {
        calls.push(`create:${kind}`);
        return { path: "/workspace/Untitled.md" };
      }),
      refreshRoot: vi.fn(async () => {
        calls.push("refresh");
      }),
      startRenaming: (path) => calls.push(`rename:${path}`),
      isCurrentWorkspace: () => true,
    });

    expect(calls).toEqual(["expand", "create:file", "refresh", "rename:/workspace/Untitled.md"]);
  });

  test("does not enter rename when creation fails", async () => {
    const startRenaming = vi.fn();

    await expect(
      createSidebarEntryAndRename("folder", {
        expandParent: vi.fn(),
        createEntry: vi.fn(async () => {
          throw new Error("disk full");
        }),
        refreshRoot: vi.fn(),
        startRenaming,
        isCurrentWorkspace: () => true,
      }),
    ).rejects.toThrow("disk full");

    expect(startRenaming).not.toHaveBeenCalled();
  });

  test("stops post-create work after the workspace changes", async () => {
    let isCurrent = true;
    const refreshRoot = vi.fn();
    const startRenaming = vi.fn();

    await createSidebarEntryAndRename("file", {
      expandParent: vi.fn(),
      createEntry: vi.fn(async () => {
        isCurrent = false;
        return { path: "/old-workspace/Untitled.md" };
      }),
      refreshRoot,
      startRenaming,
      isCurrentWorkspace: () => isCurrent,
    });

    expect(refreshRoot).not.toHaveBeenCalled();
    expect(startRenaming).not.toHaveBeenCalled();
  });

  test("does nothing when the initiating workspace is already stale", async () => {
    const expandParent = vi.fn();
    const createEntry = vi.fn();

    await createSidebarEntryAndRename("file", {
      expandParent,
      createEntry,
      refreshRoot: vi.fn(),
      startRenaming: vi.fn(),
      isCurrentWorkspace: () => false,
    });

    expect(expandParent).not.toHaveBeenCalled();
    expect(createEntry).not.toHaveBeenCalled();
  });

  test("does not rename when the workspace changes during refresh", async () => {
    let isCurrent = true;
    const startRenaming = vi.fn();

    await createSidebarEntryAndRename("folder", {
      expandParent: vi.fn(),
      createEntry: vi.fn(async () => ({ path: "/old-workspace/Untitled Folder" })),
      refreshRoot: vi.fn(async () => {
        isCurrent = false;
      }),
      startRenaming,
      isCurrentWorkspace: () => isCurrent,
    });

    expect(startRenaming).not.toHaveBeenCalled();
  });
});
