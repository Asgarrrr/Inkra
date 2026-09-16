import { ok, strictEqual } from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { invoke, openWorkspace, waitForMount } from "../helpers/workspace.js";

const E2E_WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const INITIAL_STACK = 'Custom Primary, Georgia, "Times New Roman", serif';
const SELECTED_STACK = 'Menlo, Georgia, "Times New Roman", serif';

describe("Settings font selects", function () {
  before(async function () {
    await openWorkspace(E2E_WORKSPACE);

    // A stored stack with a non-installed primary and a fallback tail: the
    // test precondition for "changes the primary while preserving the tail".
    // Settings are only picked up on reload.
    await invoke("set_setting", { key: "fonts.mono", value: INITIAL_STACK, scope: "global" });
    await browser.refresh();
    await waitForMount();
  });

  async function pressCmd(key) {
    await browser.execute((pressedKey) => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: pressedKey,
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, key);
  }

  it("opens settings via the command palette", async function () {
    await pressCmd("p");
    const settingsCommand = await $('[cmdk-item][data-value="open-settings"]');
    await settingsCommand.waitForExist({ timeout: 5_000 });
    await settingsCommand.click();
    await $("[data-settings-panel]").waitForExist({ timeout: 5_000 });
  });

  it("renders one Typography section with ordinary installed-font selects", async function () {
    const typography = await $('//section[.//h2[normalize-space()="Typography"]]');
    await typography.waitForExist({ timeout: 5_000 });
    strictEqual((await $$('//section[.//h2[normalize-space()="Typography"]]')).length, 1);
    strictEqual((await $$('//section[.//h2[normalize-space()="Fonts"]]')).length, 0);

    const labels = ["UI font", "Editor font", "Code font"];
    let optionCounts;
    await browser.waitUntil(
      async () => {
        optionCounts = await browser.execute(
          (fontLabels) =>
            fontLabels.map((label) => {
              const select = document.querySelector(`select[aria-label="${label}"]`);
              if (!(select instanceof HTMLSelectElement) || select.disabled) return 0;
              return select.options.length;
            }),
          labels,
        );
        return optionCounts.every((count) => count > 20);
      },
      { timeout: 10_000, timeoutMsg: "installed font options did not load" },
    );
    labels.forEach((label, index) => {
      ok((optionCounts?.[index] ?? 0) > 20, `${label} should list installed families`);
    });

    strictEqual(await typography.$("input").isExisting(), false);
    strictEqual(await typography.$('button[aria-label^="Show Fonts"]').isExisting(), false);
    strictEqual(await $('[role="dialog"][aria-label="Installed fonts"]').isExisting(), false);
  });

  it("changes the primary family while preserving the stored fallback tail", async function () {
    const initialFamily = await browser.execute(() => {
      const fontSelect = document.querySelector('select[aria-label="Code font"]');
      return fontSelect instanceof HTMLSelectElement ? fontSelect.value : null;
    });
    strictEqual(initialFamily, "Custom Primary");
    await browser.execute(() => {
      const fontSelect = document.querySelector('select[aria-label="Code font"]');
      if (!(fontSelect instanceof HTMLSelectElement)) throw new Error("font select missing");
      fontSelect.value = "Menlo";
      fontSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    let cssVariable;
    await browser.waitUntil(
      async () => {
        cssVariable = await browser.execute(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--mono-font"),
        );
        return cssVariable.includes("Menlo");
      },
      { timeout: 5_000, timeoutMsg: "--mono-font did not update to Menlo" },
    );

    let persisted;
    await browser.waitUntil(
      async () => {
        persisted = await browser.executeAsync((key, done) => {
          window.__TAURI_INTERNALS__
            .invoke("get_setting", { key })
            .then((value) => done(value))
            .catch((error) =>
              done(`ERROR: ${error && error.message ? error.message : String(error)}`),
            );
        }, "fonts.mono");
        return persisted === SELECTED_STACK;
      },
      { timeout: 5_000, timeoutMsg: `font setting did not persist: ${persisted}` },
    );
    const selectedFamily = await browser.execute(() => {
      const fontSelect = document.querySelector('select[aria-label="Code font"]');
      return fontSelect instanceof HTMLSelectElement ? fontSelect.value : null;
    });
    strictEqual(selectedFamily, "Menlo");
  });
});
