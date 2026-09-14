import { ok, strictEqual } from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), "../screenshots");
const WORKSPACE = join(tmpdir(), "writer-e2e-content-search");
const QUERY = "throughput";

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

describe("Content search palette", function () {
  before(async function () {
    seedWorkspace();
    await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 20_000 });

    const open = await $('[data-sidebar-surface][data-workspace-open="true"]')
      .waitForExist({ timeout: 3_000 })
      .catch(() => false);
    if (!open) {
      await browser.executeAsync((path, done) => {
        window.__TAURI_INTERNALS__
          .invoke("open_workspace", { path })
          .then(() => done(null))
          .catch((e) => done(e && e.message ? e.message : String(e)));
      }, WORKSPACE);
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

  it("does not open the palette or claim zero matches without a workspace", async function () {
    // Close through the app's own command, not the raw IPC: `close_workspace`
    // is the Rust half and leaves the frontend store's `root` set, which is
    // what gates the shortcut.
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
