import { describe, expect, test } from "vite-plus/test";
import {
  clearPendingTarget,
  consumePendingTarget,
  setPendingTarget,
} from "../src/lib/pending-target";

describe("pending-target", () => {
  test("carries a heading target to the path it was set for", () => {
    setPendingTarget("/a.md", { kind: "heading", slug: "intro" });

    expect(consumePendingTarget("/a.md")).toEqual({ kind: "heading", slug: "intro" });
  });

  test("carries a line target to the path it was set for", () => {
    setPendingTarget("/b.md", { kind: "line", line: 42, matchRanges: [] });

    expect(consumePendingTarget("/b.md")).toEqual({ kind: "line", line: 42, matchRanges: [] });
  });

  test("consuming removes the target, so it cannot fire on a later navigation", () => {
    setPendingTarget("/c.md", { kind: "line", line: 7, matchRanges: [] });

    expect(consumePendingTarget("/c.md")).toEqual({ kind: "line", line: 7, matchRanges: [] });
    expect(consumePendingTarget("/c.md")).toBeUndefined();
  });

  test("a path with no target consumes to undefined", () => {
    expect(consumePendingTarget("/never-set.md")).toBeUndefined();
  });

  test("two paths do not interfere", () => {
    setPendingTarget("/d.md", { kind: "heading", slug: "d" });
    setPendingTarget("/e.md", { kind: "line", line: 3, matchRanges: [] });

    expect(consumePendingTarget("/d.md")).toEqual({ kind: "heading", slug: "d" });
    expect(consumePendingTarget("/e.md")).toEqual({ kind: "line", line: 3, matchRanges: [] });
  });

  test("setting again replaces the target instead of queueing a second one", () => {
    setPendingTarget("/f.md", { kind: "heading", slug: "first" });
    setPendingTarget("/f.md", { kind: "line", line: 9, matchRanges: [] });

    expect(consumePendingTarget("/f.md")).toEqual({ kind: "line", line: 9, matchRanges: [] });
    expect(consumePendingTarget("/f.md")).toBeUndefined();
  });

  test("clearing removes the target without handing it to anyone", () => {
    setPendingTarget("/g.md", { kind: "heading", slug: "g" });

    clearPendingTarget("/g.md");

    expect(consumePendingTarget("/g.md")).toBeUndefined();
  });

  test("clearing one path leaves another path's target intact", () => {
    setPendingTarget("/h.md", { kind: "heading", slug: "h" });
    setPendingTarget("/i.md", { kind: "line", line: 1, matchRanges: [] });

    clearPendingTarget("/h.md");

    expect(consumePendingTarget("/h.md")).toBeUndefined();
    expect(consumePendingTarget("/i.md")).toEqual({ kind: "line", line: 1, matchRanges: [] });
  });

  test("clearing a path that has no target is harmless", () => {
    clearPendingTarget("/j.md");

    expect(consumePendingTarget("/j.md")).toBeUndefined();
  });
});
