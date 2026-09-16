import { appendFileSync } from "node:fs";

// Startup measurement probe. Not part of the e2e sweep — `wdio.conf.js` only
// globs `./specs/**`, so this runs only when asked for by path:
//
//   VITE_STARTUP_METRICS=1 cargo tauri build --features e2e --bundles app \
//     --config '{"identifier":"com.inkra.e2e","bundle":{"createUpdaterArtifacts":false}}'
//   for i in 1 2 3 4 5; do
//     pkill -f "target/release/desktop"; sleep 2
//     STARTUP_PROBE_OUT=/tmp/probe.jsonl \
//       ./node_modules/.bin/wdio run ./wdio.conf.js --spec ./probes/startup-probe.spec.js
//   done
//
// The `pkill` is mandatory, not hygiene: the app registers
// `tauri_plugin_single_instance`, so launching it while another copy lives
// routes to that copy and the probe reads a stale WebView's timeline instead of
// a fresh boot. `nav` and `timeOrigin` are reported so that mistake is visible
// — a cold launch reads `navigate`, a hijacked one reads `reload` with a
// `timeOrigin` older than the run.
describe("startup probe", function () {
  it("reports the boot timeline", async function () {
    await $("#root > *").waitForExist({ timeout: 20_000 });

    const sample = await browser.execute(() => {
      const at = (name) => {
        const entries = performance.getEntriesByName(name, "mark");
        return entries.length > 0 ? entries[entries.length - 1].startTime : null;
      };
      return {
        // index.html's inline mark: HTML fetched and parsed to <body>.
        documentReady: at("startup:document-ready"),
        // main.tsx's first statement: the entry chunk is parsed and evaluated.
        scriptEval: at("startup:script-eval"),
        // Startup state resolved over IPC; the app can decide what to show.
        resolved: at("startup:resolved"),
        editorReady: at("startup:editor-ready"),
        nav: performance.getEntriesByType("navigation").map((n) => n.type),
        timeOrigin: performance.timeOrigin,
      };
    });

    appendFileSync(
      process.env.STARTUP_PROBE_OUT ?? "/tmp/startup-probe.jsonl",
      `${JSON.stringify(sample)}\n`,
    );
    console.log(`PROBE ${JSON.stringify(sample)}`);
  });
});
