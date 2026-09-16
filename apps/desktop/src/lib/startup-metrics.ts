// Lightweight startup performance instrumentation.
// Wraps performance.mark / performance.measure so the boot timeline can be
// inspected. Enabled in development, and in a production build when it is made
// with VITE_STARTUP_METRICS set — measuring a release build is the only way to
// see minified, cold-cache startup, which is what a user actually pays.
// No-ops when `window.performance` is unavailable.

const PREFIX = "startup:";

const ordered: string[] = [];
const seen = new Set<string>();
let timelineLogged = false;

function isEnabled(): boolean {
  if (typeof performance === "undefined" || typeof performance.mark !== "function") {
    return false;
  }
  return import.meta.env.DEV || import.meta.env.VITE_STARTUP_METRICS === "1";
}

export function mark(name: string): void {
  if (!isEnabled()) return;
  const fullName = name.startsWith(PREFIX) ? name : `${PREFIX}${name}`;
  if (seen.has(fullName)) return;
  try {
    performance.mark(fullName);
  } catch {
    return;
  }
  seen.add(fullName);
  ordered.push(fullName);
}

// `performance.mark` timestamps are already relative to `performance.timeOrigin`,
// so reading `startTime` straight gives time since navigation started. Anchoring
// on the first mark instead — as this used to — hides everything that happens
// before it, which is exactly where entry-chunk parse and top-level evaluation
// live.
function rowsSinceTimeOrigin(): Array<{ event: string; sinceOrigin: string; delta: string }> {
  const names = [...ordered];

  // The inline mark in index.html beats this module's own evaluation, so it is
  // never in `ordered`; pull it in explicitly and keep the table in time order.
  const documentReady = `${PREFIX}document-ready`;
  if (!seen.has(documentReady) && performance.getEntriesByName(documentReady, "mark").length > 0) {
    names.unshift(documentReady);
  }

  const rows: Array<{ event: string; sinceOrigin: string; delta: string }> = [];
  let prev: number | null = null;

  for (const fullName of names) {
    const entries = performance.getEntriesByName(fullName, "mark");
    const entry = entries[entries.length - 1];
    if (!entry) continue;
    const delta = prev === null ? entry.startTime : entry.startTime - prev;
    prev = entry.startTime;
    rows.push({
      event: fullName.slice(PREFIX.length),
      sinceOrigin: `${entry.startTime.toFixed(1)}ms`,
      delta: `+${delta.toFixed(1)}ms`,
    });
  }

  for (const paint of performance.getEntriesByType("paint")) {
    rows.push({
      event: paint.name,
      sinceOrigin: `${paint.startTime.toFixed(1)}ms`,
      delta: "",
    });
  }

  rows.sort((a, b) => Number.parseFloat(a.sinceOrigin) - Number.parseFloat(b.sinceOrigin));
  return rows;
}

export function logTimeline(): void {
  if (!isEnabled() || timelineLogged) return;
  if (ordered.length === 0) return;
  timelineLogged = true;

  // Paint entries for the frame this runs in are not queued yet; yielding twice
  // lets first-contentful-paint land before the table is built.
  requestAnimationFrame(() => {
    setTimeout(() => {
      const rows = rowsSinceTimeOrigin();
      if (rows.length === 0) return;
      // eslint-disable-next-line no-console
      console.table(rows);
      // One machine-readable line, so a measurement run can grep it out of the
      // WebView log instead of reading a table by eye.
      // eslint-disable-next-line no-console
      console.log(`startup-metrics ${JSON.stringify(rows)}`);
    }, 0);
  });
}
