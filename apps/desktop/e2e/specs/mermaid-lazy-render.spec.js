import { ok } from "node:assert/strict";

// The mermaid renderer (beautiful-mermaid + its ~1.5 MB elkjs layout engine) is
// loaded on demand, so the first diagram of a session mounts an empty canvas and
// fills in when the import resolves. Unit tests cover the renderer's pending
// result; only the real app exercises the path that matters — that the deferred
// SVG actually lands in the widget. A broken hand-off would leave a blank
// 480px frame with no error, which is exactly the failure mode that does not
// announce itself.
//
// Same workspace requirement as latex-math.spec.js: seed
// `~/Library/Application Support/com.inkra.e2e/recent_workspaces.json` with a
// real directory before launching, or this suite self-skips.
describe("mermaid deferred rendering", function () {
  const FILE_STEM = "mermaid-lazy-e2e";
  const DOC = ["# Diagram check", "", "```mermaid", "graph TD", "  A-->B", "```", ""].join("\n");

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
    ok(root, "no workspace root to seed the diagram document into");

    filePath = `${root}/${FILE_STEM}.md`;
    const wrote = await invoke("write_file", { path: filePath, content: DOC });
    ok(wrote.ok, `failed to seed ${filePath}: ${wrote.error}`);

    // `write_file` is the app's own write path and the watcher suppresses it as
    // a self-write, so the tree never learns the file exists; reload instead of
    // waiting. The reload also re-reads `sidebar-visible`, which an earlier run
    // may have persisted as collapsed, and resets the JS module registry — so
    // the assertion below really does exercise a cold renderer.
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

  it("fills the canvas with an SVG once the renderer loads", async function () {
    const row = await $(`[data-tree-path="${filePath}"]`);
    await row.waitForExist({ timeout: 15_000 });
    await row.click();

    // The frame mounts synchronously at its fixed height...
    await $(".cm-mermaid-canvas").waitForExist({ timeout: 15_000 });

    // ...and the diagram arrives once the dynamic import resolves.
    await browser.waitUntil(
      async () => {
        const svg = await $(".cm-mermaid-canvas-stage > svg");
        return await svg.isExisting();
      },
      {
        timeout: 15_000,
        timeoutMsg: "mermaid SVG never rendered — the deferred import did not reach the widget",
      },
    );

    const errors = await $$(".cm-mermaid-canvas-error-msg");
    ok(errors.length === 0, "mermaid canvas rendered an error instead of a diagram");
  });

  it("keeps the widget at its fixed height, so nothing below it shifts", async function () {
    const canvas = await $(".cm-mermaid-canvas");
    await canvas.waitForExist({ timeout: 15_000 });
    const { height } = await canvas.getSize();
    ok(height === 480, `expected the 480px fixed frame, got ${height}px`);
  });
});
