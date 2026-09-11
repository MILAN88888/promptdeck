# PromptDeck

Keep your prompts as plain markdown, and get them into a terminal fast.

PromptDeck reads every `.md` file in `~/PromptDeck`. Each `##` heading becomes a
block with its own copy button, and copying puts the text *under* the heading on
your clipboard — never the heading itself. Edit a block and it is written
straight back to the file.

There is no database and no config format. Your prompts are ordinary markdown
files you can edit in vim, grep, or keep in git.

## Install

Download from [the latest release](https://github.com/MILAN88888/promptdeck/releases/latest).

**Debian, Ubuntu and derivatives**

```sh
sudo apt install ./PromptDeck_0.1.0_amd64.deb
```

Then launch PromptDeck from your application menu, or run `promptdeck`.

**AppImage** — no install, runs anywhere

```sh
chmod +x PromptDeck_0.1.0_amd64.AppImage
./PromptDeck_0.1.0_amd64.AppImage
```

## Using it

A file looks like this, and that is the whole format:

```markdown
---
title: Anything you like here is left alone
---
Notes above the first heading are left alone too.

## Explain this code

Read the code below and explain what it does, one paragraph.

## Write a commit message

A short subject line under 60 characters, then the reasoning as prose.
```

- **Copy** puts the block body on the clipboard. The button says "Copied" for a
  moment so you know it landed.
- **Tick two or more blocks** and a bar appears offering to copy them together.
  They arrive in file order with a blank line between, whatever order you
  ticked them in.
- **Edit** swaps the body for a text box. Save writes the file.
- **Double-click a heading** to rename it. Enter commits, Escape cancels.
- **Search** filters blocks by heading and body.
- **Reload** re-reads the open file, for when you just changed it in vim.
- `{{placeholder}}` text is highlighted so you can see what still needs filling
  in by hand.

Frontmatter and anything above the first heading are yours. PromptDeck carries
them through untouched on every save.

### Keyboard

| | |
| --- | --- |
| `Ctrl+K` | Search, `Escape` clears it |
| `Ctrl+N` | New file |
| `Ctrl+Shift+N` | New block |
| `Ctrl+S` | Save the open editor |

## Building from source

Needs [Rust](https://rustup.rs) and Node. On Debian or Ubuntu:

```sh
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf libxdo-dev
npm install
npm run dev      # run it
npm run build    # produce a .deb and an .AppImage
```

`scripts/verify.sh` runs everything CI runs and lists the bundles it produced.
`scripts/bump.sh` keeps the version in step across the three files that carry it.

## Licence

MIT. See [LICENSE](LICENSE).
