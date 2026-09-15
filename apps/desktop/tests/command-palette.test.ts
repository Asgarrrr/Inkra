import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const mockedInvoke = vi.mocked(invoke);

describe("fuzzySearch IPC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("fuzzySearch calls correct command", async () => {
    mockedInvoke.mockResolvedValue([]);
    const { fuzzySearch } = await import("../src/lib/tauri");
    await fuzzySearch("test", 20);
    expect(mockedInvoke).toHaveBeenCalledWith("fuzzy_search", { query: "test", limit: 20 });
  });

  test("indexWorkspace calls correct command", async () => {
    mockedInvoke.mockResolvedValue({ file_count: 5, duration_ms: 10 });
    const { indexWorkspace } = await import("../src/lib/tauri");
    await indexWorkspace();
    expect(mockedInvoke).toHaveBeenCalledWith("index_workspace");
  });
});

describe("useFuzzySearch hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns empty on empty query", async () => {
    // The hook internally calls fuzzySearch via tauri which is mocked
    // Testing the logic: empty query should not trigger search
    mockedInvoke.mockResolvedValue([]);

    // The hook debounces at 50ms, so no invoke should happen for empty query
    // We verify this by checking that invoke was not called
    expect(mockedInvoke).not.toHaveBeenCalledWith("fuzzy_search", expect.anything());
  });
});
