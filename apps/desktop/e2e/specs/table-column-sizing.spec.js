import { ok } from "node:assert/strict";
import { join } from "node:path";

import {
  createWorkspace,
  openWorkspace,
  removeWorkspace,
  waitForMount,
} from "../helpers/workspace.js";

// Rendered table column sizing (see SPECs/table-column-sizing-spec.md).
// `EditorView.lineWrapping` puts `overflow-wrap: anywhere` on `.cm-content`,
// which folded table cells inherit; because `anywhere` feeds min-content
// sizing, columns could be squeezed until ordinary words broke mid-word. These
// checks pin the fix: no mid-word breaks in prose, no uniform minimum width on
// trivial columns, top-aligned cells, left-aligned headers, and an explicit
// delimiter-row alignment still winning.
describe("table column sizing", function () {
  const FILE_STEM = "table-column-sizing-e2e";
  const DOC = [
    "# Table sizing check",
    "",
    "| # | Limit | Description |",
    "| --- | --- | --- |",
    "| 1 | protection | Brute force protection is applied per identity and per source " +
      "address, so a distributed attack still trips the shared counter before it can " +
      "enumerate the user table. |",
    "",
    "| Setting | Window | Rationale |",
    "| --- | --- | --- |",
    "| Login attempts | 24 hours rolling per identity | The counter resets on the first " +
      "successful authentication, so a legitimate user who eventually remembers the " +
      "password never carries a penalty into the next day, while an attacker grinding a " +
      "list of candidate passwords keeps accumulating against a ceiling. |",
    "",
    "| Left | Centered | Right | Default |",
    "| :--- | :---: | ---: | --- |",
    "| a | b | c | d |",
    "",
  ].join("\n");

  let workspace = null;
  let filePath = null;

  // Every table currently rendered, with the geometry the fix is about. A
  // mid-word break is a run of letters/digits whose client rects span more than
  // one line box; breaks at punctuation (`/`, `:`, `-`) are legitimate line
  // breaking opportunities and are deliberately not counted.
  async function measureTables() {
    return browser.execute(() => {
      return Array.from(document.querySelectorAll(".cm-table-widget table")).map((table) => {
        const columns = Array.from(table.querySelectorAll("thead th")).map((th) => ({
          text: th.textContent.trim(),
          width: Math.round(th.getBoundingClientRect().width),
          align: getComputedStyle(th).textAlign,
        }));

        const brokenWords = [];
        for (const cell of table.querySelectorAll("th, td")) {
          const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const re = /[A-Za-z0-9]+/g;
            let match;
            while ((match = re.exec(node.nodeValue))) {
              if (match[0].length < 4) continue;
              const range = document.createRange();
              range.setStart(node, match.index);
              range.setEnd(node, match.index + match[0].length);
              const tops = new Set();
              for (const rect of range.getClientRects()) {
                if (rect.width > 0) tops.add(Math.round(rect.top));
              }
              if (tops.size > 1) brokenWords.push(match[0]);
            }
          }
        }

        const firstBodyCell = table.querySelector("tbody td");
        return {
          columns,
          brokenWords,
          verticalAlign: firstBodyCell ? getComputedStyle(firstBodyCell).verticalAlign : null,
        };
      });
    });
  }

  before(async function () {
    workspace = createWorkspace("inkra-e2e-table-sizing-", { [`${FILE_STEM}.md`]: DOC });
    filePath = join(workspace, `${FILE_STEM}.md`);
    await openWorkspace(workspace);
    await waitForMount();
  });

  after(function () {
    removeWorkspace(workspace);
  });

  it("opens the seeded document from the sidebar", async function () {
    // By path rather than by rendered label: the label is the document title
    // under the default `sidebar-file-label` and the filename stem otherwise.
    const row = await $(`[data-tree-path="${filePath}"]`);
    await row.waitForExist({ timeout: 20_000 });
    await row.click();

    // Guard against measuring some other restored document: the seeded heading
    // has to be the one on screen before any geometry is trusted.
    await browser.waitUntil(
      async () => {
        const text = await $(".cm-content").getText();
        return text.includes("Table sizing check");
      },
      { timeout: 15_000, timeoutMsg: "the seeded document never became the active one" },
    );

    await browser.waitUntil(async () => (await $$(".cm-table-widget table")).length >= 3, {
      timeout: 15_000,
      timeoutMsg: "table widgets never rendered",
    });
  });

  it("never breaks ordinary prose mid-word", async function () {
    for (const table of await measureTables()) {
      ok(
        table.brokenWords.length === 0,
        `mid-word breaks in [${table.columns.map((c) => c.text).join(", ")}]: ` +
          table.brokenWords.join(", "),
      );
    }
  });

  it("sizes a trivial column to its content and keeps a starved column readable", async function () {
    const [indexTable, starvedTable] = await measureTables();

    // The `#` column holds one digit; the old blanket 6em floor made it as wide
    // as a real column.
    const indexColumn = indexTable.columns[0];
    ok(indexColumn.width < 60, `expected a narrow index column, got ${indexColumn.width}px`);

    // "24 hours rolling per identity" beside a long-prose column: the cap on the
    // prose column's demand is what leaves this one enough width to read.
    const windowColumn = starvedTable.columns[1];
    ok(windowColumn.width > 150, `expected a readable middle column, got ${windowColumn.width}px`);
  });

  it("top-aligns cells and left-aligns headers unless the delimiter row says otherwise", async function () {
    const tables = await measureTables();
    for (const table of tables) {
      ok(table.verticalAlign === "top", `expected top-aligned cells, got ${table.verticalAlign}`);
    }

    const aligned = tables[2].columns;
    ok(aligned[0].align === "left", `\`:---\` should be left, got ${aligned[0].align}`);
    ok(aligned[1].align === "center", `\`:---:\` should be center, got ${aligned[1].align}`);
    ok(aligned[2].align === "right", `\`---:\` should be right, got ${aligned[2].align}`);
    ok(aligned[3].align === "left", `an unaligned header should be left, got ${aligned[3].align}`);

    if (process.env.VERIFY_SHOT_DIR) {
      await browser.saveScreenshot(`${process.env.VERIFY_SHOT_DIR}/table-column-sizing.png`);
    }
  });
});
