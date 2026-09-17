// Keystroke latency instrumentation.
//
// Keystroke latency is wall time from the key event entering the page to the
// glyph being painted, split at four stamps on `performance`'s clock:
//
//   t0  event.timeStamp                      ─┐ input delay   t1−t0
//   t1  capture-phase listener               ─┘
//   t2  CodeMirror updateListener            ─── processing   t2−t1
//   t3  requestAnimationFrame → setTimeout(0) ── presentation t3−t2
//
// t0/t1 are taken on the earlier of `keydown` and `beforeinput`. A real
// keypress fires both, so it anchors on `keydown`; a text insertion that
// arrives with no keydown anchors on `beforeinput`. Watching only `keydown`
// would miss plain typing entirely under WebDriver's `elementSendKeys`.
//
// `t3` reuses the post-paint technique in `startup-metrics.ts`: paint entries
// for the current frame are not queued yet, so yielding twice lands after it.
//
// Stated limit: React's re-render from the Zustand write is scheduled, so it
// lands inside the presentation segment and this version does not separate it
// from paint. A fat presentation segment is the signal that the split is worth
// building — startup measured React's MessageChannel scheduling at 75 ms.
//
// Recording is off until `start()` is called, so an enabled build that nobody
// armed pays nothing beyond one `isEnabled()` branch per editor mount. Like
// `startup-metrics.ts`, a release build only carries this when built with
// VITE_KEYSTROKE_METRICS=1.

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export type KeystrokeSample = {
  seq: number;
  /** `event.key`, so a run can be read back per interaction kind. */
  key: string;
  /** Interaction the driver was exercising, set by `start({ label })`. */
  label: string;
  /**
   * Which event opened the sample. A real keypress fires `keydown` and then
   * `beforeinput`, so it opens on `keydown`; a text insertion that arrives
   * without a keydown — as WebDriver's `elementSendKeys` does — opens on
   * `beforeinput`, which is then the true start of the edit.
   */
  origin: "keydown" | "beforeinput";
  /** `event.isTrusted`. False means the event was constructed in-page. */
  trusted: boolean;
  t0: number;
  t1: number;
  /** Null when the keystroke changed no document (arrow keys, dead keys). */
  t2: number | null;
  /** Null while the sample is still open, or if the frame never closed it. */
  t3: number | null;
  docLength: number | null;
};

export type Segments = {
  inputDelay: number;
  processing: number;
  presentation: number;
  totalFromKeyEvent: number;
  totalFromListener: number;
};

export type Stats = {
  n: number;
  min: number;
  median: number;
  p95: number;
  max: number;
  mean: number;
};

export type ClockSanity = {
  usable: boolean;
  reason: string | null;
};

export type Summary = {
  count: number;
  complete: number;
  clock: ClockSanity;
  segments: {
    inputDelay: Stats | null;
    processing: Stats | null;
    presentation: Stats | null;
  };
  /** Which stamp the total is anchored on; `listener` means t0 was dropped. */
  total: (Stats & { basis: "key-event" | "listener" }) | null;
  /** How many samples each opening event contributed. */
  origins: { keydown: number; beforeinput: number };
  /** Largest gap between the segments and the total they should close. */
  maxResidual: number;
};

const RING_CAPACITY = 512;

function isEnabled(): boolean {
  if (typeof performance === "undefined" || typeof performance.now !== "function") {
    return false;
  }
  return import.meta.env.DEV || import.meta.env.VITE_KEYSTROKE_METRICS === "1";
}

// ---------------------------------------------------------------------------
// Reduction. Pure, so the parts that can be silently wrong are unit-testable
// without a DOM.
// ---------------------------------------------------------------------------

/**
 * Nearest-rank percentile, no interpolation. With 30 samples per cell,
 * interpolating between two neighbours invents a duration no keystroke
 * actually cost; the tail is the thing being measured, so report a real one.
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? null;
}

function statsOf(values: number[]): Stats | null {
  if (values.length === 0) return null;
  const median = percentile(values, 50);
  const p95 = percentile(values, 95);
  if (median === null || p95 === null) return null;
  return {
    n: values.length,
    min: Math.min(...values),
    median,
    p95,
    max: Math.max(...values),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  };
}

/** The four stamps split into segments, or null if the sample never closed. */
export function segmentsOf(sample: KeystrokeSample): Segments | null {
  const { t0, t1, t2, t3 } = sample;
  if (t2 === null || t3 === null) return null;
  return {
    inputDelay: t1 - t0,
    processing: t2 - t1,
    presentation: t3 - t2,
    totalFromKeyEvent: t3 - t0,
    totalFromListener: t3 - t1,
  };
}

/**
 * Whether `t0` can be believed.
 *
 * WebDriver keys are driver-synthesized and it is not given that WebKit stamps
 * them with a real dispatch time. If this fails the input-delay column is
 * dropped and the reason reported, rather than printing a number that means
 * nothing.
 */
export function checkClockSanity(samples: KeystrokeSample[]): ClockSanity {
  let previous = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    // Checked first because the ordering rules below cannot see it: an event
    // constructed in-page is monotonic and well-ordered, and its `timeStamp`
    // is still only when the object was made, not when a key was pressed.
    if (!sample.trusted) {
      return {
        usable: false,
        reason: `untrusted ${sample.origin} at seq ${sample.seq}: timeStamp is not a dispatch time`,
      };
    }
    if (!(sample.t0 > 0)) {
      return { usable: false, reason: `t0 is ${sample.t0} at seq ${sample.seq}: never stamped` };
    }
    if (sample.t0 > sample.t1) {
      return {
        usable: false,
        reason: `t0 <= t1 violated at seq ${sample.seq}: ${sample.t0} > ${sample.t1}`,
      };
    }
    if (sample.t0 < previous) {
      return {
        usable: false,
        reason: `t0 not monotonic at seq ${sample.seq}: ${sample.t0} after ${previous}`,
      };
    }
    previous = sample.t0;
  }
  return { usable: true, reason: null };
}

export function summarize(samples: KeystrokeSample[]): Summary {
  const clock = checkClockSanity(samples);

  const inputDelay: number[] = [];
  const processing: number[] = [];
  const presentation: number[] = [];
  const totals: number[] = [];
  const origins = { keydown: 0, beforeinput: 0 };
  let maxResidual = 0;
  let complete = 0;

  for (const sample of samples) {
    origins[sample.origin] += 1;
    const s = segmentsOf(sample);
    if (!s) continue;
    complete += 1;

    processing.push(s.processing);
    presentation.push(s.presentation);

    if (clock.usable) {
      inputDelay.push(s.inputDelay);
      totals.push(s.totalFromKeyEvent);
      const sum = s.inputDelay + s.processing + s.presentation;
      maxResidual = Math.max(maxResidual, Math.abs(sum - s.totalFromKeyEvent));
    } else {
      totals.push(s.totalFromListener);
      const sum = s.processing + s.presentation;
      maxResidual = Math.max(maxResidual, Math.abs(sum - s.totalFromListener));
    }
  }

  const totalStats = statsOf(totals);

  return {
    count: samples.length,
    complete,
    clock,
    segments: {
      inputDelay: clock.usable ? statsOf(inputDelay) : null,
      processing: statsOf(processing),
      presentation: statsOf(presentation),
    },
    total: totalStats ? { ...totalStats, basis: clock.usable ? "key-event" : "listener" } : null,
    origins,
    maxResidual,
  };
}

// ---------------------------------------------------------------------------
// Runtime probe.
// ---------------------------------------------------------------------------

export type StartOptions = {
  /**
   * Busy-wait this long inside the processing segment. The calibration gate:
   * with 20 ms injected, the probe must report processing ≈ baseline + 20 ms,
   * or the instrument is not measuring what it claims.
   */
  injectProcessingDelayMs?: number;
  /** Tag for the interaction being driven, carried on every sample. */
  label?: string;
};

type ProbeState = {
  recording: boolean;
  label: string;
  injectMs: number;
  seq: number;
  open: KeystrokeSample[];
  ring: KeystrokeSample[];
};

const state: ProbeState = {
  recording: false,
  label: "unlabelled",
  injectMs: 0,
  seq: 0,
  open: [],
  ring: [],
};

function closeSample(sample: KeystrokeSample): void {
  // Two yields: the paint for this frame has not happened when the rAF
  // callback runs, and a task scheduled from it runs after the frame commits.
  requestAnimationFrame(() => {
    setTimeout(() => {
      sample.t3 = performance.now();
      const index = state.open.indexOf(sample);
      if (index !== -1) state.open.splice(index, 1);
      state.ring.push(sample);
      if (state.ring.length > RING_CAPACITY) state.ring.shift();
    }, 0);
  });
}

function openSample(origin: "keydown" | "beforeinput", key: string, event: Event): void {
  if (!state.recording) return;

  // A real keypress fires `keydown` and then `beforeinput` for the same
  // glyph. Opening on the first and ignoring the second while it is still in
  // flight keeps one sample per keystroke, and keeps the sample anchored on
  // the earlier of the two — which is where the keystroke really started.
  if (origin === "beforeinput" && state.open.some((s) => s.t2 === null)) return;

  state.seq += 1;
  const sample: KeystrokeSample = {
    seq: state.seq,
    key,
    label: state.label,
    origin,
    trusted: event.isTrusted,
    t0: event.timeStamp,
    t1: performance.now(),
    t2: null,
    t3: null,
    docLength: null,
  };
  state.open.push(sample);
  closeSample(sample);
}

function onKeyDownCapture(event: KeyboardEvent): void {
  openSample("keydown", event.key, event);
}

// WebDriver's `elementSendKeys` inserts text through the editing pipeline
// without a keydown ever reaching the page, so a harness that only watched
// keydown would record nothing at all for plain typing.
function onBeforeInputCapture(event: Event): void {
  const data = (event as InputEvent).data;
  openSample("beforeinput", data ?? (event as InputEvent).inputType ?? "input", event);
}

/**
 * Close the processing segment.
 *
 * Called from the editor's updateListener, and exposed on the probe so the
 * floor-control `<textarea>` can close the same segment from its own `input`
 * handler — the two paths have to be structurally identical for the comparison
 * to mean anything.
 */
function stampProcessing(docLength: number | null): void {
  if (!state.recording) return;

  // The injected delay stands in for slow synchronous work, so it has to land
  // before the stamp that closes the segment it is inflating.
  if (state.injectMs > 0) {
    const until = performance.now() + state.injectMs;
    while (performance.now() < until) {
      /* busy-wait: a timer would yield and land in presentation instead */
    }
  }

  // Match the newest keystroke still waiting on a document change. Typing
  // faster than one frame leaves several open at once.
  for (let i = state.open.length - 1; i >= 0; i -= 1) {
    const sample = state.open[i];
    if (sample && sample.t2 === null) {
      sample.t2 = performance.now();
      sample.docLength = docLength;
      return;
    }
  }
}

export type KeystrokeProbe = {
  start(options?: StartOptions): void;
  stop(): void;
  drain(): KeystrokeSample[];
  summary(): Summary;
  stampProcessing(docLength?: number | null): void;
  isRecording(): boolean;
};

declare global {
  interface Window {
    __inkraKeystroke?: KeystrokeProbe;
  }
}

let installed = false;

/** Install the capture listener and `window.__inkraKeystroke`. Idempotent. */
export function installKeystrokeProbe(): void {
  if (installed || !isEnabled()) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  installed = true;

  // Capture phase on the window, so these run before CodeMirror's own handling
  // however deep in the tree the editor sits.
  window.addEventListener("keydown", onKeyDownCapture, { capture: true });
  window.addEventListener("beforeinput", onBeforeInputCapture, { capture: true });

  window.__inkraKeystroke = {
    start(options: StartOptions = {}) {
      state.recording = true;
      state.label = options.label ?? "unlabelled";
      state.injectMs = options.injectProcessingDelayMs ?? 0;
      state.seq = 0;
      state.open = [];
      state.ring = [];
    },
    stop() {
      state.recording = false;
      state.injectMs = 0;
    },
    drain() {
      const out = state.ring;
      state.ring = [];
      return out;
    },
    summary() {
      return summarize(state.ring);
    },
    stampProcessing(docLength = null) {
      stampProcessing(docLength);
    },
    isRecording() {
      return state.recording;
    },
  };
}

/**
 * The editor half of the instrument: stamps t2 when a keystroke's document
 * change lands. Empty in a build without VITE_KEYSTROKE_METRICS.
 */
export function keystrokeStampExtension(): Extension {
  if (!isEnabled()) return [];
  installKeystrokeProbe();
  return EditorView.updateListener.of((update) => {
    if (update.docChanged) stampProcessing(update.state.doc.length);
  });
}
