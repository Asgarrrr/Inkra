import { useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import type { DocumentHeading } from "@/hooks/use-document-headings";
import { EDITOR_SAFE_SCROLL_MARGIN } from "./editor-scroll-container";

// Match the scroll-to-heading landing y so clicking a tick / row immediately
// activates the destination heading instead of keeping the previous one
// active. A small fudge protects against measurement jitter at the boundary.
const ACTIVE_OFFSET_PX = EDITOR_SAFE_SCROLL_MARGIN + 4;

export interface ActiveHeadings {
  activeIndex: number | null;
}

const EMPTY: ActiveHeadings = { activeIndex: null };

/**
 * Reading position as `i + fraction` between heading `i` and heading `i + 1`.
 *
 * Fractional on purpose: the rail's fisheye reads this value, so a whole-number
 * position would make every tick jump width the instant the active heading
 * changes. Sliding it with the scroll is what removes the step.
 */
export function readingPosition(tops: number[], threshold: number, atBottom: boolean): number {
  const last = tops.length - 1;
  if (last < 0) return 0;
  // The editor's bottom padding does not always lift the final heading above
  // the threshold, so reaching the scroll end pins the position to it.
  if (atBottom) return last;

  let index = -1;
  for (let i = 0; i <= last; i++) {
    if (tops[i] > threshold) break;
    index = i;
  }
  // Before the first heading crosses the threshold we are still on it
  // conceptually — the rail's first tick should lead at the top of the doc.
  if (index < 0) return 0;
  if (index === last) return last;

  // `index` is the last heading at or above the threshold and `index + 1` the
  // first below it, so the span is strictly positive even when a fold makes
  // neighbouring headings share a top.
  return index + (threshold - tops[index]) / (tops[index + 1] - tops[index]);
}

interface Measurement {
  activeIndex: number;
  position: number;
}

function measure(
  view: EditorView,
  scroller: HTMLElement,
  headings: DocumentHeading[],
): Measurement | null {
  if (headings.length === 0) return null;
  const docLen = view.state.doc.length;
  const threshold = scroller.getBoundingClientRect().top + ACTIVE_OFFSET_PX;

  // Every heading is measured, not just those above the threshold: the
  // fraction interpolates against the first heading *below* it.
  const tops: number[] = [];
  for (const heading of headings) {
    const block = view.lineBlockAt(Math.min(heading.pos, docLen));
    tops.push(view.documentTop + block.top);
  }

  const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
  const position = readingPosition(tops, threshold, atBottom);
  return { activeIndex: Math.floor(position), position };
}

export function useActiveHeadings(
  view: EditorView | null,
  scrollContainerRef: React.RefObject<HTMLElement | null>,
  headings: DocumentHeading[],
  railRef: React.RefObject<HTMLElement | null>,
): ActiveHeadings {
  const [state, setState] = useState<ActiveHeadings>(EMPTY);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!view || !scroller) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = measure(view, scroller, headings);
      // A single custom property on the rail feeds every tick's falloff, so a
      // scroll frame costs one style write regardless of the heading count.
      railRef.current?.style.setProperty("--rail-pos", String(next?.position ?? 0));
      const activeIndex = next ? next.activeIndex : null;
      if (stateRef.current.activeIndex !== activeIndex) setState({ activeIndex });
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [view, scrollContainerRef, headings, railRef]);

  // Without a live editor there is no active heading. Resolve this during
  // render instead of via an effect so the rail never paints a stale tick
  // from a previous file while the reset effect is pending.
  return view ? state : EMPTY;
}
