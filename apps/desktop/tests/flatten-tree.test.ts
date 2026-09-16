import { describe, expect, test } from "vite-plus/test";
import { flattenTree, sortTreeEntries } from "../src/components/sidebar/flatten-tree";
import { SIDEBAR_SORT_MODES } from "../src/components/sidebar/sidebar-sort";
import { SETTINGS_SCHEMA } from "../src/lib/settings-schema";
import type { DirEntry } from "../src/types/fs";

function file(
  name: string,
  title: string | null = null,
  times: { modified?: number; created?: number } = {},
): DirEntry {
  return {
    name,
    path: `/ws/${name}`,
    is_dir: false,
    is_markdown: true,
    modified_at: times.modified ?? 0,
    created_at: times.created ?? 0,
    title,
  };
}

function dir(name: string, times: { modified?: number; created?: number } = {}): DirEntry {
  return {
    name,
    path: `/ws/${name}`,
    is_dir: true,
    is_markdown: false,
    modified_at: times.modified ?? 0,
    created_at: times.created ?? 0,
    title: null,
  };
}

const names = (entries: DirEntry[]) => entries.map((e) => e.name);

describe("sortTreeEntries", () => {
  test("orders files by their title, falling back to the filename stem", () => {
    const entries = [
      file("zebra.md", "Apples"),
      file("alpha.md", "Zucchini"),
      file("middle.md"),
      file("beta.md", "Bananas"),
    ];

    expect(names(sortTreeEntries(entries, "title"))).toEqual([
      "zebra.md",
      "beta.md",
      "middle.md",
      "alpha.md",
    ]);
  });

  test("orders by filename stem in filename mode", () => {
    const entries = [file("zebra.md", "Apples"), file("alpha.md", "Zucchini")];

    expect(names(sortTreeEntries(entries, "filename"))).toEqual(["alpha.md", "zebra.md"]);
  });

  test("keeps folders first, sorted by name, regardless of file titles", () => {
    const entries = [file("a.md", "Aardvark"), dir("zoo"), dir("Barn"), file("b.md")];

    expect(names(sortTreeEntries(entries, "title"))).toEqual(["Barn", "zoo", "a.md", "b.md"]);
  });

  test("sorts naturally and ignores case and accents", () => {
    const entries = [
      file("c.md", "Chapter 10"),
      file("b.md", "chapter 2"),
      file("a.md", "Étude"),
      file("d.md", "dessert"),
    ];

    expect(names(sortTreeEntries(entries, "title"))).toEqual(["b.md", "c.md", "d.md", "a.md"]);
  });

  test("breaks label ties by filename so the order is stable", () => {
    const entries = [file("second.md", "Notes"), file("first.md", "Notes")];

    expect(names(sortTreeEntries(entries, "title"))).toEqual(["first.md", "second.md"]);
  });

  test("name-desc reverses the label order and keeps folders first A–Z", () => {
    const entries = [file("a.md", "Apples"), dir("zoo"), file("b.md", "Bananas"), dir("Barn")];

    expect(names(sortTreeEntries(entries, "title", "name-desc"))).toEqual([
      "Barn",
      "zoo",
      "b.md",
      "a.md",
    ]);
  });

  test("modified modes order files by modified time and leave folders alphabetical", () => {
    const entries = [
      file("old.md", "Zed", { modified: 10 }),
      dir("later", { modified: 99 }),
      file("new.md", "Alpha", { modified: 30 }),
      dir("early", { modified: 1 }),
      file("mid.md", "Mid", { modified: 20 }),
    ];

    expect(names(sortTreeEntries(entries, "title", "modified-desc"))).toEqual([
      "early",
      "later",
      "new.md",
      "mid.md",
      "old.md",
    ]);
    expect(names(sortTreeEntries(entries, "title", "modified-asc"))).toEqual([
      "early",
      "later",
      "old.md",
      "mid.md",
      "new.md",
    ]);
  });

  test("created modes order files by created time", () => {
    const entries = [
      file("b.md", "B", { created: 5, modified: 50 }),
      file("a.md", "A", { created: 9, modified: 10 }),
    ];

    expect(names(sortTreeEntries(entries, "title", "created-desc"))).toEqual(["a.md", "b.md"]);
    expect(names(sortTreeEntries(entries, "title", "created-asc"))).toEqual(["b.md", "a.md"]);
  });

  test("time modes fall back to the label order on equal timestamps", () => {
    const entries = [file("b.md", "Beta", { modified: 7 }), file("a.md", "Alpha", { modified: 7 })];

    expect(names(sortTreeEntries(entries, "title", "modified-desc"))).toEqual(["a.md", "b.md"]);
  });

  test("an unknown or missing sort mode sorts by name", () => {
    const entries = [file("b.md", "Beta", { modified: 1 }), file("a.md", "Alpha", { modified: 9 })];

    expect(names(sortTreeEntries(entries, "title"))).toEqual(["a.md", "b.md"]);
    expect(names(sortTreeEntries(entries, "title", "bogus"))).toEqual(["a.md", "b.md"]);
  });

  test("with folders first off, name mode interleaves folders and files by label", () => {
    const entries = [file("a.md", "Zebra"), dir("Middle"), file("b.md", "Apple"), dir("banana")];

    expect(names(sortTreeEntries(entries, "title", "name-asc", false))).toEqual([
      "b.md",
      "banana",
      "Middle",
      "a.md",
    ]);
    expect(names(sortTreeEntries(entries, "title", "name-desc", false))).toEqual([
      "a.md",
      "Middle",
      "banana",
      "b.md",
    ]);
  });

  test("with folders first off, time modes order folders by their own timestamps", () => {
    const entries = [
      file("old.md", null, { modified: 10, created: 10 }),
      dir("recent", { modified: 30, created: 5 }),
      file("new.md", null, { modified: 20, created: 20 }),
    ];

    expect(names(sortTreeEntries(entries, "title", "modified-desc", false))).toEqual([
      "recent",
      "new.md",
      "old.md",
    ]);
    expect(names(sortTreeEntries(entries, "title", "created-asc", false))).toEqual([
      "recent",
      "old.md",
      "new.md",
    ]);
  });

  test("folders first defaults on and matches the schema default", () => {
    const entries = [file("a.md", "Apple"), dir("zoo")];
    const setting = SETTINGS_SCHEMA.find((def) => def.key === "appearance.sidebar-folders-first");

    expect(setting?.default).toBe(true);
    expect(names(sortTreeEntries(entries, "title", "name-asc"))).toEqual(["zoo", "a.md"]);
    expect(names(sortTreeEntries(entries, "title", "name-asc", true))).toEqual(["zoo", "a.md"]);
  });

  test("the sort registry matches the setting's schema options", () => {
    const setting = SETTINGS_SCHEMA.find((def) => def.key === "appearance.sidebar-sort");

    expect(setting?.options).toEqual(SIDEBAR_SORT_MODES.map((mode) => mode.id));
    expect(setting?.default).toBe(SIDEBAR_SORT_MODES[0].id);
  });

  test("does not mutate the cached array", () => {
    const entries = [file("b.md"), file("a.md")];
    const before = [...entries];

    sortTreeEntries(entries, "title");

    expect(entries).toEqual(before);
  });
});

describe("flattenTree", () => {
  test("sorts every expanded level by label", () => {
    const root = [file("z.md", "Alpha"), dir("notes"), file("a.md", "Omega")];
    const cache = new Map<string, DirEntry[]>([
      [
        "/ws/notes",
        [file("y.md", "Beta"), file("x.md", "Gamma")].map((e) => ({
          ...e,
          path: `/ws/notes/${e.name}`,
        })),
      ],
    ]);

    const flat = flattenTree(root, 0, cache, new Set(["/ws/notes"]), "title");

    expect(flat.map((item) => [item.entry.name, item.depth])).toEqual([
      ["notes", 0],
      ["y.md", 1],
      ["x.md", 1],
      ["z.md", 0],
      ["a.md", 0],
    ]);
  });
});
