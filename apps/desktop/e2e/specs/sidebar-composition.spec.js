import { ok, strictEqual } from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openWorkspace, waitForMount } from "../helpers/workspace.js";

// The repo itself is the workspace: this spec needs a real tree with a folder
// to expand and a file to open. `WorkspaceIgnore::load` walks with
// `git_ignore(true)` and filters `.git` and `node_modules` explicitly, so
// `target/` and `node_modules/` never enter the walk.
const E2E_WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const README = `${E2E_WORKSPACE}/README.md`;

/** A row of the Everything tree, addressed unambiguously.
 *
 *  `data-tree-path` alone is not enough: the flat Recents list carries the same
 *  attribute and renders *above* the tree, so a bare `querySelector` returns a
 *  `FileRow` — which has no pointer-down selection handler, being the row that
 *  deliberately does not borrow the tree's. Whether README is in Recents
 *  depends on file mtimes, so the bare selector is a coin toss. */
function treeRow(path) {
  return `[role="tree"][aria-label="File tree"] [data-tree-path="${path}"]`;
}

describe("sidebar composition refactor", function () {
  before(async function () {
    await openWorkspace(E2E_WORKSPACE);
    await waitForMount();
  });

  describe("the Everything tree", function () {
    it("expands a folder on click", async function () {
      const folder = await $(treeRow(`${E2E_WORKSPACE}/apps`));
      await folder.waitForExist({ timeout: 10_000 });
      strictEqual(await folder.getAttribute("aria-expanded"), "false");

      await folder.click();
      await browser.waitUntil(
        async () =>
          (await $(treeRow(`${E2E_WORKSPACE}/apps`)).getAttribute("aria-expanded")) === "true",
        { timeout: 10_000, timeoutMsg: "folder never expanded" },
      );
      await $(treeRow(`${E2E_WORKSPACE}/apps/desktop`)).waitForExist({ timeout: 10_000 });
    });

    it("opens a file on click", async function () {
      const file = await $(treeRow(README));
      await file.waitForExist({ timeout: 10_000 });
      await file.click();

      // The tab is labelled with the resolved document title, not the
      // filename, so assert on the window title and the mounted editor.
      await browser.waitUntil(async () => (await browser.getTitle()).startsWith("README.md"), {
        timeout: 10_000,
        timeoutMsg: "README never became the active document",
      });
      ok(await $(".cm-editor").isExisting(), "no editor mounted");
    });

    it("cmd-clicks a row into the selection", async function () {
      // Selection lives in FileTree and is applied on pointer-down. The split
      // moved the row markup into FileTreeRow; this checks the tree still owns
      // the click rather than the row handling it itself.
      await browser.execute((selector) => {
        document.querySelector(selector)?.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            metaKey: true,
            button: 0,
            isPrimary: true,
          }),
        );
      }, treeRow(README));

      await browser.waitUntil(
        async () =>
          browser.execute(
            (selector) =>
              (document.querySelector(selector)?.getAttribute("class") ?? "").includes(
                "surface-selected",
              ),
            treeRow(README),
          ),
        { timeout: 5_000, timeoutMsg: "cmd-click did not select the row" },
      );
    });
  });

  describe("the flat Recents list", function () {
    it("renders rows without a disclosure control and opens them on click", async function () {
      const recents = await $('[role="tree"][aria-label="Recents"]');
      await recents.waitForExist({ timeout: 10_000 });

      const rows = await recents.$$("[data-tree-path]");
      ok(rows.length > 0, "Recents rendered no rows");

      // FileRow lists files at one level: no folder, so no aria-expanded,
      // unlike a FileTreeNode directory row.
      strictEqual(await rows[0].getAttribute("aria-expanded"), null);

      await rows[0].click();
      await browser.waitUntil(async () => $(".cm-editor").isExisting(), {
        timeout: 10_000,
        timeoutMsg: "clicking a Recents row opened no editor",
      });
    });
  });

  describe("the document footer", function () {
    // Guards the geometry the reverted footer-hoist broke: whatever renders
    // the footer, it must stay flush with the editor column.
    it("stays flush with the editor column", async function () {
      await $(treeRow(README)).click();
      await $("[data-document-footer]").waitForExist({ timeout: 10_000 });

      const geometry = await browser.execute(() => {
        const el = document.querySelector("[data-document-footer]");
        const box = el.getBoundingClientRect();
        const parent = el.parentElement.getBoundingClientRect();
        return {
          bottomGap: Math.round(parent.bottom - box.bottom),
          leftGap: Math.round(box.left - parent.left),
          width: Math.round(box.width),
          parentWidth: Math.round(parent.width),
        };
      });
      strictEqual(geometry.bottomGap, 0, "footer is not flush with the editor column bottom");
      strictEqual(geometry.leftGap, 0, "footer is not flush with the editor column left");
      strictEqual(geometry.width, geometry.parentWidth, "footer does not span the editor column");
    });
  });
});
