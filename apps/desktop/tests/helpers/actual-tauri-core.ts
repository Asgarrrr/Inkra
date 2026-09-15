import * as tauriCore from "@tauri-apps/api/core";

/** `mock.module` replaces a module for every importer, not just the test, and a
 *  factory returning only `{ invoke }` therefore breaks the rest of the Tauri
 *  API: `@tauri-apps/api/dpi` statically imports `SERIALIZE_TO_IPC_FN` from
 *  here, so anything reaching `@tauri-apps/api/window` fails to link. Spread
 *  this snapshot — taken before any mock is installed — into such a factory to
 *  keep the untouched exports real. */
export const actualTauriCore = { ...tauriCore };
