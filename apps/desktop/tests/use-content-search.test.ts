import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: ((event: unknown) => void) | null = null;
  },
}));

vi.mock("react", () => import("./helpers/fake-react"));

import { invoke } from "@tauri-apps/api/core";
import { useContentSearch } from "../src/components/content-search-palette/use-content-search";
import {
  CONTENT_SEARCH_DEBOUNCE_MS,
  CONTENT_SEARCH_INDICATOR_DELAY_MS,
} from "../src/lib/content-search-session";
import type { ContentSearchEvent } from "../src/lib/tauri";
import type { ContentSearchResult, ContentSearchStats } from "../src/types/fs";
import { renderHook } from "./helpers/fake-react";

const mockedInvoke = vi.mocked(invoke);

type Deliver = (event: ContentSearchEvent) => void;

/** The channel handed to the Nth `search_workspace_content` invoke. Holding it
 *  past its query is how a superseded scan is simulated. */
function channelOf(call: number): Deliver {
  const args = mockedInvoke.mock.calls[call]?.[1] as
    | { onEvent?: { onmessage?: Deliver } }
    | undefined;
  const onmessage = args?.onEvent?.onmessage;
  if (!onmessage) throw new Error(`no content search channel for invoke #${call}`);
  return onmessage;
}

function match(relativePath: string): ContentSearchResult {
  return {
    path: `/ws/${relativePath}`,
    relative_path: relativePath,
    line_number: 1,
    line_content: "needle here",
    match_ranges: [[0, 6]],
    line_truncated: false,
    score: 1,
  };
}

function stats(overrides: Partial<ContentSearchStats> = {}): ContentSearchStats {
  return { total: 0, truncated: false, skipped_files: 0, outcome: "completed", ...overrides };
}

/** The `.catch` on the invoke is a microtask away from the rejection. */
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", globalThis);
  vi.useFakeTimers();
  mockedInvoke.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useContentSearch", () => {
  test("pins the delays the spec fixes", () => {
    expect(CONTENT_SEARCH_DEBOUNCE_MS).toBe(150);
    expect(CONTENT_SEARCH_INDICATOR_DELAY_MS).toBe(200);
  });

  test("does not reach Rust before the debounce elapses", () => {
    const hook = renderHook(useContentSearch, "alpha");

    vi.advanceTimersByTime(149);
    expect(mockedInvoke).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedInvoke.mock.calls[0]?.[0]).toBe("search_workspace_content");
    hook.unmount();
  });

  test("raises the indicator only once the scan outlives the delay", () => {
    const hook = renderHook(useContentSearch, "alpha");

    vi.advanceTimersByTime(150);
    expect(hook.result.isSearching).toBe(false);
    vi.advanceTimersByTime(199);
    expect(hook.result.isSearching).toBe(false);

    vi.advanceTimersByTime(1);
    expect(hook.result.isSearching).toBe(true);
    hook.unmount();
  });

  test("a double-invoked mount issues exactly one scan", () => {
    const hook = renderHook(useContentSearch, "alpha", true);

    vi.advanceTimersByTime(150);

    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  test("returns a stable object while nothing changed", () => {
    const hook = renderHook(useContentSearch, "alpha");
    const first = hook.result;

    hook.rerender("alpha");

    expect(hook.result).toBe(first);
    hook.unmount();
  });

  test("a scan that outlives its query can no longer touch the session", () => {
    const hook = renderHook(useContentSearch, "alp");
    vi.advanceTimersByTime(150);
    const stale = channelOf(0);

    stale({ event: "matches", data: [match("a.md")] });
    expect(hook.result.session.results).toHaveLength(1);
    expect(hook.result.isStale).toBe(false);

    hook.rerender("alph");
    expect(mockedInvoke).toHaveBeenCalledWith("cancel_workspace_content_search");

    stale({ event: "matches", data: [match("b.md")] });
    stale({ event: "done", data: stats({ total: 99 }) });

    expect(hook.result.session.results).toHaveLength(1);
    expect(hook.result.session.isComplete).toBe(false);
    expect(hook.result.isStale).toBe(true);
    hook.unmount();
  });

  test("a rejected invoke synthesizes the failed outcome", async () => {
    mockedInvoke.mockRejectedValueOnce(new Error("no workspace"));
    const hook = renderHook(useContentSearch, "alpha");

    vi.advanceTimersByTime(150);
    await flushMicrotasks();

    expect(hook.result.session.isComplete).toBe(true);
    expect(hook.result.session.stats?.outcome).toBe("failed");
    expect(hook.result.isSearching).toBe(false);
    hook.unmount();
  });

  test("a rejection landing after the query moved on leaves the session alone", async () => {
    mockedInvoke.mockRejectedValueOnce(new Error("no workspace"));
    const hook = renderHook(useContentSearch, "alpha");

    vi.advanceTimersByTime(150);
    hook.rerender("alphab");
    await flushMicrotasks();

    expect(hook.result.session.isComplete).toBe(false);
    expect(hook.result.session.stats).toBeNull();
    hook.unmount();
  });

  test("a cancelled scan drops its results instead of freezing them", () => {
    const hook = renderHook(useContentSearch, "alpha");
    vi.advanceTimersByTime(150);
    const channel = channelOf(0);

    channel({ event: "matches", data: [match("left-workspace.md")] });
    channel({ event: "done", data: stats({ total: 1, outcome: "cancelled" }) });

    expect(hook.result.session.results).toHaveLength(0);
    expect(hook.result.session.isComplete).toBe(false);
    expect(hook.result.isStale).toBe(true);
    hook.unmount();
  });

  test("unmounting mid-scan cancels it and leaves nothing running", () => {
    const hook = renderHook(useContentSearch, "alpha");
    vi.advanceTimersByTime(150);
    const channel = channelOf(0);

    hook.unmount();

    expect(mockedInvoke).toHaveBeenCalledWith("cancel_workspace_content_search");
    const renders = hook.renders;
    channel({ event: "done", data: stats({ total: 3 }) });
    vi.advanceTimersByTime(10_000);

    expect(vi.getTimerCount()).toBe(0);
    expect(hook.renders).toBe(renders);
  });
});
