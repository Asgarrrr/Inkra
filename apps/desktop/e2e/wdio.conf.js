import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Built by `pnpm run build:app` (cargo tauri build --features e2e).
// `productName` in tauri.conf.json names the .app bundle ("Inkra.app") but
// the binary inside MacOS/ keeps the Cargo crate name ("desktop") — Tauri
// does not rename it.
const RELEASE_DIR = resolve(__dirname, "../src-tauri/target/release");
const APP_BINARY = resolve(RELEASE_DIR, "bundle/macos/Inkra.app/Contents/MacOS/desktop");

/** @type {import('node:child_process').ChildProcess | undefined} */
let proxy;

/**
 * Processes already running out of this repo's release directory.
 *
 * Matching the directory rather than `APP_BINARY` is deliberate: the bundled
 * binary and the bare `target/release/desktop` are the same build launched two
 * ways, and either one holds the single-instance lock.
 */
function findRunningApps() {
  // Escape the path for pgrep's ERE — a checkout under a directory with a `.`
  // or `+` in its name would otherwise match more than intended.
  const pattern = RELEASE_DIR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let output;
  try {
    output = execFileSync("pgrep", ["-fl", pattern], { encoding: "utf8" });
  } catch {
    // pgrep exits 1 when nothing matches, which is the common case.
    return [];
  }

  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const gap = line.indexOf(" ");
      return { pid: Number(line.slice(0, gap)), command: line.slice(gap + 1) };
    })
    .filter((p) => Number.isInteger(p.pid) && p.pid !== process.pid);
}

/** @type {import('@wdio/types').Options.Testrunner} */
export const config = {
  runner: "local",
  specs: ["./specs/**/*.spec.js"],
  maxInstances: 1,
  capabilities: [
    {
      "tauri:options": {
        application: APP_BINARY,
      },
    },
  ],
  hostname: "127.0.0.1",
  port: 4444,
  path: "/",
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "warn",
  waitforTimeout: 15_000,
  connectionRetryTimeout: 30_000,
  connectionRetryCount: 0,
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },

  onPrepare: async function () {
    if (!existsSync(APP_BINARY)) {
      throw new Error(
        `App binary not found at ${APP_BINARY}\n` +
          "Run `pnpm run build:app` first (or use `pnpm run test:e2e`).",
      );
    }

    // The app registers `tauri_plugin_single_instance`, so launching it while
    // another copy is alive hands the launch to that copy and exits. WebDriver
    // then drives whatever WebView that process already had — stale assets,
    // stale settings, whatever state the earlier session accumulated — and the
    // run reports green against a build that is not the one under test.
    //
    // A run that finishes normally leaves nothing behind, so reaching this
    // means an earlier run crashed or was interrupted, or someone launched the
    // app by hand. Refuse rather than guess: a silently wrong pass is worse
    // than a loud stop, and killing someone's editor is not this script's call
    // to make unattended.
    const running = findRunningApps();
    if (running.length > 0) {
      const listed = running.map((p) => `  ${p.pid}  ${p.command}`).join("\n");
      if (process.env.E2E_KILL_STALE !== "1") {
        throw new Error(
          `Refusing to start: ${running.length} process(es) are already running from\n` +
            `${RELEASE_DIR}\n\n${listed}\n\n` +
            "Because of tauri-plugin-single-instance this run would attach to one of\n" +
            "them instead of booting the build you just made, and would pass against\n" +
            "the wrong app.\n\n" +
            "Quit them (check for unsaved notes first), or re-run with\n" +
            "E2E_KILL_STALE=1 to have this script terminate them.",
        );
      }

      console.warn(`E2E_KILL_STALE=1 — terminating ${running.length} process(es):\n${listed}`);
      for (const { pid } of running) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // Already gone between the scan and here; the recheck below decides.
        }
      }

      // Confirm rather than assume: the whole point is that a survivor silently
      // invalidates the run.
      for (let attempt = 0; attempt < 20 && findRunningApps().length > 0; attempt += 1) {
        await new Promise((r) => setTimeout(r, 250));
      }
      const survivors = findRunningApps();
      if (survivors.length > 0) {
        throw new Error(
          `Could not terminate: ${survivors.map((p) => p.pid).join(", ")}. Quit them manually.`,
        );
      }
    }

    proxy = spawn("tauri-webdriver", [], { stdio: "inherit" });
    proxy.on("error", (err) => {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") {
        console.error(
          "tauri-webdriver not found on PATH.\n" +
            "Install once with: cargo install tauri-webdriver --locked",
        );
      }
    });

    // Give the intermediary a moment to bind to localhost:4444 before wdio
    // tries to create a session.
    await new Promise((r) => setTimeout(r, 1500));
  },

  onComplete: async function () {
    if (proxy && !proxy.killed) {
      const exited = new Promise((r) => proxy.once("exit", r));
      proxy.kill("SIGTERM");
      // Wait for clean exit so a follow-up run doesn't hit "port in use".
      await exited;
    }
  },
};
