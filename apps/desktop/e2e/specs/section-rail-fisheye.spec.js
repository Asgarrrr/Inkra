import { ok, strictEqual } from "node:assert/strict";
import { join } from "node:path";

import {
  createWorkspace,
  openWorkspace,
  removeWorkspace,
  waitForMount,
} from "../helpers/workspace.js";

// Section rail fisheye: tick width and opacity fall off continuously around the
// fractional reading position (see src/components/editor-area/section-rail/section-rail.css).
// The falloff itself lives in CSS, so the unit tests cannot see it — these
// checks measure the rendered geometry in the real WKWebView instead.
describe("section rail fisheye", function () {
  const FILE_STEM = "section-rail-fisheye-e2e";
  const HEADING_COUNT = 8;
  const DOC = (() => {
    const lines = ["# Section rail fisheye check", ""];
    for (let i = 1; i <= HEADING_COUNT; i++) {
      lines.push(`## Section ${i}`, "");
      for (let p = 0; p < 12; p++) {
        lines.push(
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod " +
            "tempor incididunt ut labore et dolore magna aliqua.",
          "",
        );
      }
    }
    return lines.join("\n");
  })();

  let workspace = null;
  let filePath = null;

  // Rendered width of every tick (post-scaleX, so getBoundingClientRect, not
  // the layout width), its opacity, and the rail's current reading position.
  async function measureRail() {
    return browser.execute(() => {
      const rail = document.querySelector(".section-rail-ticks");
      if (!rail) return null;
      const ticks = Array.from(rail.querySelectorAll(".section-rail-tick"));
      return {
        position: Number(getComputedStyle(rail).getPropertyValue("--rail-pos")),
        ticks: ticks.map((tick) => ({
          width: tick.getBoundingClientRect().width,
          right: tick.getBoundingClientRect().right,
          opacity: Number(getComputedStyle(tick).opacity),
        })),
      };
    });
  }

  // The editor's scroll container has no stable class, so find it the way the
  // rail's own hook gets it: the nearest genuinely scrolling ancestor of the
  // content. `overflow-y` matters — CodeMirror's own wrappers are taller than
  // the viewport but visible, so height alone picks the wrong element.
  const FIND_SCROLLER = `
    let scroller = document.querySelector(".cm-content");
    while (scroller) {
      const overflow = getComputedStyle(scroller).overflowY;
      if (
        (overflow === "auto" || overflow === "scroll") &&
        scroller.scrollHeight > scroller.clientHeight + 1
      ) break;
      scroller = scroller.parentElement;
    }
    if (!scroller) throw new Error("no scrolling ancestor above .cm-content");`;

  async function scrollTo(top) {
    await browser.execute(
      `${FIND_SCROLLER}
       scroller.scrollTop = arguments[0] === "end" ? scroller.scrollHeight : arguments[0];`,
      top,
    );
    // The rail updates in a requestAnimationFrame coalesced off the scroll
    // event, so wait a frame before measuring.
    await browser.pause(120);
  }

  // Fraction of the *scrollable range*, not of scrollHeight: only the former
  // maps 0..1 onto top..bottom of the document.
  async function scrollToFraction(fraction) {
    await scrollTo(
      await browser.execute(
        `${FIND_SCROLLER}
         return (scroller.scrollHeight - scroller.clientHeight) * arguments[0];`,
        fraction,
      ),
    );
  }

  // CodeMirror estimates the height of lines it has not measured, so the
  // scrollable range keeps growing for a moment after a document opens. Every
  // geometry assertion here depends on it, so wait for it to settle first.
  async function settleScrollRange() {
    let previous = -1;
    await browser.waitUntil(
      async () => {
        const current = await browser.execute(`${FIND_SCROLLER}
          return scroller.scrollHeight;`);
        const stable = current === previous;
        previous = current;
        return stable;
      },
      { timeout: 15_000, interval: 300, timeoutMsg: "the scroll range never stopped changing" },
    );
  }

  before(async function () {
    workspace = createWorkspace("inkra-e2e-section-rail-", { [`${FILE_STEM}.md`]: DOC });
    filePath = join(workspace, `${FILE_STEM}.md`);
    await openWorkspace(workspace);
    await waitForMount();
  });

  after(function () {
    removeWorkspace(workspace);
  });

  it("opens the seeded document and renders one tick per heading", async function () {
    // By path rather than by rendered label: the label is the document title
    // under the default `sidebar-file-label` and the filename stem otherwise.
    const row = await $(`[data-tree-path="${filePath}"]`);
    await row.waitForExist({ timeout: 20_000 });
    await row.click();

    await browser.waitUntil(
      async () => {
        const text = await $(".cm-content").getText();
        return text.includes("Section rail fisheye check");
      },
      { timeout: 15_000, timeoutMsg: "the seeded document never became the active one" },
    );

    await browser.waitUntil(async () => (await $$(".section-rail-tick")).length > 0, {
      timeout: 15_000,
      timeoutMsg: "the section rail never rendered",
    });
    // One tick per `##`, plus the `#` title.
    strictEqual((await $$(".section-rail-tick")).length, HEADING_COUNT + 1);
  });

  it("gives the rail a hover zone wide enough to hit", async function () {
    const zone = await browser.execute(() => {
      const rail = document.querySelector(".section-rail-ticks");
      return rail.parentElement.parentElement.getBoundingClientRect().width;
    });
    ok(zone >= 22, `rail hover zone is ${zone}px, expected at least 22`);
  });

  it("peaks at the reading position and narrows away from it", async function () {
    await settleScrollRange();
    await scrollToFraction(0.4);
    const { position, ticks } = await measureRail();
    ok(
      position > 1 && position < ticks.length - 2,
      `reading position ${position} is too close to an end to read the falloff`,
    );

    // The position is fractional, so the widest tick is one of the two it sits
    // between — which one depends on the asymmetry, since the gentler read
    // slope can keep the heading behind you wider than the one just ahead.
    const widest = ticks.reduce((best, t, i) => (t.width > ticks[best].width ? i : best), 0);
    ok(
      widest === Math.floor(position) || widest === Math.ceil(position),
      `widest tick is ${widest}, reading position is ${position}`,
    );

    for (let i = widest + 1; i < ticks.length; i++) {
      ok(ticks[i].width <= ticks[i - 1].width + 0.01, `tick ${i} widened past tick ${i - 1}`);
      ok(ticks[i].opacity <= ticks[i - 1].opacity + 0.001, `tick ${i} brightened past ${i - 1}`);
    }
    for (let i = widest - 1; i >= 0; i--) {
      ok(ticks[i].width <= ticks[i + 1].width + 0.01, `tick ${i} widened past tick ${i + 1}`);
      ok(ticks[i].opacity <= ticks[i + 1].opacity + 0.001, `tick ${i} brightened past ${i + 1}`);
    }
  });

  it("keeps read headings wider and clearer than unread ones", async function () {
    await settleScrollRange();
    await scrollToFraction(0.4);
    const { position, ticks } = await measureRail();
    ok(position > 1 && position < ticks.length - 2, `reading position ${position} is at an end`);

    // Both ends of the rail are well past the position, so both sit on their
    // floor — and the read floor is the higher one.
    const read = ticks[0];
    const unread = ticks[ticks.length - 1];
    ok(read.width > unread.width * 1.5, `top tick ${read.width}px vs bottom ${unread.width}px`);
    ok(
      read.opacity > unread.opacity * 1.5,
      `top opacity ${read.opacity} vs bottom ${unread.opacity}`,
    );

    // Floors, not zero: the far end stays on screen rather than vanishing.
    ok(unread.width > 6, `far tick collapsed to ${unread.width}px`);
    ok(unread.opacity >= 0.2, `far tick faded to ${unread.opacity}`);
  });

  it("keeps every tick anchored to the same right edge", async function () {
    await scrollTo(0);
    const { ticks } = await measureRail();
    const right = ticks[0].right;
    for (const tick of ticks) {
      ok(Math.abs(tick.right - right) < 0.5, `tick right edge drifted to ${tick.right}`);
    }
  });

  it("widens a tick continuously as its heading approaches, with no step", async function () {
    await settleScrollRange();
    const range = await browser.execute(`${FIND_SCROLLER}
      return scroller.scrollHeight - scroller.clientHeight;`);
    const samples = [];
    for (let top = 0; top <= range * 0.7; top += 60) {
      await scrollTo(top);
      const rail = await measureRail();
      samples.push({ position: rail.position, widths: rail.ticks.map((t) => t.width) });
    }

    // The position slides rather than stepping: no sample jumps a whole index.
    // It can drift back a hair as CodeMirror replaces estimated line heights
    // with measured ones, so allow a fraction of an index of backward jitter.
    for (let i = 1; i < samples.length; i++) {
      const jump = samples[i].position - samples[i - 1].position;
      ok(jump > -0.25, `reading position went backwards while scrolling down: ${jump}`);
      ok(jump < 1, `reading position jumped ${jump} indices between adjacent samples`);
    }

    // Width follows it: no tick gains more than a couple of px in one step.
    for (let i = 1; i < samples.length; i++) {
      for (let t = 0; t < samples[i].widths.length; t++) {
        const delta = Math.abs(samples[i].widths[t] - samples[i - 1].widths[t]);
        ok(delta < 3, `tick ${t} width stepped by ${delta}px between adjacent scroll samples`);
      }
    }

    // And it actually moved: the run has to cross at least two headings.
    ok(
      samples[samples.length - 1].position - samples[0].position > 2,
      "the scroll run never advanced the reading position",
    );
  });

  it("brings the last tick to full width at the end of the document", async function () {
    await scrollTo("end");
    const rail = await measureRail();
    const lastTick = rail.ticks[rail.ticks.length - 1];
    strictEqual(rail.position, rail.ticks.length - 1);
    ok(
      Math.abs(lastTick.width - 20) < 0.5,
      `last tick is ${lastTick.width}px at the scroll end, expected 20`,
    );
    strictEqual(lastTick.opacity, 1);
  });
});
