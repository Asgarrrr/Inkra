import { describe, expect, test } from "vite-plus/test";
import { createRequire } from "node:module";
import * as nodeEmoji from "node-emoji";
import { getEmoji } from "../src/lib/emoji";
import { EMOJI_BY_NAME } from "../src/lib/emoji-table";

// The committed table replaces node-emoji at runtime. node-emoji and emojilib
// stay dev dependencies purely so this comparison keeps running: it is what
// makes a regeneration of emoji-table.ts safe to trust.
const emojilib = createRequire(import.meta.url)("emojilib") as {
  lib: Record<string, { char: string }>;
};
const names = Object.keys(emojilib.lib);

describe("emoji table parity with node-emoji", () => {
  test("covers every emojilib entry", () => {
    expect(names.length).toBeGreaterThan(1500);
    expect(Object.keys(EMOJI_BY_NAME)).toHaveLength(names.length);
  });

  test("resolves every name identically, bare and colon-wrapped", () => {
    const divergent: string[] = [];
    for (const name of names) {
      if (getEmoji(name) !== nodeEmoji.get(name)) divergent.push(name);
      if (getEmoji(`:${name}:`) !== nodeEmoji.get(`:${name}:`)) divergent.push(`:${name}:`);
    }
    expect(divergent).toEqual([]);
  });

  test("matches node-emoji on inputs that are not emoji names", () => {
    for (const input of [
      "",
      "nope",
      ":nope:",
      "constructor",
      ":constructor:",
      "__proto__",
      "::",
      ":a",
      "a:",
    ]) {
      expect(getEmoji(input)).toBe(nodeEmoji.get(input));
    }
  });
});
