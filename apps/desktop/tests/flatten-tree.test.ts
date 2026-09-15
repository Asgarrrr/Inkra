import { describe, expect, test } from "vite-plus/test";
import { flattenTree, sortTreeEntries } from "../src/components/sidebar/flatten-tree";
import type { DirEntry } from "../src/types/fs";

function file(name: string, title: string | null = null): DirEntry {
  return {
    name,
    path: `/ws/${name}`,
    is_dir: false,
    is_markdown: true,
    modified_at: 0,
    title,
  };
}

function dir(name: string): DirEntry {
  return {
    name,
    path: `/ws/${name}`,
    is_dir: true,
    is_markdown: false,
    modified_at: 0,
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
