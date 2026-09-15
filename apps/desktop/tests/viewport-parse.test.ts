import { beforeEach, describe, expect, test, vi } from "bun:test";
import { mocked } from "./helpers/vi-compat";

// The parse target is the whole contract of `parseThrough`, and it is invisible
// through a fake view: `ensureSyntaxTree` short-circuits to `null` without a
// language state field, so nothing downstream of `forceParsing` records which
// region was asked for. Spying on the call is the only way to observe it.
vi.mock("@codemirror/language", () => ({
  forceParsing: vi.fn(),
  syntaxTreeAvailable: vi.fn(() => true),
}));

import { forceParsing } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { parseThrough } from "../src/components/editor-area/viewport-parse";

const mockedForceParsing = mocked(forceParsing);

function viewOfLength(length: number): EditorView {
  return { state: { doc: { length } } } as unknown as EditorView;
}

function lastCall() {
  const calls = mockedForceParsing.mock.calls;
  const call = calls[calls.length - 1];
  if (!call) throw new Error("forceParsing was never called");
  return { upto: call[1], budget: call[2] };
}

beforeEach(() => mockedForceParsing.mockClear());

describe("parseThrough", () => {
  test("parses past the position, not up to it", () => {
    parseThrough(viewOfLength(100_000), 5_000);

    expect(lastCall().upto).toBe(7_000);
  });

  test("never asks for a position past the end of the document", () => {
    parseThrough(viewOfLength(6_000), 5_000);

    expect(lastCall().upto).toBe(6_000);
  });

  test("parses under a time budget", () => {
    // Pinned by value: an unbudgeted parse blocks the jump on a long document.
    parseThrough(viewOfLength(100_000), 0);

    expect(lastCall().budget).toBe(50);
  });
});
