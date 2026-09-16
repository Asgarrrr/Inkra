import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/lib/theme", () => ({
  applyTheme: vi.fn(),
  applyCssVarBindings: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../src/stores/editor-store";

const mockedInvoke = vi.mocked(invoke);

// Measures what the store *retains*, not what the process resides in. An
// earlier attempt sampled the WebContent process's RSS while driving the real
// app and could not resolve a few hundred KB per note: GC timing, WebKit's
// page cache and process reuse swamped the signal, and successive runs
// disagreed by 2x — one even reported memory falling as notes were opened.
// Retention is a property of the store's own policy, so measure it there,
// where it is exact and deterministic.

const NOTE_CHARS = 100_000;
const NOTE_COUNT = 12;

function noteBody(index: number): string {
  return `# Note ${index}\n\n${"lorem ipsum dolor sit amet ".repeat(NOTE_CHARS / 26)}`;
}

/** Characters of note text the store is holding, across every open file. */
function retainedChars(): { files: number; chars: number; copiesPerFile: number } {
  const files = [...useEditorStore.getState().openFiles.values()];
  let chars = 0;
  for (const file of files) {
    chars += file.content.length;
    chars += file.diskContent.length;
    chars += file.frontmatter?.length ?? 0;
  }
  const perFile = files.length > 0 ? chars / files.length : 0;
  return {
    files: files.length,
    chars,
    copiesPerFile: files.length > 0 ? perFile / (noteBody(0).length || 1) : 0,
  };
}

function resetStore() {
  useEditorStore.setState({
    openFiles: new Map(),
    tabs: [],
    activeTabId: null,
    activeFilePath: null,
  });
}

describe("editor store retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === "read_file") {
        const path = (args as { path?: string } | undefined)?.path ?? "";
        const index = Number(path.match(/note-(\d+)/)?.[1] ?? 0);
        return { content: noteBody(index), frontmatter: null, modified_at: 0, created_at: 0 };
      }
      if (command === "file_exists") return true;
      return null;
    });
  });

  test("holds two full copies of the text for every open note", async () => {
    await useEditorStore.getState().openFile("/w/note-0.md");

    const file = useEditorStore.getState().openFiles.get("/w/note-0.md");
    expect(file).toBeDefined();
    // `content` is the buffer and `diskContent` the last-known disk state; both
    // are the whole document, so an untouched note costs twice its own size.
    expect(file!.content.length).toBe(noteBody(0).length);
    expect(file!.diskContent.length).toBe(noteBody(0).length);
    expect(file!.content).toBe(file!.diskContent);
  });

  test("navigating one tab through many notes retains every one of them", async () => {
    const store = useEditorStore.getState();
    await store.openFile("/w/note-0.md");
    for (let i = 1; i < NOTE_COUNT; i += 1) {
      await useEditorStore.getState().navigateToFile(`/w/note-${i}.md`);
    }

    const retained = retainedChars();
    // Nothing is pruned: `maybePruneFiles` keeps any path a tab references, and
    // a tab references its whole back/forward history.
    expect(retained.files).toBe(NOTE_COUNT);
    expect(retained.copiesPerFile).toBeCloseTo(2, 1);

    const rawChars = NOTE_COUNT * noteBody(0).length;
    expect(retained.chars).toBeCloseTo(rawChars * 2, -3);
  });

  test("closing the tab releases the whole history", () => {
    const tabId = useEditorStore.getState().tabs[0]?.id;
    if (!tabId) return;
    useEditorStore.getState().closeTab(tabId);
    expect(retainedChars().files).toBe(0);
  });
});
