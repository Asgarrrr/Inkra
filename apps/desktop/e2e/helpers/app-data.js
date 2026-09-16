// The e2e build's application data directory, and the reset that keeps one
// spec file's state out of the next one's run.

import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where the e2e build persists `recent_workspaces.json`, `sessions.json`,
 * `recent_files.json` and `config`.
 *
 * Safe to delete: `src-tauri/tauri.conf.json` ships `com.inkra`, and only the
 * e2e build overrides the identifier to `com.inkra.e2e` (`package.json`
 * `build:app`). The real app's data lives in a different directory.
 */
export const APP_DATA_DIR = join(homedir(), "Library", "Application Support", "com.inkra.e2e");

/**
 * Delete the whole directory, so the app boots with no restored workspace, no
 * replayed session and default settings.
 *
 * Every carrier that coupled one spec file to another lives in here.
 * `recent_workspaces.json` handed the next spec someone else's workspace;
 * `sessions.json` replayed the previous run's tab *and its scroll position*;
 * `config` persisted a collapsed sidebar or a changed `sidebar-file-label`.
 */
export function resetAppData() {
  rmSync(APP_DATA_DIR, { recursive: true, force: true });
}
