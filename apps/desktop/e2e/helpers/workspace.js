// Workspace lifecycle for specs: raw IPC, a host-side temp workspace, and the
// open-plus-reload dance that actually lands the app in it.
//
// Every spec owns the workspace it asserts against. Opening one only when
// nothing was restored — the shape this replaced — silently accepted whatever
// the previous spec file left in `recent_workspaces.json`, and the failure
// named the missing element rather than the wrong workspace.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Call a Rust IPC command from inside the WKWebView. Throws on failure, so a
 *  broken precondition surfaces as itself rather than as a later assertion. */
export async function invoke(cmd, args) {
  const result = await browser.executeAsync(
    (cmdName, cmdArgs, done) => {
      window.__TAURI_INTERNALS__
        .invoke(cmdName, cmdArgs)
        .then((value) => done({ ok: true, value }))
        .catch((error) =>
          done({ ok: false, error: error && error.message ? error.message : String(error) }),
        );
    },
    cmd,
    args ?? {},
  );
  if (!result.ok) throw new Error(`${cmd} failed: ${result.error}`);
  return result.value;
}

/**
 * Create a temp workspace and write `files` into it, keyed by relative path.
 *
 * Written host-side rather than through the `write_file` IPC: the watcher
 * suppresses the app's own writes as self-writes, so a file seeded that way
 * never reaches the tree (measured at 0 rows 12s after the write). Writing
 * before the workspace is opened means the startup index sees it instead.
 *
 * The directory is returned resolved, because the Rust side canonicalizes a
 * workspace root — `/tmp/x` becomes `/private/tmp/x` — and specs address rows
 * by `data-tree-path`.
 */
export function createWorkspace(prefix, files) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

export function removeWorkspace(dir) {
  if (dir) rmSync(dir, { recursive: true, force: true });
}

/**
 * Open `path` as the workspace and wait for the sidebar to report it open.
 *
 * `open_workspace` is the Rust half only; the frontend store keeps no root, so
 * the reload is what opens it on screen — startup restores the most recent
 * workspace, which `open_workspace` has just written.
 */
export async function openWorkspace(path) {
  await $("#root > *").waitForExist({ timeout: 20_000 });
  await invoke("open_workspace", { path });
  await browser.refresh();
  await $('[data-sidebar-surface][data-workspace-open="true"]').waitForExist({ timeout: 20_000 });
}

/** The sidebar toggle only exists once the workspace shell has mounted. */
export async function waitForMount() {
  await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 20_000 });
}
