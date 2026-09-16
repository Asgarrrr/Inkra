import { ok, strictEqual } from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const E2E_WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const README = `${E2E_WORKSPACE}/README.md`;

async function invoke(cmd, args) {
  const result = await browser.executeAsync(
    (cmdName, cmdArgs, done) => {
      window.__TAURI_INTERNALS__
        .invoke(cmdName, cmdArgs)
        .then((value) => done({ ok: true, value }))
        .catch((error) =>
          done({ ok: false, error: error && error.message ? error.message : String(error) }),
        );
    },
    cmd,
    args,
  );
  if (!result.ok) throw new Error(`${cmd} failed: ${result.error}`);
  return result.value;
}

async function setSetting(key, value) {
  await invoke("set_setting", { key, value, scope: "global" });
}

async function waitForMount() {
  await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 15_000 });
}

describe("sidebar composition refactor", function () {
  before(async function () {
    const restored = await $('[data-sidebar-surface][data-workspace-open="true"]')
      .waitForExist({ timeout: 3_000 })
      .catch(() => false);
    if (!restored) {
      await invoke("open_workspace", { path: E2E_WORKSPACE });
      await browser.refresh();
    }
    await $("[data-sidebar-surface]").waitForExist({ timeout: 15_000 });

    // The e2e data dir persists settings between runs, so a sidebar collapsed
    // by an earlier run would hide every row this spec drives. Settings are
    // only picked up on reload, as in the other specs.
    await setSetting("appearance.sidebar-visible", true);
    await setSetting("appearance.sidebar-show-recents", true);
    await browser.refresh();
    await waitForMount();
  });

  describe("the Everything tree", function () {
    it("expands a folder on click", async function () {
      const folder = await $(`[data-tree-path="${E2E_WORKSPACE}/apps"]`);
      await folder.waitForExist({ timeout: 10_000 });
      strictEqual(await folder.getAttribute("aria-expanded"), "false");

      await folder.click();
      await browser.waitUntil(
        async () =>
          (await $(`[data-tree-path="${E2E_WORKSPACE}/apps"]`).getAttribute("aria-expanded")) ===
          "true",
        { timeout: 10_000, timeoutMsg: "folder never expanded" },
      );
      await $(`[data-tree-path="${E2E_WORKSPACE}/apps/desktop"]`).waitForExist({ timeout: 10_000 });
    });

    it("opens a file on click", async function () {
      const file = await $(`[data-tree-path="${README}"]`);
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
      await browser.execute((path) => {
        document.querySelector(`[data-tree-path="${path}"]`)?.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            metaKey: true,
            button: 0,
            isPrimary: true,
          }),
        );
      }, README);

      await browser.waitUntil(
        async () =>
          browser.execute(
            (path) =>
              (
                document.querySelector(`[data-tree-path="${path}"]`)?.getAttribute("class") ?? ""
              ).includes("surface-selected"),
            README,
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
      await $(`[data-tree-path="${README}"]`).click();
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
