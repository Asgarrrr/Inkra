import { ok } from "node:assert/strict";
import { join } from "node:path";

import {
  createWorkspace,
  openWorkspace,
  removeWorkspace,
  waitForMount,
} from "../helpers/workspace.js";

// LaTeX math rendering verification: seeds a markdown file containing inline
// `$...$` and display `$$...$$` math into this suite's own workspace, opens it
// from the sidebar, and asserts the KaTeX fold widgets render and unfold to
// raw source when the selection enters the math range
// (see SPECs/latex-math-spec.md).
describe("LaTeX math rendering", function () {
  const FILE_STEM = "latex-math-e2e";
  const DOC = [
    "# Math check",
    "",
    "Euler: $e^{i\\pi} + 1 = 0$ inline.",
    "",
    "$$\\sum_{i=1}^n i = \\frac{n(n+1)}{2}$$",
    "",
    "I paid $5 and $10 more.",
    "",
  ].join("\n");

  let workspace = null;
  let filePath = null;

  before(async function () {
    workspace = createWorkspace("inkra-e2e-latex-math-", { [`${FILE_STEM}.md`]: DOC });
    filePath = join(workspace, `${FILE_STEM}.md`);
    await openWorkspace(workspace);
    await waitForMount();
  });

  after(function () {
    removeWorkspace(workspace);
  });

  it("opens the seeded document from the sidebar", async function () {
    // Address the row by path, not by its rendered label: that label is the
    // document title under the default `sidebar-file-label` but the filename
    // stem when the setting says so.
    const row = await $(`[data-tree-path="${filePath}"]`);
    await row.waitForExist({ timeout: 15_000 });
    await row.click();

    await browser.waitUntil(async () => (await $$(".cm-content")).length > 0, {
      timeout: 10_000,
      timeoutMsg: "editor never mounted",
    });
  });

  it("renders inline and display math as KaTeX widgets when the caret is elsewhere", async function () {
    const inline = await $(".cm-math-widget:not(.cm-math-display) .katex");
    await inline.waitForExist({ timeout: 10_000 });

    const display = await $(".cm-math-widget.cm-math-display .katex-display");
    await display.waitForExist({ timeout: 10_000 });

    if (process.env.VERIFY_SHOT_DIR) {
      await browser.saveScreenshot(`${process.env.VERIFY_SHOT_DIR}/latex-math-rendered.png`);
    }
  });

  it("leaves currency prose as plain text", async function () {
    const widgets = await $$(".cm-math-widget");
    // Exactly the two seeded formulas — "$5 and $10" must not become math.
    ok(widgets.length === 2, `expected 2 math widgets, got ${widgets.length}`);
    const content = await $(".cm-content").getText();
    ok(content.includes("I paid $5 and $10 more."), "currency sentence should stay literal");
  });

  it("unfolds to raw source when the widget is clicked", async function () {
    // Press and release like a person, rather than `element.click()`.
    // `selectAllDecorationsOnSelectExtension` handles mousedown and defers its
    // range-select by `setTimeout(0)` (`prosemark-core/fold/core.ts`), so a
    // WebDriver click — whose mouseup lands effectively in the same tick —
    // collapses the selection again before the unfold is observable, and the
    // widget refolds. Measured: mousedown alone unfolds, mousedown plus a
    // mouseup 150ms later unfolds, `element.click()` does not.
    await browser.execute(() => {
      const widget = document.querySelector(".cm-math-widget:not(.cm-math-display)");
      const box = widget.getBoundingClientRect();
      const init = {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      };
      widget.dispatchEvent(new MouseEvent("mousedown", init));
      window.setTimeout(() => widget.dispatchEvent(new MouseEvent("mouseup", init)), 150);
    });

    // The click-to-edit handler range-selects the math node; the fold drops
    // and the raw delimiters become part of the visible document text.
    await browser.waitUntil(
      async () => {
        const text = await $(".cm-content").getText();
        return text.includes("$e^{i\\pi} + 1 = 0$");
      },
      { timeout: 5_000, timeoutMsg: "inline math never unfolded to source" },
    );

    if (process.env.VERIFY_SHOT_DIR) {
      await browser.saveScreenshot(`${process.env.VERIFY_SHOT_DIR}/latex-math-unfolded.png`);
    }
  });
});
