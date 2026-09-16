// Reduce the JSONL from several probe runs into one table.
//
//   node ./probes/keystroke-report.js /tmp/keystroke.jsonl
//
// Pools the raw samples across runs per cell rather than averaging each run's
// median: five medians of thirty samples averaged is not the median of a
// hundred and fifty, and the p95 of a pooled tail is the number a writer
// actually feels.

import { readFileSync } from "node:fs";

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

const path = process.argv[2] ?? "/tmp/keystroke.jsonl";
const lines = readFileSync(path, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const cells = new Map();
for (const line of lines) {
  if (!cells.has(line.cell)) {
    cells.set(line.cell, { runs: 0, samples: [], notes: new Set(), origins: new Set() });
  }
  const cell = cells.get(line.cell);
  cell.runs += 1;
  if (line.note) cell.notes.add(line.note);
  for (const s of line.raw ?? []) {
    if (s.t2 === null || s.t3 === null) continue;
    cell.origins.add(`${s.origin}${s.trusted ? "" : "/untrusted"}`);
    cell.samples.push({
      inputDelay: s.t1 - s.t0,
      processing: s.t2 - s.t1,
      presentation: s.t3 - s.t2,
      total: s.t3 - s.t1,
      totalFromEvent: s.t3 - s.t0,
      trusted: s.trusted,
    });
  }
}

const fmt = (v) => (v === null ? "  —  " : v.toFixed(1).padStart(5));
const header = [
  "cell".padEnd(30),
  "n".padStart(5),
  "total50".padStart(8),
  "total95".padStart(8),
  "proc50".padStart(7),
  "proc95".padStart(7),
  "pres50".padStart(7),
  "pres95".padStart(7),
  "in50".padStart(6),
  " origin",
].join(" ");
console.log(header);
console.log("-".repeat(header.length));

let maxResidual = 0;
for (const [name, cell] of cells) {
  const s = cell.samples;
  if (s.length === 0) {
    console.log(`${name.padEnd(30)} ${"0".padStart(5)}  NOT MEASURED`);
    continue;
  }
  const pick = (k) => s.map((x) => x[k]);
  const allTrusted = s.every((x) => x.trusted);

  // Reconciliation: the segments must close the total they are cut from.
  for (const x of s) {
    const basis = allTrusted ? x.totalFromEvent : x.total;
    const sum = (allTrusted ? x.inputDelay : 0) + x.processing + x.presentation;
    maxResidual = Math.max(maxResidual, Math.abs(sum - basis));
  }

  const totals = allTrusted ? pick("totalFromEvent") : pick("total");
  console.log(
    [
      name.padEnd(30),
      String(s.length).padStart(5),
      fmt(percentile(totals, 50)),
      fmt(percentile(totals, 95)),
      fmt(percentile(pick("processing"), 50)),
      fmt(percentile(pick("processing"), 95)),
      fmt(percentile(pick("presentation"), 50)),
      fmt(percentile(pick("presentation"), 95)),
      allTrusted ? fmt(percentile(pick("inputDelay"), 50)) : "  —  ",
      ` ${[...cell.origins].join(",")}`,
    ].join(" "),
  );
  for (const note of cell.notes) console.log(`${" ".repeat(32)}NOTE ${note}`);
}

console.log(`\nruns pooled: ${Math.max(...[...cells.values()].map((c) => c.runs))}`);
console.log(`max segment/total residual: ${maxResidual.toExponential(2)} ms`);
console.log("in50 is blank where the opening event was untrusted (see FINDINGS).");
