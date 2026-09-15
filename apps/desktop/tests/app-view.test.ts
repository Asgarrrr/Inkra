import { describe, expect, test } from "bun:test";
import { resolveAppView } from "../src/lib/app-view";

describe("resolveAppView", () => {
  test("keeps the workspace shell and welcome content when no workspace is open", () => {
    expect(resolveAppView(null, "workspace")).toBe("workspace-welcome");
  });

  test("keeps standalone compact windows sidebar-free", () => {
    expect(resolveAppView(null, "compact-file")).toBe("compact-file");
  });

  test("renders the editor inside the workspace shell for an open workspace", () => {
    expect(resolveAppView("/vault", "workspace")).toBe("workspace-editor");
  });
});
