import { ok, strictEqual } from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), "../screenshots");
const WORKSPACE = join(tmpdir(), "writer-e2e-content-search");
const QUERY = "throughput";

// Mirrors EDITOR_SAFE_SCROLL_MARGIN (editor-scroll-container.tsx): where
// `scrollPosToSafeTop` puts the target line, measured from the scroller's top.
const SAFE_MARGIN = 140;

// Mirrors MATCH_FLASH_MS (match-flash.ts): how long the arrival highlight stays.
const MATCH_FLASH_MS = 1200;

// Mirrors --editor-match-flash-bg (App.css): the accent mixed 45% into
// transparent, which the keyframes hold for the first half of the flash.
const FLASH_PEAK_ALPHA = 0.45;

const BIG_FILE = "big-images-tables.md";
const ANCHOR_FILE = "anchor-jump.md";
const FRONTMATTER_FILE = "frontmatter-deep.md";
const NEIGHBOUR_FILE = "accents.md";

// One token per jump target, absent from every other file, so a row's line
// number and the landed-on line both identify exactly one document line.
const BIG_ALPHA = "zqdeepalpha";
const BIG_BETA = "zqdeepbeta";
const FRONT_MARKER = "zqfrontmark";
const ANCHOR_MARKER = "zqanchormark";
const ANCHOR_HEADING = "Deep anchor heading";
const ANCHOR_SLUG = "deep-anchor-heading";
const ANCHOR_LINK_TEXT = "go deep";
const ANCHOR_FOCUS_LINE = "Click this line to put the caret in the editor.";

const RICH_SECTIONS = 360;

// A block image with a real intrinsic height: the heightmap estimates it as one
// line until the region is parsed and the widget materialises, which is the
// drift slice 5 exists to cancel. One shared URL keeps `imageHeightCache`
// (fold/image.ts) to a single entry, so the estimates are reproducible.
const IMAGE_MD = `![panel](data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#7f8ea3"/></svg>',
).toString("base64")})`;

/** Line numbers the content scan reports for each marker: 1-based and
 *  body-relative, so the frontmatter document's are not its file lines. */
const markerLine = {};

/** `throughput` appears in every file and in no filename, so it exercises the
 *  content path only. `README.md` sits at the root (no parent directory to
 *  render) and `accents.md` carries an accent and an emoji before a match, so
 *  a UTF-16 `slice` would visibly mis-highlight. */
function seedWorkspace() {
  mkdirSync(join(WORKSPACE, "notes"), { recursive: true });
  mkdirSync(join(WORKSPACE, "docs", "deep"), { recursive: true });
  writeFileSync(
    join(WORKSPACE, "README.md"),
    "# Vault root\n\nThis note discusses the throughput of the ingestion pipeline.\n",
  );
  writeFileSync(
    join(WORKSPACE, "notes", "alpha.md"),
    "---\ntitle: Alpha\n---\n\n# Alpha\n\nMeasuring throughput requires a stable baseline.\nThe throughput figure is a median.\n",
  );
  writeFileSync(
    join(WORKSPACE, "notes", "accents.md"),
    "# Accents\n\nLe débit du café est throughput en anglais.\nUn émoji 🎉 avant throughput pour tester les offsets.\n",
  );
  writeFileSync(
    join(WORKSPACE, "docs", "api.md"),
    "# API\n\n## Throughput\n\nThe throughput endpoint returns a rolling average.\n",
  );
  writeFileSync(
    join(WORKSPACE, "docs", "deep", "nested.md"),
    "# Nested\n\nDeeply nested throughput reference.\n",
  );
  for (let i = 1; i <= 12; i++) {
    writeFileSync(
      join(WORKSPACE, "notes", `filler-${i}.md`),
      `# Filler ${i}\n\nSome throughput mention number ${i}.\n`,
    );
  }

  seedRichDocument(BIG_FILE, ["# Big document", ""], {
    120: {
      marker: BIG_BETA,
      lines: [`The ${BIG_BETA} marker sits in the first third.`],
    },
    300: {
      marker: BIG_ALPHA,
      lines: [`The ${BIG_ALPHA} marker sits in the last third.`],
    },
  });
  seedRichDocument(
    ANCHOR_FILE,
    [
      "# Anchor jump",
      "",
      `Follow [${ANCHOR_LINK_TEXT}](#${ANCHOR_SLUG}) past the pictures.`,
      "",
      ANCHOR_FOCUS_LINE,
      "",
    ],
    {
      200: {
        marker: ANCHOR_MARKER,
        lines: [`## ${ANCHOR_HEADING}`, "", `The ${ANCHOR_MARKER} marker sits under it.`],
      },
    },
  );
  seedFrontmatterDocument();
}

/** Thousands of lines whose heights only settle once the region is parsed:
 *  every section carries a block image and a table. */
function seedRichDocument(name, head, inserts) {
  const lines = [...head];
  for (let i = 1; i <= RICH_SECTIONS; i++) {
    lines.push(
      `## Section ${i}`,
      "",
      IMAGE_MD,
      "",
      `| Metric ${i} | Value |`,
      "| --- | --- |",
      `| rows | ${i * 7} |`,
      `| ratio | ${i % 13} |`,
      "",
    );
    const insert = inserts[i];
    if (!insert) continue;
    for (const line of insert.lines) {
      lines.push(line);
      if (line.includes(insert.marker)) markerLine[insert.marker] = lines.length;
    }
    lines.push("");
  }
  writeFileSync(join(WORKSPACE, name), `${lines.join("\n")}\n`);
}

/** Seven frontmatter lines the editor never holds. A raw file line number
 *  applied to this document lands seven lines too low — the [RT-1] failure. */
function seedFrontmatterDocument() {
  const frontmatter = [
    "---",
    "title: Frontmatter deep",
    "author: e2e harness",
    "tags:",
    "  - alpha",
    "  - beta",
    "---",
  ];
  const body = ["# Frontmatter deep", ""];
  for (let i = 1; i <= 600; i++) {
    body.push(`Body paragraph ${i} of the frontmatter document.`);
    if (i !== 300) continue;
    body.push(`The ${FRONT_MARKER} marker sits here.`);
    markerLine[FRONT_MARKER] = body.length;
  }
  writeFileSync(
    join(WORKSPACE, FRONTMATTER_FILE),
    `${frontmatter.join("\n")}\n${body.join("\n")}\n`,
  );
}

async function pressKey(key, { meta = true, shift = false } = {}) {
  await browser.execute(
    (pressedKey, metaKey, shiftKey) => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: pressedKey,
          metaKey,
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    key,
    meta,
    shift,
  );
}

/** cmdk's input is React-controlled, so a direct `value` assignment never
 *  reaches the store. Real key events do — `addValue` types, and Backspace
 *  clears (the driver's `clear` step throws on an empty input). */
async function typeQuery(text) {
  const input = await $("[cmdk-input]");
  const current = await input.getValue();
  if (current.length > 0) {
    await browser.keys(Array.from({ length: current.length }, () => "Backspace"));
  }
  if (text.length > 0) await input.addValue(text);
}

/** The invariant the blank-palette defect violated: never zero items AND zero text. */
async function listIsBlank() {
  return browser.execute(() => {
    const list = document.querySelector("[cmdk-list]");
    if (!list) return { blank: true, reason: "no list" };
    const items = list.querySelectorAll("[cmdk-item]").length;
    const text = (list.textContent || "").trim();
    return { blank: items === 0 && text === "", items, text: text.slice(0, 120) };
  });
}

async function contentRows() {
  return browser.execute(() => {
    const rows = [...document.querySelectorAll("[cmdk-item]")]
      .filter((el) => /:\d+$/.test(el.getAttribute("data-value") || ""))
      .map((el) => ({
        value: el.getAttribute("data-value"),
        text: (el.textContent || "").trim(),
        selected: el.getAttribute("aria-selected") === "true",
      }));
    const headers = [...document.querySelectorAll("[cmdk-group]")]
      .map((g) => (g.querySelector("[cmdk-group-heading]")?.textContent || "").trim())
      .filter(Boolean);
    const highlighted = [...document.querySelectorAll("[cmdk-item] .text-link")].map((el) =>
      (el.textContent || "").trim(),
    );
    return { rows, headers, highlighted };
  });
}

/** Every jump is scheduled inside a `requestAnimationFrame`, and WebKit
 *  suspends animation frames while the window is occluded — behind another
 *  window the editor simply never scrolls and nothing reports an error. Bring
 *  the app to the front, then prove frames are running before trusting a run. */
async function activateAppWindow() {
  // Raising the window races whatever the desktop is doing, so re-assert until
  // the frame loop actually restarts rather than trusting one attempt.
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise((resolve) => {
      execFile(
        "osascript",
        ["-e", 'tell application "System Events" to set frontmost of process "Writer" to true'],
        () => resolve(),
      );
    });
    if (await framesRun()) return;
  }
  ok(false, "the app window is occluded: animation frames are suspended, so no jump can run");
}

function framesRun() {
  return browser.executeAsync((done) => {
    let fired = false;
    requestAnimationFrame(() => {
      fired = true;
      done(true);
    });
    setTimeout(() => {
      if (!fired) done(false);
    }, 2000);
  });
}

/** Where the marker line sits relative to the landing band of the editor that
 *  is on screen. Geometry only: the marker text is unique to one line of one
 *  document, so "found" already pins the line number the jump used. */
async function markerGeometry(marker) {
  return browser.execute(
    (needle, margin) => {
      const pane = [...document.querySelectorAll("[data-pane]")].find(
        (el) => getComputedStyle(el).visibility !== "hidden",
      );
      if (!pane) return { error: "no visible editor pane" };
      const content = pane.querySelector(".cm-content");
      if (!content) return { error: "no .cm-content in the visible pane" };

      let scroller = content.parentElement;
      while (scroller) {
        const { overflowY } = getComputedStyle(scroller);
        if (overflowY === "auto" || overflowY === "scroll") break;
        scroller = scroller.parentElement;
      }
      if (!scroller) return { error: "no scroller above .cm-content" };

      const box = scroller.getBoundingClientRect();
      const lines = [...content.querySelectorAll(".cm-line")];
      const hit = lines.find((el) => (el.textContent || "").includes(needle));
      const rect = hit ? hit.getBoundingClientRect() : null;
      return {
        found: Boolean(hit),
        scrollTop: scroller.scrollTop,
        maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
        landingY: box.top + margin,
        markerTop: rect ? rect.top : null,
        markerHeight: rect ? rect.height : null,
        onScreen: rect ? rect.bottom > box.top && rect.top < box.bottom : false,
        firstRenderedLine: lines.length ? (lines[0].textContent || "").slice(0, 48) : null,
      };
    },
    marker,
    SAFE_MARGIN,
  );
}

/** A line height of slack, so the assertion answers "which line landed" rather
 *  than freezing pixels. The failures it has to catch are whole lines out: the
 *  frontmatter shift is seven, the unparsed-height drift is hundreds. */
function landingSlack(geometry) {
  return Math.max(40, 1.5 * (geometry.markerHeight || 0));
}

function landed(geometry) {
  return (
    Boolean(geometry.found) &&
    Math.abs(geometry.markerTop - geometry.landingY) <= landingSlack(geometry)
  );
}

function describeGeometry(marker, geometry) {
  return `${marker}: ${JSON.stringify(geometry)}`;
}

/** Poll until the jump settles: the forced parse, the image decodes it
 *  unblocks, and the drift correction all land over several frames. */
async function waitForLanding(marker) {
  const settled = await pollLanding(marker);
  if (landed(settled)) return settled;

  // The desktop can push the window behind something while the jump is in
  // flight; WebKit then suspends animation frames and the jump's own frame
  // stays queued. Raise it and let that frame run — a jump that still does not
  // land is a real failure, and the flag says which of the two happened.
  if (await framesRun()) return { ...settled, framesRun: true };
  await activateAppWindow();
  return { ...(await pollLanding(marker)), resumedSuspendedFrames: true };
}

async function pollLanding(marker) {
  let last = await markerGeometry(marker);
  await browser
    .waitUntil(
      async () => {
        last = await markerGeometry(marker);
        return landed(last);
      },
      { timeout: 15_000, interval: 100 },
    )
    .catch(() => {});
  return last;
}

async function clickPaletteRow(predicate, what) {
  await browser.waitUntil(
    async () => {
      const values = await browser.execute(() =>
        [...document.querySelectorAll("[cmdk-item]")].map((el) => el.getAttribute("data-value")),
      );
      return values.some((value) => predicate(value || ""));
    },
    { timeout: 25_000, timeoutMsg: `no palette row for ${what}` },
  );

  for (const row of await $$("[cmdk-item]")) {
    const value = (await row.getAttribute("data-value")) || "";
    if (!predicate(value)) continue;
    await row.click();
    return;
  }
  throw new Error(`the row for ${what} vanished before it could be clicked`);
}

/** Content rows carry `${path}:${line}`, so matching the suffix asserts the
 *  scan reported that exact line — a shifted number never produces this row. */
function contentRowFor(name, line) {
  const suffix = `/${name}:${line}`.toLowerCase();
  return (value) => value.toLowerCase().endsWith(suffix);
}

function fileRowFor(name) {
  const suffix = `/${name}`.toLowerCase();
  return (value) => value.toLowerCase().endsWith(suffix);
}

async function openContentResult(name, marker) {
  await pressKey("p");
  await $("[cmdk-input]").waitForExist({ timeout: 5_000 });
  await typeQuery(marker);
  await clickPaletteRow(contentRowFor(name, markerLine[marker]), `${name}:${markerLine[marker]}`);
}

/** What the flash is painting right now. The class is pinned in `match-flash.ts`
 *  and styled in `prosemark-theme.css`; only a real render proves the two still
 *  agree, so the computed background is part of the answer. A mark can be split
 *  across several spans by other decorations, hence the join.
 *
 *  `alpha` is parsed rather than the colour compared to a string: WebKit reports
 *  a background mid-animation as `oklab(… / a)` and an unstyled one as
 *  `rgba(0, 0, 0, 0)`, so only the alpha is common ground between the two. */
async function flashState() {
  return browser.execute(() => {
    const spans = [...document.querySelectorAll(".cm-match-flash")];
    const background = spans.length ? getComputedStyle(spans[0]).backgroundColor : null;
    let alpha = null;
    if (background) {
      const inside = background.replace(/^[^(]*\(|\)\s*$/g, "");
      // `oklab(l a b / alpha)` puts alpha behind a slash, `rgba(r, g, b, a)`
      // fourth in a comma list, and an opaque colour states none at all.
      if (inside.includes("/")) alpha = Number.parseFloat(inside.split("/")[1]);
      else if (inside.split(",").length > 3) alpha = Number.parseFloat(inside.split(",")[3]);
      else alpha = 1;
    }
    return {
      count: spans.length,
      text: spans.map((el) => el.textContent || "").join(""),
      background,
      alpha,
    };
  });
}

async function openFileRow(name) {
  await pressKey("p");
  await $("[cmdk-input]").waitForExist({ timeout: 5_000 });
  await typeQuery(name.replace(/\.md$/, ""));
  await clickPaletteRow(fileRowFor(name), name);
  await $("[cmdk-input]").waitForExist({ timeout: 5_000, reverse: true });
}

describe("Content search palette", function () {
  before(async function () {
    seedWorkspace();
    await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 20_000 });

    const open = await $('[data-sidebar-surface][data-workspace-open="true"]')
      .waitForExist({ timeout: 3_000 })
      .catch(() => false);
    if (!open) {
      // The raw IPC is the Rust half only; the frontend store keeps no root.
      // Startup restores the most recent workspace, which `open_workspace`
      // has just written — so a reload is what actually opens it here.
      await browser.executeAsync((path, done) => {
        window.__TAURI_INTERNALS__
          .invoke("open_workspace", { path })
          .then(() => done(null))
          .catch((e) => done(e && e.message ? e.message : String(e)));
      }, WORKSPACE);
      await browser.execute(() => window.location.reload());
      await $('[data-sidebar-surface][data-workspace-open="true"]').waitForExist({
        timeout: 20_000,
      });
    }
    await browser.executeAsync((done) => {
      window.__TAURI_INTERNALS__
        .invoke("index_workspace")
        .then(() => done(null))
        .catch(() => done(null));
    });

    await activateAppWindow();
  });

  // macOS can move the app behind the terminal that drives it at any point, and
  // an occluded window stops running animation frames — so re-assert it here
  // rather than once in `before`.
  beforeEach(async function () {
    await activateAppWindow();
  });

  it("never renders a blank list while a content scan is pending", async function () {
    await pressKey("p");
    await $("[cmdk-input]").waitForExist({ timeout: 5_000 });

    await typeQuery(QUERY);

    // Sample continuously across the debounce + indicator window that used to
    // render nothing at all.
    const samples = [];
    for (let i = 0; i < 24; i++) {
      samples.push(await listIsBlank());
      await browser.pause(25);
    }
    const blanks = samples.filter((s) => s.blank);
    strictEqual(
      blanks.length,
      0,
      `list was blank in ${blanks.length}/${samples.length} samples: ${JSON.stringify(samples.slice(0, 3))}`,
    );
  });

  it("groups matches by file with highlighted text and line numbers", async function () {
    await browser.waitUntil(async () => (await contentRows()).rows.length > 0, {
      timeout: 20_000,
      timeoutMsg: "no content rows arrived",
    });

    const { rows, headers, highlighted } = await contentRows();
    ok(rows.length > 0, "expected content rows");
    ok(headers.includes("In documents"), `expected an "In documents" group, got ${headers}`);
    ok(
      highlighted.some((t) => t.toLowerCase() === QUERY),
      `expected "${QUERY}" highlighted, got ${JSON.stringify(highlighted.slice(0, 5))}`,
    );
    ok(
      rows.every((r) => /:\d+$/.test(r.value)),
      "every content row value must end in :<line>",
    );
    strictEqual(
      new Set(rows.map((r) => r.value)).size,
      rows.length,
      "content row values must be unique",
    );
    ok(
      rows.some((r) => /^\d+/.test(r.text)),
      "expected a line number rendered on the row",
    );

    await browser.saveScreenshot(`${SHOTS}/content-search-results.png`);
  });

  it("never shows a root-level file with a bare / as its parent", async function () {
    const dirs = await browser.execute(() =>
      [...document.querySelectorAll("[cmdk-group] .text-\\[11px\\]")].map((el) =>
        (el.textContent || "").trim(),
      ),
    );
    ok(!dirs.includes("/"), `a parent directory rendered as "/": ${JSON.stringify(dirs)}`);
  });

  it("never attributes a previous query's results to a new one", async function () {
    // Retype fast, faster than the 150 ms debounce, and watch for the old
    // query's word surviving into the new query's rendered rows.
    await typeQuery("zzzq");
    const observed = [];
    for (let i = 0; i < 10; i++) {
      observed.push(await contentRows());
      await browser.pause(20);
    }
    const leaked = observed.filter((o) => o.highlighted.some((t) => t.toLowerCase() === QUERY));
    strictEqual(
      leaked.length,
      0,
      `previous query's highlight survived into the new query in ${leaked.length} samples`,
    );
  });

  it("keeps the selection put while further batches land", async function () {
    await typeQuery(QUERY);
    await browser.waitUntil(async () => (await contentRows()).rows.length > 2, {
      timeout: 20_000,
      timeoutMsg: "not enough content rows to navigate",
    });

    await pressKey("ArrowDown", { meta: false });
    await pressKey("ArrowDown", { meta: false });
    const before = (await contentRows()).rows.find((r) => r.selected);

    await browser.pause(1_500);

    const after = (await contentRows()).rows.find((r) => r.selected);
    if (before) {
      ok(after, "selection disappeared while batches landed");
      strictEqual(after.value, before.value, "selection moved to another row");
    }
  });

  it("jumps to the clicked line deep inside a document of images and tables", async function () {
    ok(markerLine[BIG_ALPHA] > 2_000, `the target line must be deep, got ${markerLine[BIG_ALPHA]}`);

    await openContentResult(BIG_FILE, BIG_ALPHA);

    const geometry = await waitForLanding(BIG_ALPHA);
    ok(
      geometry.found,
      `line ${markerLine[BIG_ALPHA]} never rendered — ${JSON.stringify(geometry)}`,
    );
    ok(geometry.onScreen, `the target line landed off screen — ${JSON.stringify(geometry)}`);
    ok(
      landed(geometry),
      `expected the target line at the landing band — ${describeGeometry(BIG_ALPHA, geometry)}`,
    );
    ok(
      geometry.scrollTop > 0 && geometry.scrollTop < geometry.maxScrollTop,
      `the jump neither stayed at the top nor bottomed out — ${JSON.stringify(geometry)}`,
    );

    await browser.saveScreenshot(`${SHOTS}/content-search-line-jump.png`);
  });

  it("closes the palette once a content result is chosen", async function () {
    await openContentResult(BIG_FILE, BIG_ALPHA);
    await $("[cmdk-input]").waitForExist({ timeout: 5_000, reverse: true });
    strictEqual(await $("[cmdk-input]").isExisting(), false, "the palette stayed open");
  });

  it("highlights the matched words on arrival, then puts them out", async function () {
    await openContentResult(BIG_FILE, BIG_ALPHA);

    let lit = await flashState();
    await browser.waitUntil(
      async () => {
        lit = await flashState();
        return lit.count > 0;
      },
      { timeout: 5_000, timeoutMsg: "the jump landed without highlighting anything" },
    );
    strictEqual(lit.text, BIG_ALPHA, "the highlight covered something other than the match");
    // The flash has to arrive at full strength. A transparent span means the
    // class and the stylesheet have parted ways; a faint one means this jump
    // inherited the previous jump's fade instead of starting its own. The
    // keyframes hold FLASH_PEAK_ALPHA for the first half of MATCH_FLASH_MS and
    // the span is measured within ~15 ms of the click, so the margin is the
    // whole 600 ms hold.
    ok(
      lit.alpha >= FLASH_PEAK_ALPHA - 0.05,
      `the flash arrived faded or unpainted: ${lit.background}`,
    );

    // Sample the whole life of the span: the fade has to have run its course by
    // the time the decoration is removed, which is the contract that ties the
    // CSS duration to MATCH_FLASH_MS. A duration written straight into the
    // stylesheet drifts from it and is only visible here.
    let last = lit;
    await browser.waitUntil(
      async () => {
        const now = await flashState();
        if (now.count === 0) return true;
        last = now;
        return false;
      },
      {
        timeout: MATCH_FLASH_MS + 3_000,
        interval: 0,
        timeoutMsg: `the highlight was still there ${MATCH_FLASH_MS} ms after the jump`,
      },
    );
    ok(last.alpha <= 0.02, `the flash was still painting ${last.background} when it was removed`);
  });

  it("scrolls the document already on screen without reopening it", async function () {
    const before = await markerGeometry(BIG_ALPHA);
    ok(before.found, `expected ${BIG_FILE} still on screen — ${JSON.stringify(before)}`);

    await openContentResult(BIG_FILE, BIG_BETA);

    const geometry = await waitForLanding(BIG_BETA);
    ok(geometry.found, `line ${markerLine[BIG_BETA]} never rendered — ${JSON.stringify(geometry)}`);
    ok(
      landed(geometry),
      `expected the second target at the landing band — ${describeGeometry(BIG_BETA, geometry)}`,
    );
    ok(
      geometry.scrollTop < before.scrollTop - 1_000,
      `the live view never moved up to the earlier line — ${geometry.scrollTop} vs ${before.scrollTop}`,
    );
  });

  it("lands on the body line of a document with frontmatter", async function () {
    await openContentResult(FRONTMATTER_FILE, FRONT_MARKER);

    const geometry = await waitForLanding(FRONT_MARKER);
    ok(
      geometry.found,
      `body line ${markerLine[FRONT_MARKER]} never rendered — ${JSON.stringify(geometry)}`,
    );
    // Seven frontmatter lines are not in the editor's document: applying the
    // file line number would land the marker roughly seven lines above the
    // band, which this tolerance does not reach.
    ok(
      landed(geometry),
      `expected the body line at the landing band — ${describeGeometry(FRONT_MARKER, geometry)}`,
    );
  });

  it("restores the landing position, not the one from before the jump", async function () {
    const landing = await markerGeometry(FRONT_MARKER);
    ok(landing.found, `expected ${FRONTMATTER_FILE} still on screen — ${JSON.stringify(landing)}`);
    ok(landing.scrollTop > 0, "the jump under test has to have scrolled somewhere");

    await openFileRow(NEIGHBOUR_FILE);
    await browser.waitUntil(async () => !(await markerGeometry(FRONT_MARKER)).found, {
      timeout: 15_000,
      timeoutMsg: "the editor never swapped to the neighbouring file",
    });

    await openFileRow(FRONTMATTER_FILE);
    const restored = await waitForLanding(FRONT_MARKER);
    ok(restored.found, `the marker never came back — ${JSON.stringify(restored)}`);
    ok(
      Math.abs(restored.scrollTop - landing.scrollTop) <= 2,
      `restored ${restored.scrollTop}, expected the landing position ${landing.scrollTop}`,
    );
  });

  it("still follows an in-editor anchor link over an image-heavy region", async function () {
    await openFileRow(ANCHOR_FILE);
    // A rendered link is a `Decoration.mark` (hide/index.ts): a class, no href
    // attribute — the anchor is read back out of the document at the click.
    const link = await $(`.cm-rendered-link*=${ANCHOR_LINK_TEXT}`);
    await link.waitForExist({ timeout: 15_000 });

    // Put the caret in the document first, the way a reader who is editing
    // already has. `view.hasFocus` still reads false: `document.hasFocus()` is
    // false for a window driven by WebDriver, so the branch of `jumpToPos` that
    // stands down for a focused editor is not reachable from here.
    await $(`.cm-line*=${ANCHOR_FOCUS_LINE}`).click();
    await browser.execute(() => {
      const content = document.querySelector(".cm-content");
      if (content instanceof HTMLElement) content.focus();
    });

    // A rendered link with no `data-href` resolves through `posAtCoords`, and
    // the driver's own click does not carry usable client coordinates here —
    // it does not even move the focus. Dispatch the sequence with the
    // coordinates read off the element.
    const dispatched = await browser.execute((text) => {
      const el = [...document.querySelectorAll(".cm-rendered-link")].find((node) =>
        (node.textContent || "").includes(text),
      );
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      for (const type of ["mousedown", "mouseup", "click"]) {
        el.dispatchEvent(
          new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 }),
        );
      }
      return true;
    }, ANCHOR_LINK_TEXT);
    ok(dispatched, "the rendered link disappeared before it could be clicked");

    const geometry = await waitForLanding(ANCHOR_HEADING);
    ok(geometry.found, `the anchor heading never rendered — ${JSON.stringify(geometry)}`);
    ok(
      landed(geometry),
      `expected the heading at the landing band — ${describeGeometry(ANCHOR_HEADING, geometry)}`,
    );
    const marker = await markerGeometry(ANCHOR_MARKER);
    ok(marker.onScreen, `the text under the heading is off screen — ${JSON.stringify(marker)}`);
  });

  it("does not open the palette or claim zero matches without a workspace", async function () {
    // Close through the app's own command, not the raw IPC: `close_workspace`
    // is the Rust half and leaves the frontend store's `root` set, which is
    // what gates the shortcut.
    await pressKey("p");
    await $("[cmdk-input]").waitForExist({ timeout: 5_000 });
    await typeQuery("");
    const closeCommand = await $('[cmdk-item][data-value="close-workspace"]');
    await closeCommand.waitForExist({ timeout: 5_000 });
    await closeCommand.click();
    await $('[data-sidebar-surface][data-workspace-open="true"]').waitForExist({
      timeout: 10_000,
      reverse: true,
    });

    await pressKey("f", { meta: true, shift: true });
    await browser.pause(800);

    const state = await browser.execute(() => {
      const list = document.querySelector("[cmdk-list]");
      return {
        paletteOpen: Boolean(document.querySelector("[cmdk-input]")),
        text: list ? (list.textContent || "").trim() : "",
      };
    });
    strictEqual(state.paletteOpen, false, "Cmd+Shift+F opened the palette with no workspace");
    ok(!state.text.includes("No matches in documents"), `rendered a false verdict: ${state.text}`);
  });
});
