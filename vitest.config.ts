import { defineConfig } from "vitest/config";

// One command for the whole monorepo. Each project resolves its own
// `vite.config.ts`, so `apps/desktop` keeps the `include` that holds the
// WebDriver `e2e/**/*.spec.js` files out of the unit run.
export default defineConfig({
  test: {
    projects: ["apps/desktop", "apps/website"],
  },
});
