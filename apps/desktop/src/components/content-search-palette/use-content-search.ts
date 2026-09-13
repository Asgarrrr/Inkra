import { Channel } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyContentSearchEvent,
  CONTENT_SEARCH_DEBOUNCE_MS,
  CONTENT_SEARCH_INDICATOR_DELAY_MS,
  emptySession,
  isActiveChannel,
  type ContentSearchSession,
} from "@/lib/content-search-session";
import * as tauri from "@/lib/tauri";
import type { ContentSearchEvent } from "@/lib/tauri";
import type { ContentSearchStats } from "@/types/fs";

export interface ContentSearchState {
  session: ContentSearchSession;
  isSearching: boolean;
  /** The session does not belong to `query`: the debounce is still running, or
   *  the scan was dropped. Previous results stay on screen, so `isComplete`
   *  must not be read as "no results for what you typed". */
  isStale: boolean;
}

const IDLE: ContentSearchState = {
  session: emptySession(),
  isSearching: false,
  isStale: false,
};

export function useContentSearch(query: string): ContentSearchState {
  const [session, setSession] = useState(emptySession);
  const [isSearching, setIsSearching] = useState(false);
  const channelRef = useRef<Channel<ContentSearchEvent> | null>(null);
  const hasQuery = query.trim() !== "";

  useEffect(() => {
    if (!hasQuery) {
      return;
    }

    let indicatorTimer: number | undefined;
    let launched = false;

    const finish = (channel: Channel<ContentSearchEvent>, stats: ContentSearchStats) => {
      if (!isActiveChannel(channelRef.current, channel)) return;
      window.clearTimeout(indicatorTimer);
      setIsSearching(false);
      if (stats.outcome === "cancelled") {
        // Only a teardown reaches the active channel here (a newer search
        // would already have replaced it). The batches already delivered hold
        // absolute paths into the workspace the window has left, so freezing
        // them would show a finished result list for a workspace the user
        // cannot navigate into.
        setSession(emptySession());
        return;
      }
      setSession((current) => applyContentSearchEvent(current, { event: "done", data: stats }));
    };

    // The debounce lives inside the effect so React's mount-time double-invoke
    // collapses into a single scan.
    const debounceTimer = window.setTimeout(() => {
      launched = true;
      const channel = new Channel<ContentSearchEvent>();
      channel.onmessage = (event) => {
        if (!isActiveChannel(channelRef.current, channel)) return;
        if (event.event === "done") {
          finish(channel, event.data);
          return;
        }
        setSession((current) => applyContentSearchEvent(current, event));
      };

      channelRef.current = channel;
      setSession(emptySession(query));
      indicatorTimer = window.setTimeout(
        () => setIsSearching(true),
        CONTENT_SEARCH_INDICATOR_DELAY_MS,
      );

      tauri.searchWorkspaceContent(query, channel).catch(() => {
        // A rejected invoke (no workspace, dead webview) never yields a `done`
        // event, so synthesize the terminal state rather than leave the
        // session looking like a scan still in flight.
        finish(channel, { total: 0, truncated: false, skipped_files: 0, outcome: "failed" });
      });
    }, CONTENT_SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(debounceTimer);
      window.clearTimeout(indicatorTimer);
      channelRef.current = null;
      setIsSearching(false);
      // Dropping the channel only makes the messages inert; the scan itself
      // keeps reading the workspace and holding the scan lock until Rust sees
      // a newer generation.
      if (launched) void tauri.cancelWorkspaceContentSearch().catch(() => {});
    };
  }, [query, hasQuery]);

  // Empty queries have no results — derive this during render instead of
  // clearing state in the effect, so callers never see a stale frame.
  return useMemo(
    () => (hasQuery ? { session, isSearching, isStale: session.query !== query } : IDLE),
    [hasQuery, isSearching, query, session],
  );
}
