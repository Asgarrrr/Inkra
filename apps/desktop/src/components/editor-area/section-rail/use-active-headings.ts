import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import type { DocumentHeading } from "@/hooks/use-document-headings";
import { EDITOR_SAFE_SCROLL_MARGIN } from "../editor-scroll-container";

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
 *
 * `tops` and `threshold` only have to share a coordinate space — the result is
 * translation-invariant, so the caller converts the threshold into document
 * coordinates rather than converting every top into a screen one.
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

export function useActiveHeadings(
  view: EditorView | null,
  scrollContainerRef: React.RefObject<HTMLElement | null>,
  headings: DocumentHeading[],
  railRef: React.RefObject<HTMLElement | null>,
): ActiveHeadings {
  const [state, setState] = useState<ActiveHeadings>(EMPTY);
  // Headings get a fresh array identity on every debounce tick while typing.
  // Reading them through a ref keeps that out of the effect's dependencies, so
  // a keystroke re-measures instead of tearing the listeners down and back up.
  const headingsRef = useRef(headings);
  const resyncRef = useRef<(() => void) | null>(null);

  // A layout effect, not a passive one: `--rail-pos` is seeded to 0 inline, so
  // measuring after paint shows one frame of the first tick at full width
  // before it snaps to a restored scroll position.
  useLayoutEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!view || !scroller) return;

    let frame = 0;
    // Heading tops in document coordinates. Scrolling does not move them —
    // only a heightmap change does — so they are measured once and held until
    // something invalidates them, rather than once per heading per frame.
    let tops: number[] | null = null;

    const update = () => {
      frame = 0;
      const rail = railRef.current;
      const headingList = headingsRef.current;
      if (headingList.length === 0) {
        rail?.style.setProperty("--rail-pos", "0");
        setState((prev) => (prev.activeIndex === null ? prev : EMPTY));
        return;
      }

      if (tops === null) {
        const docLen = view.state.doc.length;
        tops = headingList.map((heading) => view.lineBlockAt(Math.min(heading.pos, docLen)).top);
      }

      const threshold = scroller.getBoundingClientRect().top + ACTIVE_OFFSET_PX - view.documentTop;
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      const position = readingPosition(tops, threshold, atBottom);

      // A single custom property on the rail feeds every tick's falloff, so a
      // scroll frame costs one style write regardless of the heading count.
      rail?.style.setProperty("--rail-pos", String(position));
      const activeIndex = Math.floor(position);
      setState((prev) => (prev.activeIndex === activeIndex ? prev : { activeIndex }));
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    const resync = () => {
      tops = null;
      schedule();
    };
    resyncRef.current = resync;

    // Heights settle after the fact — an image decodes, a diagram renders, a
    // font swaps — and none of that emits a scroll event, so without this the
    // rail holds a stale position until the reader next scrolls. Observing the
    // content box catches all of them, and unlike CodeMirror's
    // `geometryChanged` it does not also fire on every keystroke.
    const observer = new ResizeObserver(resync);
    observer.observe(view.contentDOM);

    update();
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", resync);
    return () => {
      resyncRef.current = null;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", resync);
    };
  }, [view, scrollContainerRef, railRef]);

  useEffect(() => {
    // Equal on the mount pass, where the layout effect has already measured
    // this exact array.
    if (headingsRef.current === headings) return;
    headingsRef.current = headings;
    resyncRef.current?.();
  }, [headings]);

  // Without a live editor there is no active heading. Resolve this during
  // render instead of via an effect so the rail never paints a stale tick
  // from a previous file while the reset effect is pending.
  return view ? state : EMPTY;
}
