import { ok } from "node:assert/strict";
import { join } from "node:path";

import {
  createWorkspace,
  openWorkspace,
  removeWorkspace,
  waitForMount,
} from "../helpers/workspace.js";

// The mermaid renderer (beautiful-mermaid + its ~1.5 MB elkjs layout engine) is
// loaded on demand, so the first diagram of a session mounts an empty canvas and
// fills in when the import resolves. Unit tests cover the renderer's pending
// result; only the real app exercises the path that matters — that the deferred
// SVG actually lands in the widget. A broken hand-off would leave a blank
// 480px frame with no error, which is exactly the failure mode that does not
// announce itself.
//
// `openWorkspace` reloads the page after opening, which resets the JS module
// registry — so the assertion below really does exercise a cold renderer.
describe("mermaid deferred rendering", function () {
  const FILE_STEM = "mermaid-lazy-e2e";
  const DOC = ["# Diagram check", "", "```mermaid", "graph TD", "  A-->B", "```", ""].join("\n");

  let workspace = null;
  let filePath = null;

  before(async function () {
    workspace = createWorkspace("inkra-e2e-mermaid-", { [`${FILE_STEM}.md`]: DOC });
    filePath = join(workspace, `${FILE_STEM}.md`);
    await openWorkspace(workspace);
    await waitForMount();
  });

  after(function () {
    removeWorkspace(workspace);
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
