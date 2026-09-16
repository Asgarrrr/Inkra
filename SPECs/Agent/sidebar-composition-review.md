# Sidebar composition review

Review of `apps/desktop/src/components` against the Vercel React composition
patterns (compound components, explicit variants, lifted state, children over
render props, React 19 APIs). Five findings, all applied.

## What already held

No `forwardRef` and no `useContext` anywhere — the React 19 section passed
outright, since all shared state goes through Zustand. `SidebarSection`'s
controlled/uncontrolled discriminated union and `setting-control.tsx`'s
schema-driven dispatch were already the shapes the rules ask for, and were
left alone.

Deliberately not flagged: `isActive`, `isExpanded`, `isSelected`, `isDirty`
and friends are state flags, not behaviour-mode switches. The boolean-prop
rule targets the latter.

## Findings

1. **Dead configuration props.** `SidebarNavigator` declared `openFile`,
   `enableContextMenus`, `onOpenFileComplete` and `className`; its one call
   site passed none. `enableContextMenus` was permanently `true` and guarded
   six dead branches across it and `FileTree`. The variant it served is gone —
   compact windows render `CompactRecentsList`.
2. **One row serving two variants.** The flat Pinned/Recents lists rented
   `FileTreeNode` with three booleans hardcoded `false` and `onToggleDir`
   wired to a no-op, and the component forked its behaviour on whether
   `onClick` was passed. Split into `FileTreeRow` (markup, decides nothing),
   `FileTreeNode` (tree) and `FileRow` (flat).
3. **`showFooter` on `EditorArea`.** One boolean, two call sites, two
   variants. The footer moved out into `ActiveTabFooter`, composed by each
   layout.
4. **Prop-drilling through a conduit.** `renamingPath` and
   `everythingCollapsed` travelled four levels; `FileBrowser` forwarded all
   four props and used none. Moved into `sidebar-tree-store`.
5. **`renderFooter` against `Component`.** Two idioms for the same job in the
   page-kind view registry; both are component types now.

## The one real risk, and how it was handled

`sidebar/index.tsx` mounts `<SidebarSurface key={workspaceGeneration} />`.
That key was doing double duty: it clears the surface's own state (selection,
page sizes) _and_ it was what reset `renamingPath` / `everythingCollapsed`,
because those were `useState`. Moving them to a store silently removed the
second half.

The key stays — the first half is still needed. The store subscribes to
`workspaceGeneration` and resets itself, inside the workspace store's `set()`
so the new workspace never paints a frame with the old one's collapse state.
`tests/sidebar-tree-store.test.ts` covers it, and caught the first attempt:
a `typeof window` guard copied from the neighbouring subscriptions meant the
reset never registered under the `node` test environment.

Finding 3 looked riskier than it was. `DocumentFooter` is `absolute
bottom-0`, and in both layouts `EditorArea`'s parent is itself `relative` and
the same size, so hoisting the footer to a sibling resolves it against the
same box. `e2e/specs/sidebar-composition.spec.js` asserts the rendered
geometry rather than trusting that reading.

## Verification

`vp check` (0 errors), `vp test` (737 passing),
`e2e/specs/sidebar-composition.spec.js` (5 passing: folder expand, file open,
cmd-click selection, flat Recents row, footer geometry).

**Not covered by an automated check:** the inline-rename branch of
`FileTreeNode`. Both entry points sit behind native context menus the
WebDriver harness cannot drive, and the project has no React rendering test
setup (`environment: "node"`, no testing-library). That branch was instead
diffed against its pre-refactor text and is character-identical. Tree
drag-move was likewise not driven.
