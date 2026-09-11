# Changelog

## 0.1.0 — 2026-09-11

First release.

PromptDeck keeps your prompts as plain markdown in `~/PromptDeck` and gives you
a fast way to get them onto the clipboard.

- Every `##` heading in a file becomes a block with its own copy button. Copying
  puts the text under the heading on your clipboard — never the heading itself.
- Tick two or more blocks and copy them together. They arrive joined in file
  order with a blank line between, ready to paste into a terminal.
- Edit a block in place and it is written straight back to the markdown file.
  Double-click a heading to rename it.
- Search filters blocks by heading and body. Ctrl+K jumps to the search box,
  Escape clears it.
- Reload re-reads the open file, for when you have just changed it in vim.
- `{{placeholder}}` text is highlighted so you can see what still needs filling
  in by hand.
- Your files stay yours: they are ordinary markdown, readable and editable by
  anything else on your machine. Nothing else is stored anywhere.

Keyboard: Ctrl+K search, Ctrl+N new file, Ctrl+Shift+N new block, Ctrl+S save.
