// Generates src/lib/emoji-table.ts from emojilib.
//
// node-emoji pulls in emojilib's 256 KB emojis.json for its keyword and
// category fields, none of which this app reads: the only call is `get()`.
// Committing the name -> char projection keeps that lookup at parity for
// ~28 KB and drops the runtime dependency.
//
// Run: node scripts/generate-emoji-table.mjs

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const emojilib = require("emojilib");

// Mirrors node-emoji's own projection (src/data.ts): entries of `emojilib.lib`
// reduced to [name, char]. Keeping the same source and the same order means the
// generated table can be diffed against `emoji.get` key for key.
const entries = Object.entries(emojilib.lib).map(([name, { char }]) => [name, char]);

const missing = entries.filter(([, char]) => typeof char !== "string" || char.length === 0);
if (missing.length > 0) {
  throw new Error(`emojilib entries without a char: ${missing.map(([name]) => name).join(", ")}`);
}

// Emit keys the way the formatter would rewrite them, so regenerating the table
// produces no diff beyond the emoji that actually changed.
const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const body = entries
  .map(([name, char]) => {
    const key = identifier.test(name) ? name : JSON.stringify(name);
    return `  ${key}: ${JSON.stringify(char)},`;
  })
  .join("\n");

const output = `// GENERATED FILE - do not edit.
// Run \`node scripts/generate-emoji-table.mjs\` to regenerate.
// Source: emojilib@${require("emojilib/package.json").version} (\`lib\`, projected to name -> char).

export const EMOJI_BY_NAME: Record<string, string> = {
${body}
};
`;

const target = fileURLToPath(new URL("../src/lib/emoji-table.ts", import.meta.url));
writeFileSync(target, output);
// eslint-disable-next-line no-console
console.log(`wrote ${entries.length} entries to ${target}`);
