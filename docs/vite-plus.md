# Using Vite+, the Unified Toolchain for the Web

This project uses Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`.

## Core Rules

- Use `vp` for package management and frontend tooling.
- The underlying package manager is Bun, selected by `packageManager` in the root `package.json`. Do not call `bun install`/`add`/`remove`, pnpm, npm, or Yarn directly; `bun run <script>` is fine.
- Use built-in Vite+ commands such as `vp dev` and `vp build`. Formatting and linting are Biome's, not Vite+'s.
- When a built-in `vp` command name conflicts with a `package.json` script, use `vp run <script>`.
- Import JavaScript tooling APIs from `vite-plus`, not `vite`. Tests import from `vitest`.

## Common Commands

### Start

- `vp install` or `vp i` - Install dependencies
- `vp env` - Manage Node.js versions
- `vp config` - Configure hooks and agent integration
- `vp staged` - Run linters on staged files

### Develop

- `vp dev` - Run the development server
- `vp check`, `vp lint`, `vp fmt` - Do not use. Biome owns formatting and linting; run `biome check`.
- `vp test` - Do not use. It runs the bundled Vitest fork against a config this repo no longer has; the suite runs on real Vitest via `bun run test`.

### Execute

- `vp run <script>` - Run a `package.json` script
- `vp exec <command>` - Execute a command from local `node_modules/.bin`
- `vp dlx <package>` - Execute a package binary without installing it as a dependency
- `vp cache` - Manage the task cache

### Build

- `vp build` - Build for production
- `vp pack` - Build libraries
- `vp preview` - Preview production build

### Manage Dependencies

- `vp add <pkg>` - Add packages to dependencies
- `vp remove <pkg>` - Remove packages from dependencies
- `vp update` - Update packages to latest versions
- `vp dedupe` - Deduplicate dependencies
- `vp outdated` - Check for outdated packages
- `vp list` - List installed packages
- `vp why <pkg>` - Show why a package is installed
- `vp info <pkg>` - View package information from the registry
- `vp link` / `vp unlink` - Manage local package links
- `vp pm <args...>` - Forward a command to the underlying package manager when needed

Shared dependency versions live in the `workspaces.catalog` block of the root `package.json`. Workspace manifests reference them with `"catalog:"`.

Cataloguing a dependency is a manual, two-file edit. `vp add` writes a plain version range, and Bun's `--catalog` flag is accepted but silently does nothing as of 1.4. To catalogue a package: add the range to `workspaces.catalog`, set the workspace manifest to `"catalog:"`, then run `vp install`.

### Maintain

- `vp upgrade` - Update `vp` itself to the latest version
- `vp --version` - Show the current Vite+ version
- `vp help` or `vp <command> --help` - Show command help

## Common Pitfalls

- Do not run package manager commands directly; use `vp` instead.
- Do not run Vite+'s bundled Oxlint or Oxfmt at all; they are no longer this repo's linter or formatter.
- Built-in Vite+ commands do not run same-named `package.json` scripts. Use `vp run <script>` for scripts.
- Do not install Oxlint, Oxfmt, or tsdown directly. Vite+ wraps them. Vitest is the exception: it is a direct dependency, and the suite runs on it rather than on the bundled fork.
- Use `vp dlx` instead of package-manager-specific `npx` or `dlx` commands.
- Import from `vite-plus`, not `vite`. The bundled Vitest is unused.

## CI Integration

For GitHub Actions, consider using [`voidzero-dev/setup-vp`](https://github.com/voidzero-dev/setup-vp) to replace separate `actions/setup-node`, package-manager setup, cache, and install steps with a single action.

```yaml
- uses: voidzero-dev/setup-vp@v1
  with:
    cache: true
- run: biome check
- run: bun run test
```
