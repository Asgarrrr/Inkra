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

| Role            | Today                             | After              |
| --------------- | --------------------------------- | ------------------ |
| Package manager | Bun, via `vp install`             | Bun, directly      |
| Linter          | Oxlint, via `vp lint`             | Biome              |
| Formatter       | Oxfmt, via `vp fmt`               | Biome              |
| Test runner     | Vitest, via `vite-plus/test`      | Vitest             |
| Bundler         | `@voidzero-dev/vite-plus-core`    | Vite 8             |
| Typecheck       | `tsc`, via `vp lint --type-check` | `tsc`              |
| Commit hooks    | `.vite-hooks` + `vp staged`       | lefthook           |
| Node version    | `vp env`                          | `.node-version`    |
| Task running    | `vp run <pkg>#<script>`           | `bun run --filter` |

## Decisions taken

**Node stays pinned by `.node-version`.** Read by fnm, nvm, mise, and asdf; no
dependency, no wrapper. `engines.node` remains the declarative guard.

**Biome replaces both Oxlint and Oxfmt.** One tool instead of two, and the only
lint-and-format option that is not itself a wrapper. Version 2.5.13, published
2026-09-10.

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

### Slice 1 — Test runner

Replace `vite-plus/test` with `vitest` across 57 test files. Add real `vitest`
to the catalog and drop the `npm:@voidzero-dev/vite-plus-test@latest` alias and
the `@voidzero-dev/vite-plus-test>vite` override. Move the root config's `test`
block into a Vitest workspace config.

Verify: 57 test files, 702 tests, all passing, run through `vitest` directly.

### Slice 2 — Bundler and dev server

Point both apps at real Vite 8. Drop the `vite: "catalog:"` override and the
`npm:@voidzero-dev/vite-plus-core@latest` catalog alias, so `vite` means Vite
everywhere. Align `apps/desktop` on the same Vite major as `apps/website`,
which already runs 8.3.0. Rewrite `tauri.conf.json`'s `beforeDevCommand` and
`beforeBuildCommand`, and the `build`/`preview` scripts in both apps.

Verify: both app builds, `tauri dev` reaching `localhost:1420` with HMR, and
`scripts/distribute.sh` up to its signing gate.

### Slice 3 — Linter and formatter

Add Biome with the configuration above. Port the `ignorePatterns` from the root
config. Fix the correctness findings by hand, auto-fix the style findings,
disable the CSS and a11y groups. Identify the two `parse` diagnostics.

Verify: `biome check` green, and the 702 tests still passing after the
auto-fixes.

### Slice 4 — Hooks, tasks, and removal

Replace `.vite-hooks` and `core.hooksPath` with lefthook running
`biome check --write` on staged files. Replace `vp run <pkg>#<script>` with
`bun run --filter`. Add `.node-version`. Delete the root `vite.config.ts`, the
`vite-plus` dependency, `docs/vite-plus.md`, and the VoidZero editor
recommendation. Rewrite the validation section of `AGENTS.md` and the e2e
skill.

Verify: a clean clone installs and passes lint, typecheck, tests, and both
builds with no `vp` on `PATH`.

## Risks

**`apps/desktop` moves off a Vite fork onto upstream Vite.** Its current build
emits rolldown-specific warnings and an `Invalid key: Expected never but
received "jsx"` input-option warning. Those may resolve or may change shape.
`apps/website` already runs real Vite 8.3.0 with the same
`@vitejs/plugin-react`, which is a good signal but not a guarantee — the
desktop app also loads `@tailwindcss/vite`.

**Two files fail to parse under Biome.** The JSON reporter did not surface
their paths. They must be identified in Slice 3 before Biome is trusted as the
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
