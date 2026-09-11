# PromptDeck

A Linux desktop app for keeping prompts as plain markdown and getting them into
a terminal fast. Every `##` heading in a file under `~/PromptDeck` is a block
with its own copy button, and copying puts the body on the clipboard, never the
heading. The markdown files are the only storage: no database, no config format
of our own, nothing the user cannot read and edit in vim.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the app against `src/`, rebuilding Rust on change |
| `npm run build` | Release build, producing a `.deb` and an `.AppImage` |
| `scripts/verify.sh` | Everything CI runs, in CI's order, ending with the bundles |
| `scripts/bump.sh 0.2.0` | Set the version everywhere it appears |
| `scripts/bump.sh --check` | Fail if those versions have drifted apart |

## Where things live

| Path | What belongs there |
| --- | --- |
| `src-tauri/src/main.rs` | Every filesystem operation, and nothing else. Six commands, one `safe_path()` |
| `src-tauri/capabilities/default.json` | Plugin permissions for the `main` window |
| `src-tauri/tauri.conf.json` | Window size, bundle targets, version |
| `src/app.js` | Storage shim, markdown parse/serialize, state, one `draw()` |
| `src/app.css` | Colour tokens at the top; no raw hex below them |
| `src/index.html` | The static shell. No logic |
| `scripts/` | `bump.sh`, `verify.sh` |
| `.github/workflows/` | `ci.yml` on push and PR, `release.yml` on `v*` tags |

## Expectations

Read the matching skill in `.claude/skills/` before changing code:
`promptdeck-feature` for behaviour, `promptdeck-ui` for anything visible or
worded, `promptdeck-release` for cutting a version.

Run `scripts/verify.sh` before saying something works. Not `cargo build`, not a
glance at the diff — the script, to the end, exit zero.

Do not add a dependency without a reason you would defend out loud. There is no
framework, no bundler and no npm runtime dependency, and that is the point.

Any change that could lose a line of someone's markdown is a bug, not a
trade-off to be weighed against convenience. Frontmatter and the text above the
first heading are part of their file. If you cannot show the round trip is
intact, the change is not finished.
