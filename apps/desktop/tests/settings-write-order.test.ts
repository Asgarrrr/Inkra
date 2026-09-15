import { beforeEach, describe, expect, test, vi } from "bun:test";
import { actualTauriCore } from "./helpers/actual-tauri-core";
import { mocked } from "./helpers/vi-compat";

vi.mock("@tauri-apps/api/core", () => ({ ...actualTauriCore, invoke: vi.fn() }));
vi.mock("@/lib/theme", () => ({ applyTheme: vi.fn(), applyCssVarBindings: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { applyCssVarBindings, applyTheme } from "../src/lib/theme";
import { useSettingsStore } from "../src/stores/settings-store";

const mockedInvoke = mocked(invoke);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("settings write ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ settings: { "fonts.editor": "Original, serif" }, isLoaded: true });
  });

  test("serializes backend writes for the same key while updating UI optimistically", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mockedInvoke.mockImplementation((command, args) => {
      if (command !== "set_setting") return Promise.resolve(null);
      const value = (args as { value: string }).value;
      return value.startsWith("First") ? first.promise : second.promise;
    });

    const firstWrite = useSettingsStore.getState().setSetting("fonts.editor", "First, serif");
    const secondWrite = useSettingsStore.getState().setSetting("fonts.editor", "Second, serif");
    await flushMicrotasks();

    expect(useSettingsStore.getState().settings["fonts.editor"]).toBe("Second, serif");
    expect(mockedInvoke).toHaveBeenCalledTimes(1);

    first.resolve("First, serif");
    await flushMicrotasks();
    expect(mockedInvoke).toHaveBeenCalledTimes(2);

    second.resolve("Second, serif");
    await Promise.all([firstWrite, secondWrite]);
    expect(useSettingsStore.getState().settings["fonts.editor"]).toBe("Second, serif");
  });

  test("reconciles optimistic state to the canonical value returned by the backend", async () => {
    const write = deferred<unknown>();
    mockedInvoke.mockImplementation((command) => {
      if (command === "set_setting") return write.promise;
      return Promise.resolve(null);
    });

    const pending = useSettingsStore
      .getState()
      .setSetting("workspace.default-terminal", "  Ghostty  ");
    expect(useSettingsStore.getState().settings["workspace.default-terminal"]).toBe("  Ghostty  ");

    write.resolve("Ghostty");
    await pending;
    expect(useSettingsStore.getState().settings["workspace.default-terminal"]).toBe("Ghostty");
  });

  test("does not republish settings when the backend returns the optimistic value unchanged", async () => {
    mockedInvoke.mockResolvedValue("Ghostty");

    await useSettingsStore.getState().setSetting("workspace.default-terminal", "Ghostty");

    expect(applyTheme).toHaveBeenCalledTimes(1);
    expect(applyCssVarBindings).toHaveBeenCalledTimes(1);
  });

  test("does not republish an unchanged list returned as a fresh IPC array", async () => {
    useSettingsStore.setState({
      settings: { "files.associations": ["md"] },
      isLoaded: true,
    });
    mockedInvoke.mockResolvedValue(["md", "markdown"]);

    await useSettingsStore.getState().setSetting("files.associations", ["md", "markdown"]);

    expect(applyTheme).toHaveBeenCalledTimes(1);
    expect(applyCssVarBindings).toHaveBeenCalledTimes(1);
  });

  test("a stale failed write cannot roll back a newer optimistic value", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mockedInvoke.mockImplementation((command, args) => {
      if (command !== "set_setting") return Promise.resolve(null);
      const value = (args as { value: string }).value;
      return value.startsWith("First") ? first.promise : second.promise;
    });

    const firstWrite = useSettingsStore
      .getState()
      .setSetting("fonts.editor", "First, serif")
      .catch(() => {});
    const secondWrite = useSettingsStore.getState().setSetting("fonts.editor", "Second, serif");
    await flushMicrotasks();

    first.reject(new Error("first failed"));
    await flushMicrotasks();
    expect(useSettingsStore.getState().settings["fonts.editor"]).toBe("Second, serif");

    second.resolve("Second, serif");
    await Promise.all([firstWrite, secondWrite]);
    expect(useSettingsStore.getState().settings["fonts.editor"]).toBe("Second, serif");
  });

  test("the latest failed write rolls back to the last successfully persisted value", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mockedInvoke.mockImplementation((command, args) => {
      if (command !== "set_setting") return Promise.resolve(null);
      const value = (args as { value: string }).value;
      return value.startsWith("First") ? first.promise : second.promise;
    });

    const firstWrite = useSettingsStore.getState().setSetting("fonts.editor", "First, serif");
    const secondWrite = useSettingsStore
      .getState()
      .setSetting("fonts.editor", "Second, serif")
      .catch(() => {});
    first.resolve("First, serif");
    await firstWrite;
    await flushMicrotasks();
    second.reject(new Error("second failed"));
    await secondWrite;

    expect(useSettingsStore.getState().settings["fonts.editor"]).toBe("First, serif");
  });

  test("reset stays ordered behind pending writes and wins in both backend and UI", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const reset = deferred<void>();
    mockedInvoke.mockImplementation((command, args) => {
      if (command === "set_setting") {
        const value = (args as { value: string }).value;
        return value.startsWith("First") ? first.promise : second.promise;
      }
      if (command === "reset_setting") return reset.promise;
      if (command === "get_settings") {
        return Promise.resolve({ "fonts.editor": "Default, serif" });
      }
      return Promise.resolve(null);
    });

    const firstWrite = useSettingsStore.getState().setSetting("fonts.editor", "First, serif");
    const secondWrite = useSettingsStore.getState().setSetting("fonts.editor", "Second, serif");
    const resetWrite = useSettingsStore.getState().resetSetting("fonts.editor");
    await flushMicrotasks();

    expect(useSettingsStore.getState().settings["fonts.editor"]).toBe("Second, serif");
    expect(mockedInvoke.mock.calls.map(([command]) => command)).toEqual(["set_setting"]);

    first.resolve("First, serif");
    await firstWrite;
    await flushMicrotasks();
    expect(mockedInvoke.mock.calls.map(([command]) => command)).toEqual([
      "set_setting",
      "set_setting",
    ]);

    second.resolve("Second, serif");
    await secondWrite;
    await flushMicrotasks();
    expect(mockedInvoke.mock.calls.map(([command]) => command)).toEqual([
      "set_setting",
      "set_setting",
      "reset_setting",
    ]);

    reset.resolve();
    await resetWrite;
    expect(mockedInvoke.mock.calls.map(([command]) => command)).toEqual([
      "set_setting",
      "set_setting",
      "reset_setting",
      "get_settings",
    ]);
    expect(useSettingsStore.getState().settings["fonts.editor"]).toBe("Default, serif");
  });
});
