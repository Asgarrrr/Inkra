import { defineConfig } from "vite-plus";

export default defineConfig({
  // Formatting and linting moved to Biome; its ignore patterns live in
  // `biome.jsonc`. This block only still exists to drive the pre-commit hook.
  staged: {
    "*": "biome check --write --no-errors-on-unmatched --files-ignore-unknown=true",
  },
});
