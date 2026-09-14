import { EditorView } from "@codemirror/view";
import { type Extension, Prec, type Text } from "@codemirror/state";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import * as editorApi from "@/hooks/editor-api";
import { getWorkspaceRoot } from "@/hooks/workspace-api";
import { buildSlugIndex, parseDocumentHeadings } from "@/hooks/use-document-headings";
import type { DocumentHeading } from "@/hooks/use-document-headings";
import { resolveLinkTarget } from "@/lib/paths";
import {
  clearPendingTarget,
  consumePendingTarget,
  type PendingTarget,
  setPendingTarget,
} from "@/lib/pending-target";
import { linkUrlAt, rawUrlAt } from "@/lib/prosemark-core/links";
import * as tauri from "@/lib/tauri";
import { findOuterScroller, jumpToPos } from "./editor-scroll";
import { getEditorView } from "./editor-view-registry";
import { showEditorNotice } from "./editor-notice-store";

function findHeadingBySlug(content: string, slug: string): DocumentHeading | undefined {
  return buildSlugIndex(parseDocumentHeadings(content, { maxDepth: 6, slugDepth: 6 })).get(slug);
}

/** The only place a target kind is decoded. Takes the document rather than its
 *  text: a line target resolves through `doc.line`, and re-deriving line starts
 *  from a string would have to mirror CodeMirror's `DefaultSplit` exactly. */
export function targetDocPos(doc: Text, target: PendingTarget): number | null {
  switch (target.kind) {
    case "heading":
      return findHeadingBySlug(doc.toString(), target.slug)?.pos ?? null;
    case "line":
      return null;
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}

/** Scrolls `view` to `target`, or reports false when it could not: a destroyed
 *  view stays registered until its pane's cleanup runs, and its detached dom
 *  has no scroller. */
function scrollLiveView(view: EditorView, filePath: string, target: PendingTarget): boolean {
  const pos = targetDocPos(view.state.doc, target);
  if (pos === null) {
    if (target.kind === "heading") {
      showEditorNotice(`Heading "#${target.slug}" not found in this document`);
    }
    return true;
  }
  const scroller = findOuterScroller(view.dom);
  if (!scroller) return false;
  jumpToPos(view, scroller, filePath, pos);
  return true;
}

/** Go to `target` inside `path`. The file already on screen scrolls its live
 *  view: `navigateToFile` returns early on an identical path, so its editor
 *  never swaps and would never consume a pending target. */
export async function navigateToTarget(path: string, target: PendingTarget): Promise<void> {
  if (editorApi.getActiveFilePath() === path) {
    const view = getEditorView(path);
    if (view && scrollLiveView(view, path, target)) return;
    // No usable view: the pane is still loading, or its view was destroyed a
    // frame ago. Whichever mounts next consumes the target.
    setPendingTarget(path, target);
    return;
  }

  setPendingTarget(path, target);
  await editorApi.navigateToFile(path);
  // A failed load rolls the tab back, so nothing will consume the target.
  if (editorApi.getActiveFilePath() !== path) clearPendingTarget(path);
}

/** Apply a target left behind for `path` by a caller that ran before this view
 *  registered. `activeFilePath` flips synchronously inside the store's `set`
 *  while registration is a passive effect, and a pane already mounted on that
 *  path neither mounts nor swaps, so nothing else would consume it. */
export function applyRegisteredViewTarget(path: string, view: EditorView): void {
  const target = consumePendingTarget(path);
  if (target !== undefined && !scrollLiveView(view, path, target)) setPendingTarget(path, target);
}

/** Navigate to `href` as written in the document: anchors go through
 *  `navigateToTarget`, plain workspace files open in the tab, external URLs
 *  and other paths hand off to the OS. */
export async function followLink(href: string | null, filePath: string) {
  if (!href) return;

  const target = await resolveLinkTarget(href, filePath, getWorkspaceRoot(), (path) =>
    tauri.fileExists(path),
  );
  if (!target) return;

  if (target.kind === "same-doc-anchor") {
    await navigateToTarget(filePath, { kind: "heading", slug: target.anchor });
    return;
  }

  if (target.kind === "internal") {
    if (target.anchor) {
      await navigateToTarget(target.path, { kind: "heading", slug: target.anchor });
      return;
    }
    await editorApi.navigateToFile(target.path);
    return;
  }

  if (target.kind === "external-url") {
    await openUrl(target.url);
    return;
  }

  await openPath(target.path);
}

/** Link href under a document position, whether rendered or a bare URL. */
export function linkHrefAtPos(view: EditorView, pos: number): string | null {
  return linkUrlAt(view.state, pos) ?? rawUrlAt(view.state, pos) ?? null;
}

/** Resolve the link href under a mouse event, or null if it isn't a link.
 *  Shared by the mousedown (claim the press) and click (navigate) handlers. */
function linkHrefAt(event: MouseEvent, view: EditorView): string | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;

  const htmlAnchor = target.closest(".cm-html-block-widget a");
  if (htmlAnchor instanceof HTMLAnchorElement) {
    return htmlAnchor.getAttribute("href");
  }

  const renderedLink = target.closest(".cm-rendered-link");
  const isRenderedLink = renderedLink !== null;
  const isRawUrl = target.closest(".cm-url") !== null;
  if (!isRenderedLink && !isRawUrl) return null;

  if (renderedLink instanceof HTMLElement && renderedLink.dataset.href) {
    return renderedLink.dataset.href;
  }
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return null;
  return (isRenderedLink ? linkUrlAt(view.state, pos) : rawUrlAt(view.state, pos)) ?? null;
}

export function linkNavigationExtension(
  getFilePath: () => string,
  isDisposed: () => boolean,
): Extension {
  return Prec.highest(
    EditorView.domEventHandlers({
      // Claim the press on mousedown so CodeMirror doesn't move the caret
      // into the link (which would unfold a rendered link), but defer the
      // actual navigation to the click (mouseup) so it follows on release.
      mousedown(event, view) {
        if (linkHrefAt(event, view) === null) return false;
        event.preventDefault();
        event.stopPropagation();
        return true;
      },
      click(event, view) {
        const href = linkHrefAt(event, view);
        if (href === null) return false;
        event.preventDefault();
        event.stopPropagation();
        void followLink(href, getFilePath()).catch((error) => {
          if (!isDisposed()) console.error("[editor] Failed to open link:", error);
        });
        return true;
      },
    }),
  );
}
