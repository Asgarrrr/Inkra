import { LruCache } from "@/lib/lru";
import { lazyModule } from "@/lib/lazy-module";

const svgCache = new LruCache<string>(50);

// beautiful-mermaid statically imports elkjs, whose minified layout worker is
// ~1.5 MB — on its own the largest thing in the bundle, and useless until a
// document actually contains a mermaid fence. Loading it on demand keeps it off
// the startup path; `MermaidWidget` has a fixed `estimatedHeight`, so a diagram
// arriving a beat late cannot shift the heightmap.
const mermaidModule = lazyModule(() => import("beautiful-mermaid"));

export interface RenderResult {
  svg: string;
  error?: undefined;
  pending?: undefined;
}

export interface RenderError {
  svg?: undefined;
  error: string;
  pending?: undefined;
}

/** The renderer is not in memory yet. Call `ensureMermaid()`, then re-render. */
export interface RenderPending {
  svg?: undefined;
  error?: undefined;
  pending: true;
}

// beautiful-mermaid resolves colours from CSS custom properties at paint time,
// so passing the app's `--bg-base` / `--fg-base` lets a single cached SVG work
// in both light and dark themes. `transparent: true` skips the explicit
// background fill on the SVG root — the canvas frame already shows through.
const RENDER_OPTIONS = {
  bg: "var(--bg-base)",
  fg: "var(--fg-base)",
  transparent: true,
} as const;

// Defense-in-depth: strip <script> blocks and on*= event-handler attributes
// before the SVG reaches innerHTML. beautiful-mermaid escapes label text, but
// documents come from external sources (Obsidian vaults, repos) and the
// third-party renderer is young — a belt-and-suspenders pass on the output
// protects against future regressions in either the library or its inputs.
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "");
}

export function describeRenderError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Loads the renderer if it is not in memory. Rejects if the import fails. */
export function ensureMermaid(): Promise<void> {
  return mermaidModule.load().then(() => undefined);
}

// Stays synchronous, so `toDOM` can paint a cached or already-loadable diagram
// in the frame the wrapper enters the DOM. Only the first call in a session,
// before `ensureMermaid()` resolves, comes back `pending`.
export function renderMermaid(source: string): RenderResult | RenderError | RenderPending {
  const cached = svgCache.get(source);
  if (cached !== undefined) return { svg: cached };

  const mermaid = mermaidModule.peek();
  if (!mermaid) return { pending: true };

  try {
    const svg = sanitizeSvg(mermaid.renderMermaidSVG(source, RENDER_OPTIONS));
    svgCache.set(source, svg);
    return { svg };
  } catch (err) {
    return { error: describeRenderError(err) };
  }
}

export function clearMermaidCache() {
  svgCache.clear();
}
