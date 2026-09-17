import { ok } from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Key } from "webdriverio";

import { APP_DATA_DIR, TABLE_MARKER } from "./keystroke-fixtures.js";

// Keystroke latency measurement probe. Not part of the e2e sweep —
// `wdio.conf.js` only globs `./specs/**`, so this runs only when asked for by
// path:
//
//   # from apps/desktop, with repo-root node_modules/.bin on PATH
//   export PATH="$PWD/../../node_modules/.bin:$PATH"
//   cd src-tauri && VITE_KEYSTROKE_METRICS=1 cargo tauri build --features e2e \
//     --bundles app --config '{"identifier":"com.inkra.e2e","bundle":{"createUpdaterArtifacts":false}}'
//   cd ../e2e
//   for i in 1 2 3 4 5; do
//     node ./probes/keystroke-fixtures.js            # fresh docs + pinned workspace
//     KEYSTROKE_PROBE_OUT=/tmp/keystroke.jsonl KEYSTROKE_RUN=$i E2E_KILL_STALE=1 \
//       ./node_modules/.bin/wdio run ./wdio.conf.js --spec ./probes/keystroke-probe.spec.js
//   done
//
// The `keystroke-fixtures.js` step is not optional. It regenerates byte-
// identical documents and clears `sessions.json`, which otherwise replays the
// previous run's tab *and scroll position* — an unpinned run measures an
// unknown starting state.
//
// ---------------------------------------------------------------------------
// FINDINGS — 5 runs x 30 samples, pooled (150 per cell), release build,
// 2026-09-16. Reduce a run with `node ./probes/keystroke-report.js`.
// ---------------------------------------------------------------------------
//
// Medians / p95 in ms. "floor" is a plain contenteditable with no app code in
// the path, driven by the same driver through the same probe.
//
//   cell                        total50  total95  proc50  pres50
//   floor (no app code)            23      33       0       23
//   tiny.md    type   (2 KB)       19      33       1       18
//   medium.md  type  (50 KB)       18      33       1       17
//   large.md   type (500 KB)       26      39       4       21
//   large.md   type @start         22      38       4       18
//   dense.md   type  (50 KB)       38      67       6       32
//   dense.md   type @table-cell    22      37       4       18
//   dense.md   enter               32      42      13       19
//   dense.md   backspace           32      40      13       19
//
// 1. TYPING IN PROSE IS THE WEBVIEW, NOT THE APP. Every prose cell — 2 KB to
//    500 KB — lands at or below the 23 ms floor, and its p95 (33-39) matches
//    the floor's p95 (33). A keystroke costs one frame, and one frame is what
//    it costs with no app code in the path at all.
//
// 2. THE SUSPECTS NAMED BEFORE MEASURING ARE WORTH ~1 ms. `storeSyncExtension`
//    does `update.state.doc.toString()` on every change, and `updateContent`
//    then runs `inferTitle` and clones the whole `openFiles` Map. All of that
//    is inside the processing segment, which totals 1 ms at 50 KB and 4 ms at
//    500 KB. Optimising it is optimising 1 ms inside a 20 ms budget.
//
// 3. CONTENT BEATS SIZE. 500 KB of prose (26 ms) is cheaper than 50 KB of
//    tables, math, images and mermaid (38 ms, p95 67). Document size is the
//    weaker axis; block-widget density is the stronger one. dense.md is the
//    only cell meaningfully above the floor, and its excess is presentation
//    (32 vs 23) more than processing (6 vs 0).
//
// HYPOTHESES TESTED AND KILLED
//
//   - "The full-document string allocation per keystroke is the cost." No:
//     see (2). It is real, and it is ~1 ms at the sizes writers use.
//   - "The heightmap makes top-of-document typing expensive in a large
//     document." No: large.md types at 22 ms at the start against 26 ms at
//     the end — the wrong direction, and inside the spread.
//   - "Enter and Backspace have their own cost." No: they track typing
//     everywhere except dense.md, where processing rises to 13 ms.
//
// LIMITS OF THIS HARNESS — read before trusting a column
//
//   - There is no trusted keydown available. Measured: `browser.keys` fires a
//     keydown with `isTrusted === false`, which CodeMirror's keymap acts on
//     (Enter and Backspace work) but which cannot drive native text
//     insertion; `elementSendKeys` (`addValue`) inserts text and fires a
//     trusted `beforeinput` with no keydown at all. Typing rows therefore
//     anchor on `beforeinput`.
//   - So the input-delay column is ~0 and means less than it looks: it is
//     WebKit-begins-edit to our listener, and it EXCLUDES the native key to
//     WebKit path. The input delay a user actually pays is not measurable
//     here. On the untrusted rows `checkClockSanity` rejects the clock and
//     the column is dropped outright, with the total re-anchored on t1.
//   - Paste uses the plan's named fallback. Cmd+V never reaches the page
//     (verified for both `browser.keys` and `browser.action`); a real `paste`
//     ClipboardEvent does. Its opening keydown is dispatched in-page, so the
//     paste totals sit in the same JS task as their own dispatch and are NOT
//     comparable to the typed rows. Read paste's processing column only.
//   - Presentation bundles React's re-render with paint. Everything at the
//     floor says that bundle is one frame. dense.md's 32 ms against a 23 ms
//     floor is the ~9 ms worth splitting, and it is not yet known whether
//     that is React or WebKit.
//
// WHAT THIS SAYS TO DO NEXT (deliberately not done here)
//
//   The only measured lever is dense-document presentation. Build the
//   React-vs-paint split before optimising it: the segment is ~9 ms above the
//   floor and unattributed, and the startup work already showed React's
//   MessageChannel scheduling costing 75 ms, so guessing is not cheap.
//   Nothing in the store-write path earns an optimisation on this evidence.
//
// DECLARED TRIM, not a silent cap: caret position (top vs end of document)
// varies only for `type` on large.md, where the heightmap plausibly makes it
// matter. The full 4×5×2 grid is 40 cells of repeated runs — hours of wall
// clock for a variable that is a guess. Every other cell types at the end of
// the document. The trim is written into the JSONL `trim` field so nobody
// later reads the table as full coverage.

const SAMPLES = Number(process.env.KEYSTROKE_SAMPLES ?? 30);
const RUN = process.env.KEYSTROKE_RUN ?? "1";
const OUT = process.env.KEYSTROKE_PROBE_OUT ?? "/tmp/keystroke-probe.jsonl";

/** ~2 KB of plain text, no frontmatter, so paste takes CodeMirror's own path. */
const PASTE_TEXT = `${"Pasted paragraph for the keystroke probe. ".repeat(50)}\n`;

const DOCS = ["tiny.md", "medium.md", "large.md", "dense.md"];

let workspaceRoot = null;
let ready = false;
let pasteMode = { mode: "none", reason: "not yet determined" };
const records = [];

async function invoke(cmd, args) {
  return browser.executeAsync(
    (c, a, done) => {
      window.__TAURI_INTERNALS__
        .invoke(c, a)
        .then((v) => done({ ok: true, value: v }))
        .catch((e) => done({ ok: false, error: e && e.message ? e.message : String(e) }));
    },
    cmd,
    args,
  );
}

// The mounted EditorView is reached through the `cmTile` back-pointer that
// this CodeMirror version's own `EditorView.findFromDOM` uses:
// `.cm-content` -> `cmTile` -> `root` (the DocTile) -> `view`. Setup only —
// caret placement and document assertions. Every measured interaction goes
// through real key events.

async function readEditorState() {
  return browser.execute(() => {
    const content = document.querySelector(".cm-content");
    const view = content?.cmTile?.root?.view;
    if (!view) return { ok: false, reason: "no cmTile back-pointer on .cm-content" };
    return {
      ok: true,
      docLength: view.state.doc.length,
      head: view.state.selection.main.head,
    };
  });
}

/** Place the caret. `where` is "start", "end", or an absolute offset. */
async function placeCaret(where) {
  const result = await browser.execute((target) => {
    const content = document.querySelector(".cm-content");
    const view = content?.cmTile?.root?.view;
    if (!view) return { ok: false, reason: "no cmTile back-pointer on .cm-content" };
    const anchor =
      target === "end" ? view.state.doc.length : target === "start" ? 0 : Number(target);
    view.dispatch({ selection: { anchor }, scrollIntoView: true });
    view.focus();
    return { ok: true, head: view.state.selection.main.head, docLength: view.state.doc.length };
  }, where);
  ok(result.ok, `could not place caret: ${result.reason}`);
  return result;
}

/** Offset just past the table marker, so typing lands inside the cell. */
async function tableCellOffset() {
  const result = await browser.execute((marker) => {
    const content = document.querySelector(".cm-content");
    const view = content?.cmTile?.root?.view;
    if (!view) return { ok: false, reason: "no cmTile back-pointer on .cm-content" };
    const at = view.state.doc.toString().indexOf(marker);
    if (at === -1) return { ok: false, reason: "table marker not in document" };
    return { ok: true, offset: at + marker.length };
  }, TABLE_MARKER);
  ok(result.ok, `could not locate the table cell: ${result.reason}`);
  return result.offset;
}

async function openDoc(name) {
  const path = join(workspaceRoot, name);
  const row = await $(`[data-tree-path="${path}"]`);
  await row.waitForExist({ timeout: 20_000 });
  await row.click();
  await browser.waitUntil(async () => (await $$(".cm-content")).length > 0, {
    timeout: 20_000,
    timeoutMsg: `editor never mounted for ${name}`,
  });
  // A large document streams its decorations in; wait for the doc to be the
  // size on disk before measuring anything against it.
  await browser.waitUntil(
    async () => {
      const state = await readEditorState();
      return state.ok && state.docLength > 0;
    },
    { timeout: 20_000, timeoutMsg: `document never loaded for ${name}` },
  );
  return path;
}

/** Arm the probe, drive the interaction, and drain what it recorded. */
async function runCell({ label, drive, injectMs = 0 }) {
  await browser.execute(
    (l, inj) => window.__inkraKeystroke.start({ label: l, injectProcessingDelayMs: inj }),
    label,
    injectMs,
  );

  await drive();

  // The last sample closes on a rAF plus a task; give both room to land.
  await browser.pause(400);

  return browser.execute(() => {
    const summary = window.__inkraKeystroke.summary();
    const raw = window.__inkraKeystroke.drain();
    window.__inkraKeystroke.stop();
    return { summary, raw };
  });
}

// Measured, not assumed: of the four ways this driver can type, only
// `addValue` reaches a contenteditable, and it is the only one that leaves the
// caret where it found it (offset 2718 -> 2719 rather than jumping to 0).
// `browser.keys` delivers named keys — Enter, Backspace — but drops plain
// characters on `.cm-content`, and `browser.action().key()` drops both.
const typeChars =
  (n, selector = ".cm-content") =>
  async () => {
    const el = await $(selector);
    for (let i = 0; i < n; i += 1) await el.addValue("a");
  };
const pressKeyN = (key, n) => async () => {
  for (let i = 0; i < n; i += 1) await browser.keys(key);
};

/**
 * Which paste path actually reaches the store, decided once per run rather
 * than assumed. Cmd+V is tried first because it is the real thing; the
 * synthetic `paste` ClipboardEvent is the plan's named fallback.
 */
async function detectPasteMode() {
  const seeded = await invoke("plugin:clipboard-manager|write_text", { text: "PASTEPROBE" });
  if (!seeded.ok) return { mode: "none", reason: `clipboard write failed: ${seeded.error}` };

  const before = await readEditorState();
  await browser.keys([Key.Command, "v"]);
  await browser.pause(500);
  if ((await readEditorState()).docLength > before.docLength) {
    return { mode: "chord", reason: null };
  }

  const beforeSynthetic = await readEditorState();
  await dispatchSyntheticPaste("PASTEPROBE");
  await browser.pause(500);
  if ((await readEditorState()).docLength > beforeSynthetic.docLength) {
    return {
      mode: "synthetic",
      reason:
        "Cmd+V never reaches the page (neither browser.keys nor browser.action); " +
        "a real paste ClipboardEvent does. The keydown that opens the sample is " +
        "dispatched in-page, so input delay is not meaningful for paste rows.",
    };
  }

  return { mode: "none", reason: "neither Cmd+V nor a paste ClipboardEvent changed the document" };
}

/** The fallback paste: a keydown to open the sample, then the paste itself. */
async function dispatchSyntheticPaste(text) {
  return browser.execute((payload) => {
    const content = document.querySelector(".cm-content");
    if (!content) return;
    content.dispatchEvent(
      new KeyboardEvent("keydown", { key: "v", metaKey: true, bubbles: true, cancelable: true }),
    );
    const data = new DataTransfer();
    data.setData("text/plain", payload);
    content.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
}

function record(entry) {
  const line = { run: RUN, samples: SAMPLES, ...entry };
  records.push(line);
  appendFileSync(OUT, `${JSON.stringify(line)}\n`);
  const s = line.summary;
  if (!s || !s.total) {
    console.log(`CELL ${line.cell.padEnd(34)} ${line.note ?? "no samples"}`);
    return;
  }
  const seg = (stats) => (stats ? `${stats.median.toFixed(1)}/${stats.p95.toFixed(1)}` : "—");
  const origin = s.origins.beforeinput > s.origins.keydown ? "beforeinput" : "keydown";
  console.log(
    `CELL ${line.cell.padEnd(34)} n=${String(s.complete).padStart(3)}/${s.count}  ` +
      `total ${seg(s.total)}  in ${seg(s.segments.inputDelay)}  ` +
      `proc ${seg(s.segments.processing)}  pres ${seg(s.segments.presentation)}  ` +
      `[${origin}/${s.total.basis}]`,
  );
}

describe("keystroke probe", function () {
  before(async function () {
    this.timeout(90_000);

    const opened = await $('[data-sidebar-surface][data-workspace-open="true"]')
      .waitForExist({ timeout: 20_000 })
      .catch(() => false);
    ok(opened, "no workspace restored — run `node ./probes/keystroke-fixtures.js` first");

    // The e2e data dir persists `appearance.sidebar-visible`, and a collapsed
    // sidebar hides the rows this probe clicks. Settings apply on reload.
    await invoke("set_setting", {
      key: "appearance.sidebar-visible",
      value: true,
      scope: "global",
    });
    await browser.refresh();
    await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 20_000 });

    const pinned = JSON.parse(readFileSync(join(APP_DATA_DIR, "recent_workspaces.json"), "utf8"));
    workspaceRoot = Array.isArray(pinned) ? pinned[0] : null;
    ok(
      workspaceRoot && workspaceRoot.includes("inkra-keystroke-"),
      `pinned workspace is not a probe workspace: ${workspaceRoot}`,
    );

    const hasProbe = await browser.execute(() => typeof window.__inkraKeystroke === "object");
    ok(
      hasProbe,
      "window.__inkraKeystroke is missing — the bundle was not built with VITE_KEYSTROKE_METRICS=1",
    );

    ready = true;
  });

  // Decided once, against a real document, before the matrix runs.
  it("determines which paste path reaches the store", async function () {
    this.timeout(120_000);
    await openDoc("tiny.md");
    await placeCaret("end");
    pasteMode = await detectPasteMode();
    console.log(`PASTE-MODE ${JSON.stringify(pasteMode)}`);
    ok(pasteMode.mode, "no paste verdict was reached");
  });

  beforeEach(function () {
    if (!ready) this.skip();
  });

  after(function () {
    console.log(`PROBE-RUN ${JSON.stringify({ run: RUN, cells: records.length, out: OUT })}`);
  });

  // -------------------------------------------------------------------------
  // Gate 1 — the executable success criterion for the whole task.
  // -------------------------------------------------------------------------
  it("gate 1: reports an injected 20 ms as 20 ms of processing", async function () {
    this.timeout(180_000);

    await openDoc("medium.md");
    await placeCaret("end");
    const baseline = await runCell({ label: "calibration-baseline", drive: typeChars(SAMPLES) });

    await placeCaret("end");
    const injected = await runCell({
      label: "calibration-injected",
      drive: typeChars(SAMPLES),
      injectMs: 20,
    });

    record({ cell: "gate1/baseline", doc: "medium.md", ...baseline });
    record({ cell: "gate1/injected-20ms", doc: "medium.md", ...injected });

    ok(baseline.summary.complete > 0, "baseline recorded no complete samples");
    ok(injected.summary.complete > 0, "injected run recorded no complete samples");

    const delta =
      injected.summary.segments.processing.median - baseline.summary.segments.processing.median;
    console.log(
      `CALIBRATION baseline=${baseline.summary.segments.processing.median.toFixed(2)}ms ` +
        `injected=${injected.summary.segments.processing.median.toFixed(2)}ms ` +
        `delta=${delta.toFixed(2)}ms (expect ~20)`,
    );

    // Wide enough not to flake on scheduler noise, tight enough that an
    // instrument stamping the wrong pair of times cannot pass.
    ok(delta > 17 && delta < 27, `injected 20 ms surfaced as ${delta.toFixed(2)} ms of processing`);
  });

  // -------------------------------------------------------------------------
  // Gate 2 — what the same driver costs with no app code in the path.
  // -------------------------------------------------------------------------
  it("gate 2: measures the bare WKWebView floor with a plain contenteditable", async function () {
    this.timeout(120_000);

    // A contenteditable div, not a <textarea>, for two reasons. CodeMirror is
    // itself a contenteditable, so this isolates *app code* as the only
    // difference rather than also changing the input widget. And measured:
    // `addValue` fires a trusted `beforeinput` on a contenteditable but not on
    // a textarea, where WebKit sets `value` directly — a textarea control
    // would record nothing at all.
    await browser.execute(() => {
      const el = document.createElement("div");
      el.id = "__inkra-floor-control";
      el.contentEditable = "true";
      el.textContent = "floor";
      el.style.cssText =
        "position:fixed;top:0;left:0;width:320px;height:120px;z-index:2147483647;background:#fff";
      // The analogue of CodeMirror's updateListener: close the processing
      // segment from the handler this element's own edit fires.
      el.addEventListener("input", () => {
        window.__inkraKeystroke.stampProcessing(el.textContent.length);
      });
      document.body.appendChild(el);
      el.focus();
    });

    // Typed the same way the editor is — `addValue` — so the only difference
    // between this and an editor cell is the app code in the path.
    const floor = await runCell({
      label: "floor-contenteditable",
      drive: typeChars(SAMPLES, "#__inkra-floor-control"),
    });

    await browser.execute(() => {
      document.getElementById("__inkra-floor-control")?.remove();
    });

    record({ cell: "gate2/floor-contenteditable", doc: "(none)", ...floor });
    ok(floor.summary.complete > 0, "floor control recorded no complete samples");
  });

  // -------------------------------------------------------------------------
  // Gate 3 — is `t0` a real dispatch time, or a driver artefact?
  // -------------------------------------------------------------------------
  it("gate 3: reports whether the key-event clock can be trusted", async function () {
    this.timeout(120_000);

    await openDoc("tiny.md");
    await placeCaret("end");
    const cell = await runCell({ label: "clock-sanity", drive: typeChars(SAMPLES) });

    const { clock } = cell.summary;
    console.log(`CLOCK ${JSON.stringify(clock)}`);
    record({ cell: "gate3/clock-sanity", doc: "tiny.md", ...cell });

    // Not an assertion that the clock is good: an assertion that the verdict
    // is reached and carried into the output. A failing clock drops the
    // input-delay column, which `summarize` already does.
    ok(typeof clock.usable === "boolean", "no clock verdict was reached");
    if (!clock.usable) {
      console.log(`CLOCK UNUSABLE — input-delay column dropped: ${clock.reason}`);
    }
  });

  // -------------------------------------------------------------------------
  // The matrix.
  // -------------------------------------------------------------------------
  it("measures the document × interaction matrix", async function () {
    this.timeout(1_800_000);

    for (const doc of DOCS) {
      await openDoc(doc);

      // type, at the end of the document — where a writer actually writes.
      await placeCaret("end");
      record({
        cell: `${doc}/type@end`,
        doc,
        interaction: "type",
        caret: "end",
        trim: "caret varies only on large.md",
        ...(await runCell({ label: `${doc}:type@end`, drive: typeChars(SAMPLES) })),
      });

      // Enter.
      await placeCaret("end");
      record({
        cell: `${doc}/enter@end`,
        doc,
        interaction: "enter",
        caret: "end",
        ...(await runCell({ label: `${doc}:enter`, drive: pressKeyN("Enter", SAMPLES) })),
      });

      // Backspace, from the end so every press actually deletes something.
      await placeCaret("end");
      record({
        cell: `${doc}/backspace@end`,
        doc,
        interaction: "backspace",
        caret: "end",
        ...(await runCell({ label: `${doc}:backspace`, drive: pressKeyN("Backspace", SAMPLES) })),
      });

      // Paste ~2 KB. Named risk: the chord may never reach the page, so the
      // path was decided by measurement in the capability check above.
      await placeCaret("end");
      if (pasteMode.mode === "none") {
        record({
          cell: `${doc}/paste@end`,
          doc,
          interaction: "paste",
          caret: "end",
          summary: null,
          raw: [],
          note: `NOT MEASURED — ${pasteMode.reason}`,
        });
      } else {
        await invoke("plugin:clipboard-manager|write_text", { text: PASTE_TEXT });
        const paste = await runCell({
          label: `${doc}:paste`,
          drive: async () => {
            // Ten pastes, not thirty: each adds 2 KB, and a cell that grows
            // the document by 60 KB is measuring growth, not paste.
            for (let i = 0; i < 10; i += 1) {
              if (pasteMode.mode === "chord") await browser.keys([Key.Command, "v"]);
              else await dispatchSyntheticPaste(PASTE_TEXT);
              await browser.pause(120);
            }
          },
        });
        record({
          cell: `${doc}/paste@end`,
          doc,
          interaction: "paste",
          caret: "end",
          pasteMode: pasteMode.mode,
          ...paste,
          note: pasteMode.mode === "synthetic" ? pasteMode.reason : undefined,
        });
      }

      // Type inside a table cell, in the unfolded source.
      if (doc === "dense.md") {
        const offset = await tableCellOffset();
        await placeCaret(offset);
        record({
          cell: `${doc}/type@table-cell`,
          doc,
          interaction: "type-in-table",
          caret: "table-cell",
          ...(await runCell({ label: `${doc}:type@table`, drive: typeChars(SAMPLES) })),
        });
      }

      // The declared trim: top-of-document typing, on the one document where
      // the heightmap plausibly makes caret position matter.
      if (doc === "large.md") {
        await placeCaret("start");
        record({
          cell: `${doc}/type@start`,
          doc,
          interaction: "type",
          caret: "start",
          ...(await runCell({ label: `${doc}:type@start`, drive: typeChars(SAMPLES) })),
        });
      }
    }

    ok(records.length > 0, "the matrix recorded nothing");
  });
});
