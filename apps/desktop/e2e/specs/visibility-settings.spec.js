import { ok, strictEqual } from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { invoke, openWorkspace, waitForMount } from "../helpers/workspace.js";

// The repo is the workspace: this spec needs a README to open and enough files
// for the sidebar's Recents section to render.
const E2E_WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

async function setSetting(key, value) {
  await invoke("set_setting", { key, value, scope: "global" });
}

async function openReadme() {
  const row = await $('[data-tree-path$="/README.md"]');
  await row.waitForExist({ timeout: 10_000 });
  await row.click();
  await $("[data-document-footer]").waitForExist({ timeout: 10_000 });
}

async function footerMetricLabels() {
  return browser.execute(() => {
    const footer = document.querySelector("[data-document-footer]");
    if (!footer) return null;
    return Array.from(footer.querySelectorAll("span"))
      .map((span) => span.textContent ?? "")
      .filter((text) => /^[a-z]+$/.test(text));
  });
}

describe("status bar and sidebar visibility settings", function () {
  before(async function () {
    await openWorkspace(E2E_WORKSPACE);
    await waitForMount();
  });

  it("shows all three footer metrics by default", async function () {
    await openReadme();
    const labels = await footerMetricLabels();
    strictEqual(JSON.stringify(labels), JSON.stringify(["words", "characters", "paragraphs"]));
  });

  it("hides a single metric when its setting is off", async function () {
    await setSetting("statusbar.show-characters", false);
    await browser.refresh();
    await waitForMount();
    await openReadme();
    const labels = await footerMetricLabels();
    strictEqual(JSON.stringify(labels), JSON.stringify(["words", "paragraphs"]));
  });

  it("removes the footer entirely when every metric is off", async function () {
    await setSetting("statusbar.show-words", false);
    await setSetting("statusbar.show-paragraphs", false);
    await browser.refresh();
    await waitForMount();
    // The document restores without a footer, so wait on the editor instead.
    const row = await $('[data-tree-path$="/README.md"]');
    await row.waitForExist({ timeout: 10_000 });
    await row.click();
    await browser.pause(1_000);
    strictEqual(await $("[data-document-footer]").isExisting(), false);
  });

  it("shows the sidebar Search button by default and hides it when off", async function () {
    ok(await $("[data-sidebar-search-button]").isExisting());
    await setSetting("appearance.sidebar-show-search", false);
    await browser.refresh();
    await waitForMount();
    strictEqual(await $("[data-sidebar-search-button]").isExisting(), false);
  });

  it("keeps top, content, and bottom sidebar zones on the surface hit path", async function () {
    const hitPaths = await browser.execute(() => {
      const surface = document.querySelector("[data-sidebar-surface]");
      if (!(surface instanceof HTMLElement)) return null;
      const surfaceRect = surface.getBoundingClientRect();
      const zones = [
        document.querySelector("[data-sidebar-surface-top]"),
        document.querySelector("[data-sidebar-surface-content]"),
        document.querySelector("[data-sidebar-surface-bottom]"),
      ];
      return zones.map((zone) => {
        if (!(zone instanceof HTMLElement)) return false;
        const rect = zone.getBoundingClientRect();
        const x = Math.min(surfaceRect.right - 8, rect.left + Math.max(8, rect.width / 4));
        const y = rect.top + Math.max(1, Math.min(rect.height - 1, rect.height / 2));
        const hit = document.elementFromPoint(x, y);
        return hit?.closest("[data-sidebar-surface]") === surface;
      });
    });

    strictEqual(JSON.stringify(hitPaths), JSON.stringify([true, true, true]));
  });

  it("renders visibility toggles and the Default Terminal preference", async function () {
    await browser.execute(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "p", metaKey: true, bubbles: true, cancelable: true }),
      );
    });
    const settingsCommand = await $('[cmdk-item][data-value="open-settings"]');
    await settingsCommand.waitForExist({ timeout: 5_000 });
    await settingsCommand.click();
    await $("[data-settings-panel]").waitForExist({ timeout: 5_000 });

    const rows = await browser.execute(() => {
      const labels = Array.from(document.querySelectorAll("[data-settings-panel] section")).flatMap(
        (section) => {
          const heading = section.querySelector("h2")?.textContent ?? "";
          return Array.from(section.querySelectorAll("div.text-\\[13px\\].font-medium")).map(
            (label) => `${heading}: ${label.textContent}`,
          );
        },
      );
      return labels;
    });
    for (const expected of [
      "Appearance: Sidebar Search Button",
      "Appearance: Sidebar Recents",
      "Status Bar: Words",
      "Status Bar: Characters",
      "Status Bar: Paragraphs",
      "Workspace: Default Terminal",
    ]) {
      ok(rows.includes(expected), `missing settings row "${expected}" in ${JSON.stringify(rows)}`);
    }
    strictEqual(
      await $('input[placeholder="Platform default"]').isExisting(),
      true,
      "missing Default Terminal input",
    );
  });

  it("hides the Recents section when off", async function () {
    // Opening README earlier recorded it, so Recents should be populated.
    const recents = await $('section[aria-label="Recents"]');
    const hadRecents = await recents
      .waitForExist({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    await setSetting("appearance.sidebar-show-recents", false);
    await browser.refresh();
    await waitForMount();
    await browser.pause(1_000);
    strictEqual(await $('section[aria-label="Recents"]').isExisting(), false);
    // Only meaningful if the section was there to begin with.
    ok(hadRecents, "Recents section never appeared while enabled");
  });
});
