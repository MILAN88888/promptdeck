# Changelog

## 0.2.1 — 2026-10-03

Two fixes for editing a block.

- **Ctrl+Z works while editing.** Undo takes back what you typed in the block
  editor or the rename field, a run of typing at a time; Ctrl+Shift+Z or Ctrl+Y
  puts it back.
- **Double-click a block's text to edit it**, the same way double-clicking its
  heading renames it.

## 0.2.0 — 2026-09-18

Open your deck from anywhere, fill in a prompt on its way to the clipboard, and
stop losing text you meant to keep.

- **Ctrl+Alt+P opens PromptDeck from wherever you are**, with a search over
  every block in every file. Type, press Enter, and the block is on your
  clipboard and PromptDeck is out of your way again. Closing the window now
  leaves it in your system tray so the shortcut keeps working; quit from the
  tray menu.
- **Fill in placeholders before copying.** A block containing `{{markers}}` gets
  a Fill button that asks once for each name and copies the finished text.
  Works across a multi-block selection too. Anything you leave blank keeps its
  marker, and your file is never changed — the filling happens on the way to
  the clipboard.
- **Deleting a file moves it to your trash** instead of destroying it, so you
  can get it back from your file manager.
- **Deleting a block offers to put it back** for a few seconds afterwards. Take
  the offer and it returns where it was, body and all.
- **PromptDeck will no longer overwrite a file you changed elsewhere.** If you
  edit the same file in vim while a block is open here, saving is refused with a
  message instead of quietly replacing your work, and what you typed stays in
  the editor. Reload to pick up the new version.

Fixed:

- Files saved with Windows line endings showed **no blocks at all**. Their
  headings are now found, and their line endings are kept on save.
- A `##` inside a fenced code block was treated as a heading, splitting a block
  in two. Fenced code is now left alone.
- Saving rewrote heading lines that had unusual spacing, and inserted a blank
  line between two adjacent headings. Headings are now written back exactly as
  they were unless you rename them.
- Naming a new file `notes.txt` silently created `notes.txt.md`, and an empty
  name created a file the sidebar never showed. Both are now refused, with a
  message saying why.

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
