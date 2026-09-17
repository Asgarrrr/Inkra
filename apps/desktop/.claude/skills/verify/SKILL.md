---
name: verify
description: Build, launch, and drive the Inkra desktop app to verify a change end-to-end via the WebDriver e2e harness. Use when a change to apps/desktop needs runtime verification (GUI surface).
---

# Verifying Inkra desktop changes

The surface is a macOS Tauri GUI. Drive it through the repo's WebdriverIO +
tauri-webdriver harness in `apps/desktop/e2e/` (see its README for one-time
setup: `cargo install tauri-webdriver --locked`).

## Build

```sh
cd apps/desktop/src-tauri
cargo tauri build --features e2e --bundles app --ignore-version-mismatches \
  --config '{"identifier":"com.inkra.e2e","bundle":{"createUpdaterArtifacts":false}}'
```

Gotchas:

- `--ignore-version-mismatches` is required while the npm `@tauri-apps/*`
  packages lag the Rust crates; without it the CLI hard-errors before
  building.
- The bundle lands at
  `src-tauri/target/release/bundle/macos/Inkra.app/Contents/MacOS/desktop`
  (binary keeps the crate name). Incremental rebuilds are fast; the first
  build is slow.
- Rebuild after every frontend change too — the app ships the built assets.

## Launch state

The e2e app uses its own data dir:
`~/Library/Application Support/com.inkra.e2e`. `wdio.conf.js` deletes it
before every `specs/**` session, so each spec file boots to the welcome screen
with default settings and no restored workspace. Do not seed
`recent_workspaces.json` — the reset would throw it away.

A spec opens its own workspace instead, through `e2e/helpers/workspace.js`:
`createWorkspace(prefix, files)` for a temp workspace seeded host-side, then
`openWorkspace(dir)`; or `openWorkspace(repoRoot)` when the spec needs a real
tree. `openWorkspace` invokes `open_workspace` and reloads — the reload is what
actually lands the app in the workspace, since startup restores the most recent
one and `open_workspace` has just written it.

Probes under `e2e/probes/` are exempt from the reset and pin their own state
(`node ./probes/keystroke-fixtures.js`).

## Drive

```sh
cd apps/desktop/e2e
vp exec wdio run ./wdio.conf.js --spec ./specs/<your>.spec.js
```

- Wait for `#root > *` to detect the React mount, and for
  `button[aria-label="Hide sidebar"]` to detect the workspace shell. There is
  no `.animate-fade-in` wrapper.
- Address a sidebar row by `[data-tree-path="<abs path>"]`, never by its
  rendered label — the label follows the `appearance.sidebar-file-label`
  setting. Scope to `[role="tree"][aria-label="File tree"]` when you mean the
  Everything tree: the Recents list carries the same attribute and renders
  above it.
- Key chords through the driver are flaky on WKWebView; dispatch synthetic
  `KeyboardEvent`s via `browser.execute` instead (Cmd+P opens the palette;
  palette items are `[cmdk-item][data-value="<command-id>"]`).
- `setValue` on empty inputs can throw in the driver's `clear` step — use
  `addValue`.
- Real Rust IPC is reachable via
  `window.__TAURI_INTERNALS__.invoke(cmd, args)` inside
  `browser.executeAsync` (see `specs/smoke.spec.js`).
- Screenshots: `browser.saveScreenshot(absPath)`.
- `specs/font-picker.spec.js` is a working example of palette → settings →
  select driving; `specs/content-search.spec.js` of a spec that builds and
  owns a whole temp workspace.
