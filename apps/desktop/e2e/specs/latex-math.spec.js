import { ok } from "node:assert/strict";

// LaTeX math rendering verification: seeds a markdown file containing inline
// `$...$` and display `$$...$$` math into the restored workspace, opens it
// from the sidebar, and asserts the KaTeX fold widgets render and unfold to
// raw source when the selection enters the math range
// (see SPECs/latex-math-spec.md).
//
// Requires a restorable workspace: seed
// `~/Library/Application Support/com.inkra.e2e/recent_workspaces.json`
// with a real directory before launching. Without one the app lands on the
// welcome screen and this suite self-skips, so it stays safe inside the
// default `pnpm run test:e2e` sweep.
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

  let workspaceRestored = false;
  let filePath = null;

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

  before(async function () {
    workspaceRestored = await $('[data-sidebar-surface][data-workspace-open="true"]')
      .waitForExist({ timeout: 15_000 })
      .catch(() => false);
    if (!workspaceRestored) return;

    const recents = await invoke("get_recent_workspaces", {});
    const root = recents.ok && Array.isArray(recents.value) ? recents.value[0] : null;
    ok(root, "no workspace root to seed the math document into");

    filePath = `${root}/${FILE_STEM}.md`;
    const wrote = await invoke("write_file", { path: filePath, content: DOC });
    ok(wrote.ok, `failed to seed ${filePath}: ${wrote.error}`);

    // `write_file` is the app's own write path, so the watcher suppresses it
    // as a self-write and the tree is never told the file appeared — measured
    // at 0 rows 12s after the write, and 2 after a reload. Reload rather than
    // wait: this suite is about KaTeX rendering, and should not stand or fall
    // on watcher propagation (tracked separately under the external-watcher
    // miss work in TODOS.md).
    //
    // The e2e data dir also persists `appearance.sidebar-visible` between
    // runs, and a sidebar collapsed by an earlier run hides the row this
    // suite clicks. Settings are only picked up on reload, so both fixes ride
    // the same refresh.
    await invoke("set_setting", {
      key: "appearance.sidebar-visible",
      value: true,
      scope: "global",
    });
    await browser.refresh();
    await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 15_000 });
  });

  beforeEach(function () {
    if (!workspaceRestored) this.skip();
  });

  after(async function () {
    if (filePath) await invoke("delete_entry", { path: filePath });
  });

  it("opens the seeded document from the sidebar", async function () {
    // Address the row by path, not by its rendered label: that label is the
    // document title under the default `sidebar-file-label` but the filename
    // stem when the setting says so, and the e2e data dir carries whichever
    // an earlier run left behind.
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
