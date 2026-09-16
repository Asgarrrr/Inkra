import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNodeRef } from "@lezer/common";
import { foldableSyntaxFacet } from "@/lib/prosemark-core/main";
import { describeRenderError, ensureMermaid, renderMermaid } from "./mermaid-renderer";
import { MERMAID_CANVAS_HEIGHT, MermaidCanvasHandle, mountMermaidCanvas } from "./mermaid-canvas";
import { openMermaidFullscreen } from "./mermaid-fullscreen";
import "./mermaid-canvas.css";

// Outer widget padding (top + bottom). `mermaid-canvas.css` splits this
// evenly across top/bottom so `estimatedHeight` matches the rendered box.
const WIDGET_VERTICAL_PADDING = 16;

// Map keyed by wrapper DOM element so `updateDOM` and `destroy` can find the
// live canvas handle without round-tripping through CodeMirror state. Weak so
// disposed wrappers don't leak.
//
// `fenceText` is the freshness token for deferred renders. The entry object is
// reused across `updateDOM`, so a callback compares both its identity (did the
// wrapper get destroyed and replaced?) and the fence text it captured (did the
// fence change while the renderer was loading?).
type WidgetEntry = { handle: MermaidCanvasHandle; fenceText: string };
const widgetHandles = new WeakMap<HTMLElement, WidgetEntry>();

/**
 * Whether a deferred render may still write to the canvas.
 *
 * This check is not optional. `updateSource` cancels the canvas's in-flight
 * 150ms source-change debounce, so writing a superseded `fenceText` would
 * discard keystrokes the user has already typed into the nested editor and
 * destroy their caret. Two ways to go stale: the wrapper was destroyed and its
 * entry dropped, or `updateDOM` moved the entry on to a different fence.
 */
export function isDeferredRenderStale(
  live: WidgetEntry | undefined,
  entry: WidgetEntry,
  capturedFenceText: string,
): boolean {
  return live !== entry || entry.fenceText !== capturedFenceText;
}

/**
 * Paint a diagram that could not render synchronously because the renderer was
 * not in memory yet.
 */
function renderWhenLoaded(
  wrapper: HTMLElement,
  entry: WidgetEntry,
  body: string,
  fenceText: string,
): void {
  const isStale = () => isDeferredRenderStale(widgetHandles.get(wrapper), entry, fenceText);

  ensureMermaid().then(
    () => {
      if (isStale()) return;
      const result = renderMermaid(body);
      // `pending` is unreachable once the module is loaded; treating it as a
      // no-op keeps the canvas on its last good frame if that ever changes.
      if (result.pending) return;
      entry.handle.updateSource(result.svg ?? "", fenceText, result.error);
    },
    (err) => {
      if (isStale()) return;
      entry.handle.updateSource("", fenceText, describeRenderError(err));
    },
  );
}

/**
 * Mermaid widget. Identity is the fence text: it determines both the body
 * (which drives the SVG cache) and the inline editor's content. The Edit-code
 * toggle lives entirely inside the canvas frame, so it never participates in
 * widget identity and a toggle never triggers a CodeMirror rebuild.
 */
class MermaidWidget extends WidgetType {
  constructor(
    readonly body: string,
    readonly fenceText: string,
  ) {
    super();
  }

  eq(other: MermaidWidget): boolean {
    return this.fenceText === other.fenceText;
  }

  // Fixed height regardless of diagram size, so the heightmap settles on a
  // stable value immediately.
  get estimatedHeight(): number {
    return MERMAID_CANVAS_HEIGHT + WIDGET_VERTICAL_PADDING;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-mermaid-widget";
    wrapper.contentEditable = "false";

    const host = document.createElement("div");
    host.className = "cm-mermaid-canvas";
    host.tabIndex = 0;
    wrapper.append(host);

    const ariaLabel = `Mermaid diagram: ${this.body.split("\n")[0]}`;
    // The overlay renders its own copy of the diagram, so it can only fail if
    // the renderer is somehow still not loaded — report rather than leaving an
    // unhandled rejection behind a button that appears to do nothing.
    const onExpand = () => {
      openMermaidFullscreen(this.body, ariaLabel).catch((error: unknown) => {
        console.error("[editor] Failed to open the diagram fullscreen:", error);
      });
    };
    const onSourceChange = (next: string) => writeFenceText(view, host, next);

    // Synchronous whenever it can be: the renderer is sync once loaded and the
    // SVG cache makes repeat calls O(map lookup), so the wrapper paints with
    // its final SVG in the frame it enters the DOM. Only the first diagram of a
    // session mounts empty and fills in when the renderer arrives — the frame
    // is fixed-height either way, so nothing below it moves.
    const result = renderMermaid(this.body);
    const handle = mountMermaidCanvas(host, {
      svgHtml: result.svg ?? "",
      ariaLabel,
      source: this.fenceText,
      onSourceChange,
      onExpand,
    });
    const entry: WidgetEntry = { handle, fenceText: this.fenceText };
    widgetHandles.set(wrapper, entry);

    if (result.error) handle.updateSource("", this.fenceText, result.error);
    else if (result.pending) renderWhenLoaded(wrapper, entry, this.body, this.fenceText);

    return wrapper;
  }

  // Called when the new widget isn't `eq` to the old one but CM is willing to
  // reuse the existing DOM. Returning `true` keeps the DOM (and the nested
  // editor's focus, selection, scroll, history) intact across source changes.
  updateDOM(dom: HTMLElement, _view: EditorView): boolean {
    const entry = widgetHandles.get(dom);
    if (!entry) return false;
    // Record the new fence before anything can await, so a deferred render
    // still holding the old one recognises itself as stale.
    entry.fenceText = this.fenceText;

    const result = renderMermaid(this.body);
    if (result.pending) {
      // Leave the canvas on its current frame rather than blanking it, and
      // leave the nested editor alone — `updateSource` would cancel its
      // pending debounce, which is exactly the keystroke loss to avoid.
      renderWhenLoaded(dom, entry, this.body, this.fenceText);
      return true;
    }
    entry.handle.updateSource(result.svg ?? "", this.fenceText, result.error);
    return true;
  }

  destroy(dom: HTMLElement): void {
    const entry = widgetHandles.get(dom);
    entry?.handle.destroy();
    widgetHandles.delete(dom);
  }

  ignoreEvent(): boolean {
    // The canvas owns all pointer/keyboard interaction inside the widget.
    // Without this CodeMirror would also process clicks and try to place the
    // caret at the replaced range, hijacking the toggle and zoom buttons.
    return true;
  }
}

/**
 * Find the FencedCode node enclosing the position of `host` in the document.
 *
 * `posAtDOM` for a Decoration.replace widget that covers `[node.from, node.to]`
 * resolves at the boundary; we try side=-1 first and fall back to side=1.
 */
function findEnclosingFencedCode(view: EditorView, host: HTMLElement) {
  const pos = view.posAtDOM(host);
  const tree = syntaxTree(view.state);
  for (const side of [-1, 1] as const) {
    let node = tree.resolveInner(pos, side);
    while (node.name !== "FencedCode" && node.parent) node = node.parent;
    if (node.name === "FencedCode") return node;
  }
  return null;
}

/**
 * Dispatch a transaction on the outer view replacing the *entire fence*
 * (opening marker, info string, body, closing marker) with `next`. Position
 * is resolved live from the syntax tree at call time, so it stays correct
 * even as text above the fence shifts.
 *
 * If the user breaks the fence syntax mid-edit (e.g. they delete the closing
 * ```), the parser stops recognizing it as a FencedCode on the next rebuild
 * and the widget collapses to raw markdown — that's the natural consequence
 * of editing the full fence, and the user can recover by completing the
 * fence again.
 */
function writeFenceText(view: EditorView, host: HTMLElement, next: string): void {
  const fence = findEnclosingFencedCode(view, host);
  if (!fence) return;
  if (view.state.doc.sliceString(fence.from, fence.to) === next) return;
  view.dispatch({
    changes: { from: fence.from, to: fence.to, insert: next },
    // No `selection` field: leave the outer selection where it was. The
    // widget owns its own focus (inside the nested editor) and we don't
    // want to scroll the outer viewport.
  });
}

/**
 * Extract info string and code content for a FencedCode node. Lezer's tree:
 *   FencedCode → CodeMark, CodeInfo, CodeText, CodeMark
 * Multiple CodeText children can occur (e.g. blockquoted fences); we
 * concatenate their slices.
 */
function parseFencedCode(
  state: { doc: { sliceString(from: number, to: number): string } },
  node: SyntaxNodeRef,
): { info: string; source: string } | undefined {
  let info = "";
  let source = "";

  let child = node.node.firstChild;
  while (child) {
    if (child.name === "CodeInfo") {
      info = state.doc.sliceString(child.from, child.to);
    } else if (child.name === "CodeText") {
      source += state.doc.sliceString(child.from, child.to);
    }
    child = child.nextSibling;
  }

  if (!info) return undefined;
  return { info, source };
}

const mermaidFoldExtension = foldableSyntaxFacet.of({
  nodePath: "FencedCode",
  keepDecorationOnUnfold: true,
  buildDecorations: (state, node) => {
    const parsed = parseFencedCode(state, node);
    if (!parsed) return undefined;

    if (!parsed.info.trim().toLowerCase().startsWith("mermaid")) return undefined;

    const body = parsed.source.trim();
    if (!body) return undefined;

    const fenceText = state.doc.sliceString(node.from, node.to);
    const widget = new MermaidWidget(body, fenceText);
    // Always replace the entire fence with the rendered canvas. Editing
    // happens inside the canvas (a nested editor panel), not by exposing
    // the underlying markdown via selection — so there's no preview/edit
    // decoration switch.
    return Decoration.replace({ widget, block: true, inclusiveStart: true }).range(
      node.from,
      node.to,
    );
  },
});

export function mermaidDecorations() {
  return [mermaidFoldExtension];
}
