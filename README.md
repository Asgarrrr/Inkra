# Inkra

Fast and lightweight app for your workspace's markdown files

![Inkra](./assets/screenshot.png)

It is built with Tauri v2, React, Zustand, CodeMirror, and Rust. The app keeps documents on disk, respects workspace `.gitignore` rules, supports multiple windows, renders extended markdown such as tables and Mermaid diagrams, and ships with a signed macOS release flow.

## Repository

- `apps/desktop/` — Tauri desktop app.
- `apps/desktop/src/` — React frontend.
- `apps/desktop/src-tauri/src/` — Rust commands, workspace state, watcher, updater, and CLI integration.
- `apps/website/` — landing page.
- `docs/` — project and agent workflow docs.
- `SPECs/` — feature specs and design notes.

## Development

This repo uses Vite+ through the `vp` CLI. Use `vp` instead of calling the package manager or Vite tooling directly.

```bash
vp install
vp dev
```

## Validation

```bash
vp check
bun run test
```

Rust validation runs from the Tauri crate:

```bash
cd apps/desktop/src-tauri
cargo test
cargo clippy
cargo fmt --check
```

## Privacy

Inkra is local-first and stays that way. It ships opt-in usage telemetry that
is **off until you turn it on**, never sees your documents, file names, or
paths, and is not even compiled into builds made from a clone of this repo.
[`docs/telemetry.md`](./docs/telemetry.md) lists every event and property, and
the three independent ways to keep it off.

## Releases

macOS releases are cut locally with `scripts/distribute.sh`. See `docs/releasing.md` for the signed, notarized release workflow and updater publishing details.

## License and attribution

Inkra is licensed under the GNU General Public License v3.0. See
[`LICENSE`](./LICENSE).

Inkra is a fork of [Writer](https://github.com/joelbqz/writer-computer), created
by Joel and released under GPL-3.0. Writer is the original work, and the commits
it contributed are preserved intact in this repository's history. Inkra is
developed independently by Jérémy Caruelle and is not affiliated with, endorsed
by, or supported by the Writer project — report issues found here rather than
upstream.
