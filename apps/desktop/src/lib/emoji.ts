import { EMOJI_BY_NAME } from "./emoji-table";

// Reproduces node-emoji's `normalizeName`: the test is deliberately unanchored,
// so anything carrying a colon pair loses its first and last character.
function normalizeName(name: string): string {
  return /:.+:/.test(name) ? name.slice(1, -1) : name;
}

/** Resolves an emoji shortcode, with or without surrounding colons. */
export function getEmoji(codeOrName: string): string | undefined {
  const name = normalizeName(codeOrName);
  // Names come from document text, so `:constructor:` has to miss rather than
  // resolve to an inherited member of the table's prototype.
  return Object.prototype.hasOwnProperty.call(EMOJI_BY_NAME, name)
    ? EMOJI_BY_NAME[name]
    : undefined;
}
