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
| `node scripts/roundtrip.js` | Prove a file survives being read and written back |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Name validation and the save stamp |
| `scripts/bump.sh 0.2.0` | Set the version everywhere it appears |
| `scripts/bump.sh --check` | Fail if those versions have drifted apart |

## Where things live

| Path | What belongs there |
| --- | --- |
| `src-tauri/src/main.rs` | Every filesystem operation, plus the tray and the global shortcut, which have nowhere else to live. Seven commands, `safe_name()`, `create_name()`, `fingerprint()`, and their tests |
| `src-tauri/capabilities/default.json` | Plugin permissions for the `main` window |
| `src-tauri/tauri.conf.json` | Window size, bundle targets, version |
| `src/app.js` | Storage shim, markdown parse/serialize, state, one `draw()` |
| `src/app.css` | Colour tokens at the top; no raw hex below them |
| `src/index.html` | The static shell. No logic |
| `src-tauri/capabilities/default.json` | A missing permission here fails at runtime, not at build |
| `scripts/` | `bump.sh`, `verify.sh`, `roundtrip.js` |
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
trade-off to be weighed against convenience. Frontmatter, the text above the
first heading, CRLF endings and the exact spelling of a heading are all part of
their file. `scripts/roundtrip.js` is where that is proved: if you touch the
parser, add the case that made you touch it. A change that does not is not
finished.
