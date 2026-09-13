import type { Channel } from "@tauri-apps/api/core";
import type { ContentSearchEvent } from "@/lib/tauri";
import type { ContentSearchResult, ContentSearchStats } from "@/types/fs";

/** The scan hits the disk, so it debounces far longer than the in-memory
 *  filename search. */
export const CONTENT_SEARCH_DEBOUNCE_MS = 150;
/** The spec forbids flashing "Searching…" for fast scans. */
export const CONTENT_SEARCH_INDICATOR_DELAY_MS = 200;

export interface ContentSearchSession {
  /** The query this session was opened for. A session carrying anything else
   *  is stale and its `isComplete` is not a verdict on the current query. */
  query: string;
  /** Arrival order, which is the workspace index order. Score sorting belongs
   *  to the palette, which must also keep the order stable while the user
   *  navigates with the keyboard. */
  results: ContentSearchResult[];
  stats: ContentSearchStats | null;
  isComplete: boolean;
}

export function emptySession(query = ""): ContentSearchSession {
  return { query, results: [], stats: null, isComplete: false };
}

/** A superseded scan keeps delivering until Rust observes the new generation;
 *  channel identity is what makes its messages inert. */
export function isActiveChannel(
  active: Channel<ContentSearchEvent> | null,
  incoming: Channel<ContentSearchEvent>,
): boolean {
  return active === incoming;
}

export function applyContentSearchEvent(
  session: ContentSearchSession,
  event: ContentSearchEvent,
): ContentSearchSession {
  if (session.isComplete) {
    return session;
  }

  switch (event.event) {
    case "matches":
      return event.data.length === 0
        ? session
        : { ...session, results: [...session.results, ...event.data] };
    case "done":
      return { ...session, stats: event.data, isComplete: true };
    default:
      // A variant added on the Rust side compiles on both sides; returning
      // `undefined` here would crash the palette on the next render.
      return session;
  }
}
