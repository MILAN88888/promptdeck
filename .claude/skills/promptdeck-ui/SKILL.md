---
name: promptdeck-ui
description: Use when styling or wording anything in PromptDeck — a new control, card, dialog, empty state or bottom bar, a colour or spacing decision, a button label, an error message, or any text the user will read.
---

# Look and wording

## Colour

Every colour is a variable at the top of `src/app.css`. No raw hex below that
block, ever — if you need a shade that is not there, add a token.

| Token | Use |
| --- | --- |
| `--chrome` `#212a31` | Sidebar and app chrome |
| `--paper` `#f6f4ef` | The reading pane. Paper, not grey |
| `--card` `#ffffff` | Block cards and dialogs |
| `--hairline` `#e3ded3` | Every border. One weight, 1px |
| `--ink` `#1f262b` | Body text |
| `--secondary` `#6b757f` | Counts, timestamps, hints, empty states |
| `--accent` `#2c6e63` | Copy, save, selected blocks. The only accent |
| `--danger` `#9d3b32` | Destructive actions, on hover only |

One `--radius` everywhere. No drop shadows: depth comes from the hairline and
the paper-against-chrome contrast.

## Type

Block bodies and the editor are `--font-mono`. The text ends up in a terminal
and whitespace is meaningful, so it must be shown in a font where it is visible.
Everything else — headings, buttons, counts, dialogs — is `--font-ui`.

Sentence case everywhere. No ALL CAPS, no letter-spaced labels.

## Layout that carries meaning

The copy button sits last in the card's action row, rightmost, in the accent
colour. It is what people came for, so it must sit the same distance from the
edge on every card and be hittable without reading. Edit and Delete sit to its
left in plain chrome, and stay quiet until the pointer is on them — a row of red
buttons teaches people to ignore red.

Selected blocks take the accent border and wash, so a selection is legible
without counting checkboxes.

Keep `:focus-visible` outlines. Honour `prefers-reduced-motion`. The window
minimum is 620x420, so every layout must survive that width.

## Words

Buttons say what will happen: "Copy together", "Delete block", "Create file" —
not "OK", "Submit", "Yes".

A confirmation offers the safe choice first and names the risky one plainly:
"Keep it" beside "Delete block".

Errors do not apologise and do not blame. They say what failed and which file:
"notes.txt is not allowed: prompt files must end in .md." No "Sorry", no
"Oops", no stack traces, no error codes.

Empty states invite the next action instead of reporting a void: "No files yet.
Create one to start a deck."

A toast can carry one button, and only one: the way back from what it is
reporting. It says what it does — "Put it back", not "Undo" — and the offer and
the means to take it expire together, so the app never says something can be
undone after it no longer can.
