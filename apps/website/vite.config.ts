import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";

const tauriConfPath = fileURLToPath(
  new URL("../desktop/src-tauri/tauri.conf.json", import.meta.url),
);
const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf-8")) as {
  version: string;
};

const RELEASE_REPO = "Asgarrrr/Inkra";
const VERSION = tauriConf.version;
const DMG_URL = `https://github.com/${RELEASE_REPO}/releases/download/v${VERSION}/Inkra__aarch64.dmg`;
const RELEASES_URL = `https://github.com/${RELEASE_REPO}/releases/tag/v${VERSION}`;
const REPO_URL = "https://github.com/Asgarrrr/Inkra";

export default defineConfig({
  plugins: [
    devtools(),
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: true,
      },
    }),
    react(),
  ],
  server: {
    port: 5173,
  },
  define: {
    __INKRA_VERSION__: JSON.stringify(VERSION),
    __INKRA_DMG_URL__: JSON.stringify(DMG_URL),
    __INKRA_RELEASES_URL__: JSON.stringify(RELEASES_URL),
    __INKRA_REPO_URL__: JSON.stringify(REPO_URL),
    // The site shares the desktop app's PostHog project, whose key lives in the
    // repo-root `.env` as `INKRA_POSTHOG_KEY`. That name has no `VITE_` prefix,
    // so Vite will not expose it — these two lines are the bridge.
    //
    // Bridged one variable at a time, by name, and nothing else. That `.env`
    // also holds the Apple credentials and the Tauri updater signing key, so
    // widening `envDir` to the repo root, calling `loadEnv` with an empty
    // prefix, or forwarding `process.env` wholesale would put signing secrets
    // in a public bundle. Adding a name here is the only way in, and it should
    // stay that way. Absent variables become `""`, which
    // `resolveAnalyticsConfig` reads as unconfigured.
    __INKRA_POSTHOG_KEY__: JSON.stringify(process.env.INKRA_POSTHOG_KEY ?? ""),
    __INKRA_POSTHOG_HOST__: JSON.stringify(process.env.INKRA_POSTHOG_HOST ?? ""),
  },
});
