# Remove Vite+ from the toolchain

## Why

Vite+ sits in the critical path of every build, test, lint, and commit in this
repo. It is version 0.1.24 while 0.3.2 is already published, so it is pre-1.0
and moving fast. The maintainer does not know it well. An unfamiliar wrapper
that fronts six tools is a maintenance risk out of proportion to what it
delivers here.

Three measurements taken during the pnpm-to-Bun migration back this up.

The bundled linter and formatter cannot be used without it:

```
$ ./node_modules/.bin/oxlint --version
This oxlint wrapper is for IDE extension use only (--lsp mode).
To lint your code, run: vp lint
```

The task cache — the main reason to keep a monorepo task layer — is never
configured:

```
Statistics: 2 tasks • 0 cache hits • 0 cache misses • 2 cache disabled
  [1] desktop#build → Cache disabled in task configuration
```

And Vite+ is the sole reason the root `package.json` carries a knot of `vite`
overrides. `apps/desktop` builds against `@voidzero-dev/vite-plus-core`, a Vite
fork, while `apps/website` needs real Vite 8. Two overrides exist only to keep
those two apart.

## Current surface

Snapshot taken when this spec was written, before any slice landed. The rows
for the test files, `tauri.conf.json`, the app manifests, and the `vite`
overrides are all settled by slice 1; the rest is still accurate.

58 files reference `vite-plus`: 57 test files importing `vite-plus/test`, plus
the root `vite.config.ts`. The rest is configuration:

| Location                                 | Coupling                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `vite.config.ts` (root)                  | `defineConfig` from `vite-plus`; holds `staged`, `fmt`, `lint`, `test` blocks              |
| `apps/desktop/src-tauri/tauri.conf.json` | `beforeDevCommand: "vp dev"`, `beforeBuildCommand: "vp build"`                             |
| `package.json` (root)                    | `ready`, `dev`, `prepare` scripts; `vite`/`vitest` catalog aliases; three `vite` overrides |
| `apps/desktop/package.json`              | `vp exec tsc && vp build`, `vp preview`                                                    |
| `apps/website/package.json`              | `vp exec vite dev\|build\|preview`                                                         |
| `apps/desktop/e2e/package.json`          | `vp run build:app && vp run test:wdio`                                                     |
| `.vite-hooks/`                           | `core.hooksPath` points here; `pre-commit` runs `vp staged`                                |
| `scripts/distribute.sh`                  | `vp exec tauri build --bundles app,dmg`                                                    |
| `.vscode/extensions.json`                | recommends `VoidZero.vite-plus-extension-pack`                                             |
| `docs/vite-plus.md`, `AGENTS.md`         | validation commands and core rules                                                         |

Not coupled, and deliberately left alone: `doctor.config.ts`. React Doctor is
not installed, not declared in any manifest, and not invoked by `vp check`,
despite 29 inline `eslint-disable react-doctor/*` comments in the source. It
runs ad hoc and is independent of this change.

## Target state

Vitest becomes a direct dependency instead of arriving bundled inside
`vite-plus` as a fork nobody chose.

| Role            | Before                            | After              | Status  |
| --------------- | --------------------------------- | ------------------ | ------- |
| Package manager | pnpm                              | Bun                | done    |
| Bundler         | `@voidzero-dev/vite-plus-core`    | Vite 8             | done    |
| Test runner     | Vitest fork, via `vite-plus/test` | Vitest 5           | done    |
| Linter          | Oxlint, via `vp lint`             | Biome              | slice 2 |
| Formatter       | Oxfmt, via `vp fmt`               | Biome              | slice 2 |
| Typecheck       | `tsc`, via `vp lint --type-check` | `tsc`              | —       |
| Commit hooks    | `.vite-hooks` + `vp staged`       | lefthook           | slice 3 |
| Node version    | `vp env`                          | `.node-version`    | slice 3 |
| Task running    | `vp run <pkg>#<script>`           | `bun run --filter` | slice 3 |

## Decisions taken

**Node stays pinned by `.node-version`.** Read by fnm, nvm, mise, and asdf; no
dependency, no wrapper. `engines.node` remains the declarative guard.

**Biome replaces both Oxlint and Oxfmt.** One tool instead of two, and the only
lint-and-format option that is not itself a wrapper. Version 2.5.13, published
2026-09-10.

**The test suite runs on Vitest 5, and the bundler slice lands before it.**
This was decided the expensive way. The first attempt sent the suite to
`bun test`, reasoning that Vitest 5 peers on `vite ^6.4 || ^7 || ^8`, which the
global `vite` override — pointing at `@voidzero-dev/vite-plus-core@0.3.2` —
could not satisfy, so real Vitest would have forced the bundler slice to land
first.

That was a slicing artefact treated as a fact. Landing the bundler slice first
dissolves the constraint instead of working around it, and then Vitest 5 is a
drop-in.

The cost of getting this backwards, measured on the reverted work: 143 lines of
shim infrastructure against roughly 7 lines of config removed, a `@types/bun`
dependency, explicit `types` arrays in two tsconfigs, 51 spurious lint
warnings, and a `--isolate` flag with nowhere to live but a script, without
which the suite was 661 pass / 41 fail. `bun:test` isolates per process rather
than per file and lacks `vi.mocked`, `vi.stubGlobal`, `vi.unstubAllGlobals`,
`vi.waitFor` and the two async timer variants — every one of which Vitest has.
And the dependency the swap was meant to remove stayed installed regardless,
because `vite-plus` depends on it.

The rule worth keeping: order the slices so the constraint disappears, rather
than shimming around it.

**Formatter configuration is `indentStyle: space`, `indentWidth: 2`,
`lineWidth: 100`.** Measured against the current Oxfmt output:

| Biome config         | Divergent files / 197 |
| -------------------- | --------------------- |
| defaults (tab)       | 196                   |
| `indentStyle: space` | 146                   |
| `+ lineWidth: 90`    | 105                   |
| `+ lineWidth: 100`   | **4**                 |
| `+ lineWidth: 120`   | 101                   |

The four are `App.css`, `prosemark-theme.css`, `editor-search-store.ts`, and
`routeTree.gen.ts` — the last already in the current `ignorePatterns`. There is
no repo-wide reformat, so `git blame` stays readable.

**Lint debt is split three ways.** Biome's recommended set reports 31 errors,
70 warnings, and 6 infos. That is not 107 regressions:

```
16 style/useImportType             ─┐
16 style/noNonNullAssertion         │ style — auto-fixable
 9 complexity/useOptionalChain      │
 4 style/useTemplate               ─┘
13 complexity/noImportantStyles    ─┐
 7 style/noDescendingSpecificity    │ CSS + a11y — coverage Oxlint
 7 a11y/noSvgWithoutTitle           │ does not provide here
 5 a11y/noStaticElementInteractions─┘
 8 suspicious/noDoubleEquals       ─┐
 4 suspicious/noPrototypeBuiltins   │ real correctness
 3 suspicious/useIsArray            │
 3 suspicious/noImplicitAnyLet      │
 3 suspicious/noAssignInExpressions─┘
 2 parse                             ← unidentified, see Risks
```

Correctness findings are fixed by hand. Style findings go through
`biome check --write`. CSS and a11y rules are disabled with a follow-up task,
because enabling new coverage is a separate change from removing a wrapper.

## Slices

Each slice is independently verifiable and leaves the repo green.

### Slice 1 — Bundler, dev server, and test runner — DONE (`2a49897`)

Landed as one change, because the test runner follows the bundler rather than
standing on its own.

Both apps point at real Vite 8.3.0: the `vite: "catalog:"` override and the
`npm:@voidzero-dev/vite-plus-core@latest` catalog alias are gone, so `vite`
means Vite, and the store holds exactly one materialised copy. `vp` left the
build path — `tsc && vite build`, `vite preview`, and `dev:vite` / `build:vite`
for `tauri.conf.json`, which needs frontend-only scripts that do not recurse
into `tauri dev`.

The 57 test files import from `vitest`. The root `test` block moved to a new
`vitest.config.ts`; `apps/desktop/vite.config.ts` keeps its own and takes
`defineConfig` from `vitest/config`, since Vite's rejects a `test` key. The
`include` is what keeps the seven WebDriver `.spec.js` files out of the run.

`@vitejs/plugin-react` went to 6 in a follow-up (`5f38da2`). Version 4 peered
on `vite ^4 || ^5 || ^6 || ^7`, so Vite 8 left it unsatisfied; it also passed a
`jsx` input option that rolldown-based Vite rejects, and set esbuild options
alongside oxc ones so its `jsxImportSource` — how `why-did-you-render` hooks
the JSX factory — landed in the ignored half. Both warnings are gone.

Verified: 702 tests across 57 files with no flag, `vp check` at 0 errors and 1
warning, both app builds, and `localhost:1420` serving 200 with the HMR client
from the 8.3.0 path.

### Slice 2 — Linter and formatter

Add Biome with the configuration above. Port the `ignorePatterns` from the root
config. Fix the correctness findings by hand, auto-fix the style findings,
disable the CSS and a11y groups. Identify the two `parse` diagnostics.

Verify: `biome check` green, and the 702 tests still passing after the
auto-fixes.

### Slice 3 — Hooks, tasks, and removal

Replace `.vite-hooks` and `core.hooksPath` with lefthook running
`biome check --write` on staged files. Replace `vp run <pkg>#<script>` with
`bun run --filter`. Add `.node-version`. Delete the root `vite.config.ts`, the
`vite-plus` dependency, `docs/vite-plus.md`, and the VoidZero editor
recommendation. Rewrite the validation section of `AGENTS.md` and the e2e
skill.

Verify: a clean clone installs and passes lint, typecheck, tests, and both
builds with no `vp` on `PATH`.

## Risks

**~~`apps/desktop` moves off a Vite fork onto upstream Vite.~~ Retired — it
landed clean.** The bundle came out marginally smaller (4,951 kB to 4,911 kB),
with the same 158 chunks under the same names and no chunk appearing or
vanishing. The `Invalid key: Expected never but received "jsx"` warning turned
out not to be a fork artefact at all: it survived the move and was fixed by
`@vitejs/plugin-react` 6, alongside a second warning that had been silently
discarding the plugin's `jsxImportSource`.

**Two files fail to parse under Biome.** The JSON reporter did not surface
their paths. They must be identified in slice 2 before Biome is trusted as the
only linter.

**Type-aware lint coverage narrows.** The current config runs `typeAware: true`,
and today's single warning — `no-redundant-type-constituents` — is a type-aware
rule with no Biome equivalent. Biome infers types with its own engine rather
than `tsc`, so coverage is partial. `tsc` still runs, so typechecking itself is
unaffected; only type-informed _lint_ rules narrow.

## Out of scope

- Enabling Biome's CSS and a11y rules. Tracked as a follow-up.
- `react-doctor`, which is not wired into any command.
- The dead `packages/*` and `tools/*` workspace globs.
- The root `ready` script's `vp run build -r`, which fails to resolve a `build`
  task today and predates this work.
