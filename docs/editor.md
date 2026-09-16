# Editor Notes

Patterns and gotchas for the CodeMirror editor in `apps/desktop/src/components/editor-area/`. Each rule earned its place by costing real time. Apply them when extending or reviewing editor code.

## Use the layout model, not the rendered DOM, for positions

Prefer:

- `view.lineBlockAt(pos)` → `BlockInfo` with `top`/`bottom`/`height` in document coordinates.
- `view.documentTop` → screen y of the first line.

Over:

- `view.coordsAtPos(pos)` → can return `null` for positions outside the rendered viewport. CodeMirror only measures lines that are currently virtualized into the DOM; matches further down the document have no `Rect` until they scroll into view.
- `view.contentDOM.getBoundingClientRect()` → affected by virtualization padding and async layout.

Match screen position, valid for any document position:

```ts
const block = view.lineBlockAt(pos);
const matchScreenY = view.documentTop + block.top;
```

`coordsAtPos` returning `null` is a silent failure: a `scrollHandler` that returns `false` falls back to CodeMirror's default scroll, which doesn't know about app-level fades, masks, or other ancestor overlays. If you only test in-viewport cases, the bug ships.

## Choose the right scroll API for who owns the scroll container

CodeMirror's built-in scroll APIs assume the editor owns its scroll container (`view.scrollDOM`, by default `.cm-scroller`):

- `search()` config's `scrollToMatch` — customize the scroll effect for findNext/findPrevious.
- `EditorView.scrollMargins` facet — declare top/bottom/left/right regions of the scroll container that should be treated as off-screen (e.g. for a fixed gutter or fade).

These are correct when `view.scrollDOM` is the actual scrolling element.

In Inkra's editor, `.cm-scroller` has `overflow: visible !important` (see `prosemark-theme.css`) and the surrounding `EditorScrollContainer` is the real scroller. CodeMirror's default scroll walks up to scroll ancestors generically, but `scrollMargins` only applies to `view.scrollDOM`'s computation — so the match can still land under the outer container's fade.

When the scrollable element is an ancestor:

- Use `EditorView.scrollHandler.of(...)` to take over scrolling.
- Find the ancestor scroller by walking `view.dom.parentElement` for the first element with `overflowY: auto | scroll`.
- Scroll it yourself with `scroller.scrollTo({ top, behavior: "auto" })`. `behavior: "smooth"` is async and gets interrupted by rapid keystrokes (e.g. Cmd+G held down).
- Account for `clientTop` if the ancestor has a border (Inkra's container has a 12px transparent border-top to give the mask gradient room).

Reference: `EditorView.scrollHandler.of((view, range) => …)` in `apps/desktop/src/components/editor-area/prosemark-editor/use-prosemark-editor.ts`.

## A programmatic jump parses, persists its landing position, flashes, and corrects its drift

`jumpToPos` in `editor-scroll.ts` does four things in that order, and each one is there because the version without it was wrong. The parse, the flash and the drift correction are below; the landing position comes first because it is the one every scrolling caller shares.

A jump takes a `JumpTarget` — a position plus the ranges to flash — rather than a bare position, because both callers (`scrollLiveView` for the file already on screen, `applyPendingTarget` for the one being opened) must flash, and the decision belongs in one place. `resolveTarget` in `link-navigation.ts` is that place: the only decoder of a target kind, and now the only producer of flash ranges.

### It persists its own landing position

The scroll listener in `use-prosemark-editor.ts` persists every `scroll` event through `updateScrollPos`, so the saved position of a file is whatever the listener last saw. That listener runs before anything scheduled on an animation frame — `scroll` events dispatch during "update the rendering" — and it cannot tell a user scroll from a programmatic one.

So any code that scrolls the ancestor container must go through `jumpScrollTop` / `jumpToPos` in `editor-scroll.ts`, which scroll with `behavior: "auto"`, read `scrollTop` back from the container, and write that value through `updateScrollPos` themselves. This corrects whatever the listener persisted in between — a position clamped against the outgoing document on a swap, or an intermediate frame — and reading back also covers clamping and sub-pixel rounding. `updateScrollPos` bails on an equal value, so the jump's own `scroll` event is then a no-op.

Do not try to suppress the listener instead. A value-matching suppression ("drop the next notification reporting exactly this `scrollTop`") is falsifiable by construction: scroll events are coalesced to at most one per frame reporting the final offset, so anything else moving the scroller in the same frame — including CM's own measure-loop anchoring — makes the awaited value never arrive, and the suppression stays armed across the next document swap.

`behavior: "smooth"` is wrong here for a second reason beyond interruptibility: it produces one `updateScrollPos` write per animation frame for the whole animation.

### It parses the target region before measuring it

`lineBlockAt` reads the heightmap, and heights in a region the committed tree has not reached are estimates (see "Tree-derived StateFields go stale in unparsed regions"). Aiming at an estimate lands next to the line, not on it, because the block moves as its decorations materialise. So `jumpToPos` calls `parseThrough(view, pos)` first — the same entry point the viewport paths use, so the overshoot and the time budget are declared once.

### It flashes the ranges it aimed at, after it lands

`match-flash.ts` owns the flash: a `StateEffect` carrying document ranges, a `StateField<DecorationSet>` of `Decoration.mark({ class: "cm-match-flash" })`, and a `setTimeout` per view that puts it out. Six rules earned their place:

- **It is dispatched after the scroll.** The parse feeds the measurement the scroll makes; a transaction between them is one more thing that can move the heightmap under it. Decoration marks change no heights, so the drift correction still measures what the jump aimed at. That invariant lives in the stylesheet, and `prosemark-theme.css` says so: no rule on `.cm-match-flash` may change a line's metrics.
- **Every jump dispatches, including one with nothing to flash.** `flashMatchRanges` is also the only path that puts a flash out early, so a jump that skipped it would leave the previous flash burning on a line the reader has left. A `Decoration.none` transaction changes no heights either.
- **A swap or a watcher reload clears the field**, keyed on the `inkra.swap` / `inkra.reload` user event that `use-prosemark-editor.ts` already stamps. Today's swap replaces the whole document, so mapping would drop the ranges anyway; the user event is what keeps that true of a swap that reuses part of the text.
- **The expiry timer is per view**, in a `WeakMap`. One module-level timer would let a flash in a second pane cancel the first pane's expiry and leave it lit until its next edit.
- **The offsets come from `resolveTarget`, in UTF-16 units.** The scan counts codepoints (`[RT-2]` in the content-search plan), so the conversion walks the line once with a monotone cursor, sorted and stopped as soon as the last offset resolves — the source line behind a windowed snippet can be megabytes long, and a slice per range is quadratic.
- **`MATCH_FLASH_MS` is the only duration.** The stylesheet reads it as `--match-flash-duration`, pushed onto the span through the decoration's `attributes`. A literal in the CSS drifts: too long leaves an invisible mark, too short cuts the fade off mid-way.

Dispatching into a destroyed view is a no-op: `EditorView.update` stores the state and returns when `destroyed` is set. So an expiry that outlives its pane needs no guard. A timer that survives a swap is likewise harmless — it fires against a field the swap already emptied, and dispatches one transaction nothing reads.

Three things the flash does not paint, all accepted:

- **A range clipped by the snippet window.** A line longer than `MAX_SNIPPET_CHARS` is sent to the palette as a window around its first match, and `content_search.rs` clips the ranges to that window (`range_end.min(end)`). A match straddling the window's edge therefore flashes only the part the palette showed, and a match entirely outside it never flashes at all. The rule is "we flash what we showed you".
- **A range under a `Decoration.replace`.** An image fold, a mermaid or math block, or a folded code block replaces the text with a widget, and a mark inside replaced text renders nothing. The jump still lands on the line; nothing lights up.
- **A range that splits a grapheme cluster.** Offsets are codepoint boundaries, not grapheme boundaries, so a flash can cut a ZWJ sequence or a flag in half. The same limit as `splitHighlightRanges` in the palette, and accepted for the same reason: the scan has no grapheme segmenter.

### It corrects the residual drift, but only on an unfocused view

The parse runs under a time budget, so the heights can still settle after the scroll. `correctDrift` re-measures through `view.requestMeasure` and re-aims, at most twice — each correction moves the viewport, which can parse more and shift the heights again, so this is a bound, not a loop run to convergence. Three guards make it safe, and none of them is optional:

- **Focus.** CodeMirror's own measure-loop anchoring (see the `scrollSnapshot` caveat below) runs on a focused view, captures its anchor before our writes and re-anchors after our requests have drained. Correcting on top of it double-compensates and overshoots the safe zone. So a focused view gets no correction at all — that path is CodeMirror's. The other half of CodeMirror's predicate, a wheel or touch event under 100ms old, has no public accessor and is therefore uncovered.
- **Document identity.** `pos` is an offset into the document the jump measured. A tab swap or a watcher reload replaces that document without necessarily moving `scrollTop` — the browser only re-clamps when the incoming document is shorter — and the reload branch of `use-prosemark-editor.ts` never re-applies a pending target, so nothing downstream would repair a correction aimed at the outgoing document. `view.state.doc` is an immutable `Text`, so reference identity is the exact test; it is checked in the `read` and again in the `write`.
- **A one-pixel dead band.** `scrollTop` is fractional on HiDPI and `scrollTo` rounds to the physical pixel, so exact equality between the wanted offset and the current one is never reached and both passes would always be spent. CodeMirror draws the same band (`diff > 1 || diff < -1`).

`section-rail/index.tsx` still calls `scrollPosToSafeTop` directly, with neither the parse nor the correction.

## Block widgets: pick the decoration shape

Common shapes for widgets that own a block region:

- **Replace-only.** Always `Decoration.replace`. Use when the widget doesn't need to expose source for editing and interaction lives inside the widget itself. Canonical example: `mermaid-decorations.ts` — the fence is always replaced by the canvas, and editing happens in the canvas's nested editor, which writes the whole fence back via `writeFenceText`.
- **Conditional replace ↔ widget.** `Decoration.replace` over `[node.from, node.to]` when the selection doesn't overlap the node; `Decoration.widget(...).range(node.to)` (anchored at the end) when it does, so the source becomes editable next to the rendered widget. Canonical example: `fold/image.ts`. Driven by `selectionTouchesRange`, the third arg passed to `foldableSyntaxFacet`'s `buildDecorations`.
- **Conditional replace ↔ source-line styling.** `Decoration.replace` when the selection is outside the block; line decorations when selection touches the block and the source should stay editable in the main editor. Canonical example: `table-decorations.ts`, which renders a folded table preview with safe inline markdown inside cells, then unfolds a touched table into codeblock-styled markdown source lines rather than a nested editor.

Don't invent a parallel "edit mode" flag that isn't wired through `selectionTouchesRange`. The fold extension already manages that state — duplicating it produces drift between the two sources of truth.

## Enter edit mode by range-selecting the fence, not by placing a caret

`selectionTouchesRange` from `@prosemark/core` is overlap-based with inclusive bounds (`a.from <= b.to && b.from <= a.to`, see `node_modules/@prosemark/core/dist/main.js:30`). A range selection covering the whole fence reliably flips it true regardless of where the head lands.

```ts
view.dispatch({
  selection: EditorSelection.single(fenceTo, fenceFrom), // reverse-anchor convention
  effects: view.scrollSnapshot(),
});
```

Caret-placement at a single point inside the fence is fragile: empty fences, boundary positions, multi-line content, and stale offsets all break it. Mirror what `selectAllDecorationsOnSelectExtension` (`@prosemark/core`) does — it's the canonical pattern.

## Don't store document positions on widget instances

Widget identity is its visual state — `source`, `editMode`, etc. — never positions. Positions are derived state owned by the syntax tree.

- Don't capture `node.from`/`node.to` on the widget at construction. Above-fence edits shift them and the widget lives across rebuilds.
- Don't try to keep them current via an `eq()` side-effect (mutating the kept instance from `other`). It looks like it works in isolation and silently fails across multi-fence diffs and decoration-shape transitions.
- Look up positions live at click time:

```ts
const pos = view.posAtDOM(host);
const tree = syntaxTree(view.state);
let node = tree.resolveInner(pos, side);
while (node.name !== "FencedCode" && node.parent) node = node.parent;
```

`eq()` should compare only the visual identity. Let CM rebuild when that changes; don't mutate kept instances to compensate.

## `posAtDOM` boundaries: try `resolveInner` with both sides

A `Decoration.widget(...).range(node.to)` returns `posAtDOM(host) === node.to`. `resolveInner(node.to, 1)` resolves to the node _starting_ at `node.to` — the next sibling, not the FencedCode that ends there. The walk up never finds the fence.

For widgets anchored at boundary positions, try `side = -1` first (prefers the node ending at the boundary), fall back to `side = 1`:

```ts
for (const side of [-1, 1] as const) {
  let node = tree.resolveInner(pos, side);
  while (node.name !== target && node.parent) node = node.parent;
  if (node.name === target) return node;
}
return null;
```

## Buttons inside widgets: `mousedown.preventDefault()`

A button inside the widget that dispatches a transaction will race the editor's focus state. Default browser behavior on mousedown:

1. Browser focuses the button → editor blurs.
2. Click handler runs → `view.dispatch(...)`.
3. Decoration rebuilds → button DOM destroyed → focus reverts to body.
4. Our `view.contentDOM.focus({preventScroll: true})` runs.

Steps 1–4 race with CM's own focus tracking; the visible result is the caret landing at click coordinates instead of the dispatched selection, or focus landing nowhere useful.

Add to every in-widget button:

```ts
b.addEventListener("mousedown", (e) => {
  e.preventDefault(); // keep the editor focused
  e.stopPropagation(); // keep CM's pointerdown handlers from competing
});
```

Combine with `ignoreEvent: true` on the widget so CM skips its own pointer/click handling for events inside the widget DOM.

**Gotcha: `mousedown.stopPropagation` does not stop `pointerdown`.** They're separate event types — the browser dispatches both for a click, and stopping one doesn't filter the other. If you wire an editor-level handler on `pointerdown` (e.g., a drag-selection gate that listens on `view.contentDOM`), the in-widget button's `mousedown` stop won't suppress it. Filter inside the editor-level handler instead — typically `event.target instanceof Element && event.target.closest('.cm-your-widget')`. See `mermaid-decorations.ts`'s `shouldStartDragGate` for the canonical filter.

## Heightmap-shifting transitions: include `view.scrollSnapshot()`

Any decoration switch that changes block heights (replace ↔ widget, fold/unfold, widget appearing/disappearing) shifts the heightmap. Without compensation the viewport jumps.

```ts
view.dispatch({
  selection: ...,
  effects: view.scrollSnapshot(),
});
```

`scrollSnapshot` captures the viewport-top doc anchor and its screen offset; CM applies the resulting `StateEffect` after the heightmap rebuild and re-scrolls so the same anchor lands at the same screen Y. Don't roll your own `coordsAtPos`-delta scroll math — it depends on layout being flushed and is brittle.

**Caveat: `scrollSnapshot` only affects `view.scrollDOM`, not ancestor scrollers** (per CM's own doc comment; both capture and apply use `scrollDOM.scrollTop`). In Inkra, `.cm-scroller` doesn't scroll — the outer `EditorScrollContainer` does — so the snapshot is close to a no-op here. What actually keeps the viewport stable across height changes is CM's measure-loop scroll anchoring, which does adjust the discovered ancestor scroller — but only while the editor has focus or a wheel/touch event happened in the last 100ms. Corollary: widgets whose DOM changes height after insertion (async image decode, deferred renders) must keep `estimatedHeight` truthful and call `view.requestMeasure()` when their height settles, so the anchoring runs while the user is still interacting. `fold/image.ts` does this with a module-level measured-height cache keyed by image URL, reserving the cached height on the `<img>` until it (re)loads.

Second corollary: that focus/wheel predicate is now encoded as a guard in `correctDrift` (`editor-scroll.ts`). A programmatic jump corrects its own drift only on an unfocused view, because on a focused one CodeMirror's anchoring already compensates and the two additions stack.

## Tree-derived StateFields go stale in unparsed regions

`syntaxTree(state)` returns a frozen snapshot committed at the last `LanguageState` flip — not the live parse context. `ensureSyntaxTree` advances the live context and returns the fresh tree, but `syntaxTree(state)` keeps returning the old one until some later transaction commits a new `LanguageState` (`forceParsing` = `ensureSyntaxTree` + that dispatch). Lezer's background worker fills the tree in `requestIdleCallback` slices, which starve during continuous scrolling and are budget-capped on long documents.

Consequence: any `StateField` that builds decorations by iterating `syntaxTree(state)` (list geometry, hide, fold) renders nothing for regions the committed tree hasn't reached — scrolled-into list items lose their hanging indent, markers show raw, etc. The fields' `syntaxTree(startState) !== syntaxTree(state)` rebuild guards only fire once a parse-commit transaction lands.

`viewportParsePlugin` in `viewport-parse.ts` closes the gap: on `viewportChanged` into a region where `syntaxTreeAvailable` is false, it defers a parse through `viewport.to` (dispatching inside an update cycle is illegal, hence the `setTimeout`). Mount and tab-swap paths call `advanceViewportParse` for the same reason. Every one of them goes through `parseThrough(view, pos)`, which owns the overshoot and the time budget; don't re-derive `min(doc.length, pos + overshoot)` at a call site.

Don't add per-field force-parses. The third caller of `parseThrough` is not one: `jumpToPos` parses because it is about to _measure_ heights in a region the viewport has never covered, not because a decoration field of its own renders stale. A jump path is the one legitimate reason to ask for a parse outside `viewport-parse.ts`.

The parse-commit transaction that `forceParsing` dispatches changes neither the doc nor the viewport. So every tree-derived decoration source, StateField **and** ViewPlugin, must rebuild on the tree itself changing. Use `treeChanged(update)` from `prosemark-core/utils.ts`:

```ts
update(update: ViewUpdate) {
  if (update.docChanged || update.viewportChanged || treeChanged(update)) rebuild();
}
```

The StateFields (`hideExtension`, `foldExtension`, `listDecorationsField`) and the ViewPlugins (`headingPlugin`, `codeBlockDecorationsExtension`, `blockQuoteExtension`) all carry it. Without it a region jumped into (Cmd+G, section rail, anchor) keeps stale decorations until the next scroll. Don't add a "tree sync" plugin that re-dispatches a selection to nudge a rebuild; that was the old workaround and it tripled the rebuild cost per parse commit.

## Synchronous render in `toDOM` beats IntersectionObserver-deferred

If your renderer is sync and cache-backed (or cheap to call), paint in `toDOM`. The async-deferred path adds a "Loading…" gap users see, can re-fire after a toggle (producing a visible flash), and has no real benefit when the cache makes repeat renders O(map lookup). CM only calls `toDOM` for widgets in its viewport buffer anyway.

Reference: `mermaid-decorations.ts` mounts the canvas synchronously in `toDOM`; the SVG cache is bounded LRU and the output is sanitised before reaching `innerHTML`.

## Test the dispatch path, not just the helpers

Pure-helper tests (`computeToggleSelection`-style) catch math bugs but not focus races, `posAtDOM` boundary errors, or cross-widget interference. The actual contract is "click does the right thing in CM," which only an integration test can verify.

When a widget has a click → dispatch → mode-change cycle, mount a real `EditorView` with two instances and simulate clicks. Assert against `view.state.selection.main` and `view.state.field(foldExtension)`, not against helper outputs.

## File map

- `mermaid-decorations.ts` — canonical replace-only block widget with in-widget editing. Reference for live position lookup (`findEnclosingFencedCode`) and writing the fence back from a nested editor.
- `fold/image.ts` — canonical conditional replace ↔ widget, plus the measured-height cache for async-loading content.
- `table-decorations.ts` — canonical conditional replace ↔ source-line styling; uses `selectAllDecorationsOnSelectExtension` for click-to-select.
- `prosemark-core/links.ts` — `linkUrlAt` / `rawUrlAt`, the one place that resolves a link destination from a document position.
- `prosemark-core/imageSrc.ts` — `imageSrcResolverFacet` / `resolveImageSrc`; widgets resolve `<img src>` in `toDOM` (Inkra provides the facet from `image-src-resolver.ts`), so no DOM observer rewrites images after insertion.
- `editor-scroll.ts` — `findOuterScroller` / `scrollPosToSafeTop`, the one place that scrolls the ancestor container to a document position, plus `jumpScrollTop` / `jumpToPos`, the one place a programmatic jump persists where it landed. `jumpToPos` also forces the parse of the target region before measuring it, flashes the target's ranges, and corrects the residual drift afterwards (`correctDrift`, unfocused views only).
- `match-flash.ts` — `flashMatchRanges` and the field it drives, the one place the editor highlights something transiently. The class it applies, `.cm-match-flash`, is styled in `prosemark-theme.css` (and held flat under `prefers-reduced-motion`).
- `viewport-parse.ts` — `parseThrough`, the one place a parse target is derived from a document position (overshoot + time budget), plus `advanceViewportParse` (mount and swap) and `viewportParsePlugin` (scroll).
- `editor-view-registry.ts` — the live `EditorView` of each active pane, keyed by path. The one way non-CodeMirror code (link navigation, the palette) reaches a document that is already on screen. Written by `use-register-editor-view.ts` from `editor-pane.tsx`.
- `pending-target.ts` (in `src/lib/`) — carries a jump target across the gap between `openFile` and the new document's first render. `link-navigation.ts` is the only writer; `use-prosemark-editor.ts`'s `applyPendingTarget` and `use-register-editor-view.ts` are the only consumers.
- `editor-extensions.ts` — `createEditorExtensions`, the one place the extension list is assembled. Pieces: `editor-search-extensions.ts` (hidden search panel, `EditorView.scrollHandler` for the ancestor-scroller case, Mod-f / Mod-g / Escape), `link-navigation.ts` (click-to-follow, `followLink`), `editor-clipboard.ts` (image + frontmatter paste), `editor-body-menu.ts` (right-click menu), `viewport-parse.ts`. `use-prosemark-editor.ts` mounts, swaps, and disposes the view, and owns the initial scroll of a document: restoring the saved position or consuming a pending target.
- `node_modules/@prosemark/core/dist/main.js:30` — `selectionTouchesRange` semantics.
