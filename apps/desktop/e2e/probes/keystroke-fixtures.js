// Document fixtures for the keystroke latency probe, plus the pre-run state
// reset the measurement depends on.
//
// Run directly to prepare a run:
//
//   node ./probes/keystroke-fixtures.js
//
// That creates a temp workspace, seeds the four documents, pins it as the
// only recent workspace, and clears the session state. `sessions.json` replays
// the previous run's tab *and scroll position*, so a run made without this
// reset measures an unknown starting state and is worthless as evidence.
//
// Generation is deterministic — a fixed word list walked by a fixed index, no
// Math.random — so two runs on two days type into byte-identical documents.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export const APP_DATA_DIR = join(homedir(), "Library", "Application Support", "com.inkra.e2e");

const WORDS = [
  "the",
  "writer",
  "keeps",
  "a",
  "plain",
  "text",
  "vault",
  "because",
  "markdown",
  "outlives",
  "every",
  "editor",
  "that",
  "renders",
  "it",
  "and",
  "a",
  "local",
  "file",
  "needs",
  "no",
  "account",
  "to",
  "open",
];

/** Deterministic prose: the word list walked by a counter, never shuffled. */
function makeParagraph(seed, wordCount) {
  const words = [];
  for (let i = 0; i < wordCount; i += 1) {
    words.push(WORDS[(seed + i * 7) % WORDS.length]);
  }
  const sentence = words.join(" ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/** The marker whose line the table-cell interaction types into. */
export const TABLE_MARKER = "cellmark";
/** Byte-size targets the generators fill to. */
const SIZES = {
  tiny: 2 * 1024,
  medium: 50 * 1024,
  large: 500 * 1024,
  dense: 50 * 1024,
};

function proseDocument(title, targetBytes) {
  const lines = [`# ${title}`, ""];
  let bytes = lines.join("\n").length;
  let section = 0;

  while (bytes < targetBytes) {
    section += 1;
    const block = [`## Section ${section}`, ""];
    for (let p = 0; p < 4; p += 1) {
      block.push(makeParagraph(section * 13 + p * 3, 40), "");
    }
    const text = block.join("\n");
    lines.push(...block);
    bytes += text.length + 1;
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Tables, math, images and mermaid — the constructs that carry block widgets
 * and so the ones whose decoration rebuild plausibly costs the most per edit.
 *
 * The target table is the first block, so the caret can reach it from the top
 * of the document without a long walk.
 */
function denseDocument(targetBytes) {
  const lines = [
    "# Dense constructs",
    "",
    "| Name | Value | Note |",
    "| --- | --- | --- |",
    `| ${TABLE_MARKER} | 1 | target row |`,
    "| beta | 2 | filler |",
    "",
  ];
  let bytes = lines.join("\n").length;
  let block = 0;

  while (bytes < targetBytes) {
    block += 1;
    const chunk = [
      `## Block ${block}`,
      "",
      makeParagraph(block * 5, 30),
      "",
      `| Metric ${block} | Value | Delta |`,
      "| --- | --- | --- |",
      `| rows | ${block * 7} | ${block % 5} |`,
      `| ratio | ${block % 13} | ${block % 3} |`,
      "",
      `$$\\sum_{i=1}^{${block}} i = \\frac{${block}(${block}+1)}{2}$$`,
      "",
      `![diagram ${block}](./missing-${block}.png)`,
      "",
      "```mermaid",
      "graph TD",
      `  A${block}[Start] --> B${block}[Middle]`,
      `  B${block} --> C${block}[End]`,
      "```",
      "",
      `Inline math $e^{i\\pi} + 1 = 0$ and a [link](./other-${block}.md).`,
      "",
    ];
    const text = chunk.join("\n");
    lines.push(...chunk);
    bytes += text.length + 1;
  }

  return `${lines.join("\n")}\n`;
}

export const FIXTURES = [
  { name: "tiny.md", build: () => proseDocument("Tiny", SIZES.tiny) },
  { name: "medium.md", build: () => proseDocument("Medium", SIZES.medium) },
  { name: "large.md", build: () => proseDocument("Large", SIZES.large) },
  { name: "dense.md", build: () => denseDocument(SIZES.dense) },
];

/** Write the four documents into `dir`. Returns their paths and real sizes. */
export function seedWorkspace(dir) {
  mkdirSync(dir, { recursive: true });
  return FIXTURES.map(({ name, build }) => {
    const content = build();
    const path = join(dir, name);
    writeFileSync(path, content);
    return { name, path, bytes: Buffer.byteLength(content), lines: content.split("\n").length };
  });
}

/**
 * Pin `dir` as the only recent workspace and clear replayed session state.
 *
 * Without this the app restores whichever workspace and scroll position the
 * last run left behind, and every number below is measured against an unknown
 * starting state.
 */
export function resetAppState(dir) {
  mkdirSync(APP_DATA_DIR, { recursive: true });
  writeFileSync(join(APP_DATA_DIR, "recent_workspaces.json"), JSON.stringify([dir], null, 2));
  writeFileSync(join(APP_DATA_DIR, "sessions.json"), JSON.stringify({}, null, 2));
  writeFileSync(join(APP_DATA_DIR, "recent_files.json"), JSON.stringify([], null, 2));
}

/** Create a temp workspace, seed it, and reset the app state to point at it. */
export function prepare() {
  const dir = mkdtempSync(join(tmpdir(), "inkra-keystroke-"));
  const seeded = seedWorkspace(dir);
  resetAppState(dir);
  return { dir, seeded };
}

if (process.argv[1] && process.argv[1].endsWith("keystroke-fixtures.js")) {
  const { dir, seeded } = prepare();
  for (const f of seeded) {
    console.log(`  ${f.name.padEnd(10)} ${String(f.bytes).padStart(7)} bytes  ${f.lines} lines`);
  }
  console.log(dir);
}
