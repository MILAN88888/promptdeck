---
name: promptdeck-feature
description: Use when adding or changing behaviour in PromptDeck — a new Tauri command, a new interaction in the reading pane, a change to how blocks are parsed, edited, selected or written back to the markdown file, or anything that reads or writes the vault.
---

# Changing behaviour in PromptDeck

## Two layers, no third

`src-tauri/src/main.rs` does every filesystem operation and nothing else. It
stays under about 150 lines. `src/app.js` does everything else: the store shim,
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

## One draw()

State lives in module-level variables: `doc`, `cur`, `editing`, `draft`,
`picked`, `filter`, `copied`, `asking`. `draw()` rebuilds the view from them and
is the only thing that writes to the DOM. Do not add a second rendering path, a
targeted DOM patch, an observer or a framework. If something flickers or loses a
caret, fix it by putting that detail in state — `draft` and `caret` exist for
exactly this reason.

Events are delegated from `document` and bound once in `bind()`.

## The round trip is the product

`parse(md)` gives `{ front, lead, blocks:[{h,t}] }` and `serialize(doc)` puts it
back byte for byte. `front` is the frontmatter, `lead` is everything above the
first `##`. Both belong to the user and must survive every save.

After changing either function, prove it: assert
`serialize(parse(x)) === x` over frontmatter, lead text, `###` headings that are
not blocks, code fences, blank lines inside a body, and a file with no trailing
newline. Then check that editing one block leaves its neighbours untouched.
Throw the assertions away afterwards; they are proof, not a test suite.

Every save writes the file and then reads it back from disk, so the screen shows
what is actually stored. Keep it that way.
