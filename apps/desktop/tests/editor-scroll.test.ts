import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/lib/theme", () => ({
  applyTheme: vi.fn(),
  applyCssVarBindings: vi.fn(),
}));

import type { EditorView } from "@codemirror/view";
import { jumpScrollTop, jumpToPos } from "../src/components/editor-area/editor-scroll";
import { useEditorStore, type OpenFile } from "../src/stores/editor-store";

const PATH = "/a.md";

/** The browser clamps `scrollTop` to the scrollable range and reports the
 *  clamped value back, which is the whole point of the write-back. */
function fakeScroller({ scrollHeight = 10_000, clientHeight = 800, top = 0 }) {
  const scroller = {
    scrollTop: top,
    scrollHeight,
    clientHeight,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo: ({ top: next }: ScrollToOptions) => {
      scroller.scrollTop = Math.max(0, Math.min(next ?? 0, scrollHeight - clientHeight));
    },
  };
  return scroller as unknown as HTMLElement & { scrollTop: number };
}

function fakeView(blockTop: number): EditorView {
  return {
    documentTop: 0,
    state: { doc: { length: 100_000 } },
    lineBlockAt: () => ({ top: blockTop }),
  } as unknown as EditorView;
}

function openFileWith(scrollPos: number) {
  useEditorStore.setState({
    openFiles: new Map([[PATH, { path: PATH, scrollPos } as OpenFile]]),
  });
}

function savedScrollPos() {
  return useEditorStore.getState().openFiles.get(PATH)?.scrollPos;
}

describe("jumpScrollTop", () => {
  beforeEach(() => openFileWith(0));

  test("records the position it scrolled to", () => {
    const scroller = fakeScroller({});

    jumpScrollTop(scroller, PATH, 1280);

    expect(scroller.scrollTop).toBe(1280);
    expect(savedScrollPos()).toBe(1280);
  });

  test("records where the scroller landed, not what was asked for", () => {
    // A swap into a shorter document clamps; persisting the request would save
    // a position the container can never be at.
    const scroller = fakeScroller({ scrollHeight: 1000, clientHeight: 800 });

    jumpScrollTop(scroller, PATH, 1280);

    expect(scroller.scrollTop).toBe(200);
    expect(savedScrollPos()).toBe(200);
  });

  test("overwrites a position the scroll listener persisted in the meantime", () => {
    openFileWith(4200);
    const scroller = fakeScroller({});

    jumpScrollTop(scroller, PATH, 0);

    expect(savedScrollPos()).toBe(0);
  });
});

describe("jumpToPos", () => {
  beforeEach(() => openFileWith(0));

  test("records the clamped landing position, not the one it aimed at", () => {
    const scroller = fakeScroller({ scrollHeight: 2000, clientHeight: 800 });

    jumpToPos(fakeView(9000), scroller, PATH, 42);

    expect(scroller.scrollTop).toBe(1200);
    expect(savedScrollPos()).toBe(1200);
  });

  test("overwrites a position the scroll listener persisted in the meantime", () => {
    openFileWith(4200);
    const scroller = fakeScroller({});

    jumpToPos(fakeView(3000), scroller, PATH, 42);

    expect(savedScrollPos()).not.toBe(4200);
    expect(savedScrollPos()).toBe(scroller.scrollTop);
  });
});
