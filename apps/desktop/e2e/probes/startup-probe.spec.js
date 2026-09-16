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
// `wdio.conf.js` now refuses to start against a live instance, so the `pkill`
// is belt-and-braces; `E2E_KILL_STALE=1` does it for you. `nav` and `timeOrigin`
// make a hijacked run visible anyway — a cold launch reads `navigate`, a
// hijacked one reads `reload` with a `timeOrigin` older than the run.
//
// What these marks established, so nobody re-derives it:
//
//   nav WebView + HTML          36 ms
//   entry chunk parse+eval      37 ms
//   createRoot + render call     1 ms
//   -> first App render         74 ms   <-- not app code
//   render + commit              2 ms
//   the three hooks' effects     1 ms
//   get_startup_state IPC        3 ms
//   hydrate + restore            1 ms
//
// That 74 ms is a fixed latency on the first asynchronous boundary in the
// WebView's life, not work the app is doing. Measured: a `setTimeout(0)`
// scheduled at the same moment returns in 2 ms, so nothing blocks the main
// thread — but a `MessageChannel` message takes 75 ms to arrive, and React's
// scheduler uses MessageChannel, so the first render lands exactly with it.
// Forcing the render synchronous with `flushSync` does not help: the total is
// unchanged and the 75 ms reappears on the `get_startup_state` IPC instead.
// Emptying the 88 KB stylesheet moves 5 ms, none of it from this segment.
//
// So what is left of startup is in the native/WebView layer, not in JavaScript.
// Trimming more bundle buys very little: the entry chunk's entire parse+eval is
// 37 ms, which is the hard ceiling on anything further removed from it.
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
        rootCreated: at("startup:react-root-created"),
        renderScheduled: at("startup:render-scheduled"),
        appRender: at("startup:app-render"),
        appEffects: at("startup:app-effects"),
        resolveStart: at("startup:resolve-start"),
        ipcStart: at("startup:ipc:get_startup_state:start"),
        ipcEnd: at("startup:ipc:get_startup_state:end"),
        // Startup state resolved; the app can decide what to show.
        resolved: at("startup:resolved"),
        editorReady: at("startup:editor-ready"),
        paint: performance
          .getEntriesByType("paint")
          .map((p) => `${p.name}@${Math.round(p.startTime)}`),
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
