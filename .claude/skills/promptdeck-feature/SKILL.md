---
name: promptdeck-feature
description: Use when adding or changing behaviour in PromptDeck — a new Tauri command, a new interaction in the reading pane, a change to how blocks are parsed, edited, selected or written back to the markdown file, or anything that reads or writes the vault.
---

# Changing behaviour in PromptDeck

## Two layers, no third

`src-tauri/src/main.rs` does every filesystem operation, and the two things
that can only happen in the Tauri builder: the tray icon and the global
shortcut. Its commands stay under about 250 lines, with its tests below them in
the same file. `src/app.js` does everything else: the store shim,
markdown parsing, state, rendering, keyboard. There is no service layer, no
module system, no build step. If a change seems to need a third place to live,
it is probably two changes.

## Adding a command

Four steps, all four or none:

1. Write the command in `main.rs`. Take plain strings, return
   `Result<T, String>`. If it takes a file name, put it through `safe_path()` —
   never join caller input onto the vault path.
2. Register it in `invoke_handler![...]`.
3. Add it to **both** halves of `store` in `app.js`: the real one calling
   `window.__TAURI__.core.invoke`, and the in-memory one. The in-memory half is
   what lets `src/index.html` open in a browser; letting it rot costs you the
   preview.
4. If it needs a Tauri plugin, add the permission to
   `src-tauri/capabilities/default.json` alongside `core:default`. A missing
   permission fails at runtime, not at build time.

Error strings reach the user's screen unchanged. Write them as sentences that
name what failed and which file.

## Resident, not just a window

Closing the window hides it to the tray; the app keeps running so `Ctrl+Alt+P`
still works, and Quit is on the tray menu. Two things follow. The tray may not
build on a desktop that has no tray, so `Resident` records whether it did and
the close button only hides when it did — otherwise the app would vanish with
nothing left to click. And the shortcut may already be taken, so
`summon_shortcut` hands the frontend either the shortcut or the reason, and the
sidebar says which.

## One draw()

State lives in module-level variables: `doc`, `cur`, `editing`, `draft`,
`picked`, `filter`, `copied`, `asking`. `draw()` rebuilds the view from them and
is the only thing that writes to the DOM. Do not add a second rendering path, a
targeted DOM patch, an observer or a framework. If something flickers or loses a
caret, fix it by putting that detail in state — `draft` and `caret` exist for
exactly this reason.

Events are delegated from `document` and bound once in `bind()`.

## The round trip is the product

`parse(md)` gives `{ nl, front, lead, blocks:[{raw,h,t}] }` and
`serialize(doc)` is `front + lead + each raw + t`. `front` is the frontmatter,
`lead` is everything above the first `##`, `nl` is the file's own line ending,
and `raw` is the heading line exactly as it was read. All of it belongs to the
user and all of it survives a save: a heading is only rewritten when someone
renames it, through `setHeading()`.

The proof lives in `scripts/roundtrip.js`, which reads the region between the
`/* markdown:begin */` and `/* markdown:end */` markers in `app.js` and asserts
`serialize(parse(x)) === x` over every file that has caught us out — CRLF, code
fences containing `##`, odd heading spacing, no trailing newline, frontmatter
alone. Change the parser and add the case that made you change it. `cargo test`
covers the same ground in Rust: name validation and the save stamp.

Every save carries the stamp from the read it started at, and a save whose
stamp no longer matches the file is refused rather than applied, because
someone may be editing the same file in vim. Frontend mutations go through
`commit()`, which puts the document back if the write is refused, so the
screen never claims something the file does not say.

Every save writes the file and then reads it back from disk, so the screen shows
what is actually stored. Keep it that way.
