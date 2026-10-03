"use strict";

/* ------------------------------------------------------------------ *
 * Storage
 *
 * Two implementations of one shape. The real one talks to Rust; the
 * in-memory one lets src/index.html open in a plain browser for looking
 * at the UI. A command added to one half must be added to the other.
 * ------------------------------------------------------------------ */

function tauriStore() {
  const { core, clipboardManager, event, window: win } = window.__TAURI__;
  return {
    shortcut: () => core.invoke("summon_shortcut"),
    onSummon: (fn) => event.listen("summon", fn),
    hide: () => win.getCurrentWindow().hide(),
    vaultPath: () => core.invoke("vault_path"),
    list: () => core.invoke("list_files"),
    read: (name) => core.invoke("read_file", { name }),
    write: (name, content, stamp) =>
      core.invoke("write_file", { name, content, stamp }),
    create: (name) => core.invoke("create_file", { name }),
    remove: (name) => core.invoke("delete_file", { name }),
    copy: (text) => clipboardManager.writeText(text),
  };
}

function memoryStore() {
  const now = () => Date.now();
  let rev = 0;
  const files = new Map([
    [
      "welcome.md",
      {
        rev: rev++,
        content:
          "---\ntitle: Welcome\n---\n\nPreview mode. Nothing here is written to disk.\n\n" +
          "## Explain this code\n\nRead the code below and explain what it does, one paragraph.\n\n" +
          "## Placeholders\n\nText like {{this}} is highlighted so you can spot it.\n\n",
        modified: now(),
      },
    ],
  ]);

  // Mirrors safe_path() in main.rs so the preview refuses what the app refuses.
  const guard = (name) => {
    if (name.split("/").pop() !== name || name === "") {
      throw new Error(
        `${name} is not allowed: use a plain file name with no folders in it.`
      );
    }
    if (!name.endsWith(".md")) {
      throw new Error(`${name} is not allowed: prompt files must end in .md.`);
    }
    return name;
  };
  const get = (name) => {
    const f = files.get(guard(name));
    if (!f) throw new Error(`Could not read ${name}: it is not in your vault.`);
    return f;
  };

  return {
    shortcut: async () => "Ctrl+Alt+P",
    // Nothing global to listen to in a browser; Ctrl+Alt+P still opens it.
    onSummon: async () => {},
    hide: async () => {},
    vaultPath: async () => "Preview — no vault on disk",
    list: async () =>
      [...files.entries()]
        .map(([name, f]) => ({ name, modified: f.modified }))
        .sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name)),
    read: async (name) => {
      const f = get(name);
      return { content: f.content, stamp: f.rev };
    },
    write: async (name, content, stamp) => {
      if (get(name).rev !== stamp) {
        throw new Error(
          `${name} changed on disk since you opened it. Nothing was saved: reload to see the new version.`
        );
      }
      files.set(name, { content, rev: rev++, modified: now() });
    },
    create: async (name) => {
      if (name.trim() === "") {
        throw new Error("A prompt file needs a name.");
      }
      if (name.startsWith(".")) {
        throw new Error(`${name} is not allowed: a name cannot start with a dot.`);
      }
      if (!name.endsWith(".md") && name.includes(".")) {
        throw new Error(`${name} is not allowed: prompt files must end in .md.`);
      }
      const full = name.endsWith(".md") ? name : `${name}.md`;
      guard(full);
      if (files.has(full)) {
        throw new Error(`${full} already exists in your vault.`);
      }
      const title = full.slice(0, -3);
      files.set(full, {
        content: `# ${title}\n\n## New block\n\n`,
        rev: rev++,
        modified: now(),
      });
      return full;
    },
    remove: async (name) => {
      get(name);
      files.delete(name);
    },
    copy: async (text) => navigator.clipboard.writeText(text),
  };
}

const store =
  typeof window.__TAURI__ !== "undefined" ? tauriStore() : memoryStore();

/* ------------------------------------------------------------------ *
 * Markdown
 *
 * parse(md) -> { nl, front, lead, blocks:[{raw,h,t}] } and
 * serialize(doc) put a file back together byte for byte. A block keeps
 * the heading line it was read from in `raw`, and `h` is only the text
 * to show; the two part company when someone renames it, and not
 * before. Frontmatter, the lead text, CRLF endings and the exact
 * spelling of a heading all belong to the user and all survive a save.
 *
 * scripts/roundtrip.js reads the region between the markers below and
 * proves that. Keep everything it needs inside them.
 * ------------------------------------------------------------------ */

/* markdown:begin */

/** One line at a time, each keeping its terminator, so join("") is exact. */
const LINE = /[^\n]*\n|[^\n]+/g;
const HEADING = /^##(?!#)[ \t]*(.*?)[ \t]*\r?\n?$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const FRONT = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/;

function parse(md) {
  let front = "";
  let rest = md;
  const fm = rest.match(FRONT);
  if (fm) {
    front = fm[0];
    rest = rest.slice(front.length);
  }

  const nl = md.includes("\r\n") ? "\r\n" : "\n";
  const lines = rest.match(LINE) || [];

  // A ## inside a fenced code block is code someone wrote, not a heading.
  const heads = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].match(FENCE);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
    } else if (f) {
      fence = f[1];
    } else if (HEADING.test(lines[i])) {
      heads.push(i);
    }
  }
  if (heads.length === 0) return { nl, front, lead: rest, blocks: [] };

  const blocks = heads.map((start, k) => {
    const end = k + 1 < heads.length ? heads[k + 1] : lines.length;
    return {
      raw: lines[start],
      h: lines[start].match(HEADING)[1],
      t: lines.slice(start + 1, end).join(""),
    };
  });

  return { nl, front, lead: lines.slice(0, heads[0]).join(""), blocks };
}

function serialize(doc) {
  return doc.front + doc.lead + doc.blocks.map((b) => b.raw + b.t).join("");
}

/** A block that is not in the file yet, in the file's own line ending. */
function newBlockOf(doc, h) {
  return { raw: `## ${h}${doc.nl}`, h, t: doc.nl + doc.nl };
}

/** The body without its surrounding blank lines, in LF. Indentation is kept. */
function bodyText(t) {
  const lines = t.replace(/\r\n/g, "\n").split("\n");
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a].trim() === "") a++;
  while (b > a && lines[b - 1].trim() === "") b--;
  return lines.slice(a, b).join("\n");
}

/** Text out of a textarea is LF; the file gets its own ending back. */
function setBody(doc, block, text) {
  const body = doc.nl === "\n" ? text : text.replace(/\n/g, doc.nl);
  block.t = text === "" ? doc.nl + doc.nl : doc.nl + body + doc.nl + doc.nl;
}

/** Rename, keeping the line ending the heading already had. */
function setHeading(block, h) {
  const had = block.raw.match(/\r?\n$/);
  block.h = h;
  block.raw = `## ${h}${had ? had[0] : ""}`;
}

/* markdown:end */

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

let files = [];
let doc = null;
let cur = null;
let editing = null; // { i, mode: "body" | "head" }
let draft = "";
let caret = null;
let past = []; // earlier drafts, newest last, for Ctrl+Z while editing
let future = []; // drafts undone, for Ctrl+Shift+Z / Ctrl+Y
let typed = null; // { kind, at } of the last input, so a run of typing undoes as one
let picked = new Set();
let filter = "";
let copied = null; // block index, or "all"
let undoing = null; // what the toast's button would do, while it is offered
let palette = null; // { q, items, sel } while the summoned search is open
let asking = null; // { title, message, input, value, confirmLabel, danger, resolve }
let copyTimer = null;
let toastTimer = null;

const el = {};
for (const id of [
  "vault",
  "shortcut",
  "palette",
  "files",
  "search",
  "blocks",
  "compose",
  "overlay",
  "toast",
  "new-file",
  "new-block",
  "reload",
  "delete-file",
]) {
  el[id] = document.getElementById(id);
}

/* ------------------------------------------------------------------ *
 * Rendering — one draw(), rebuilt from state
 * ------------------------------------------------------------------ */

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]
  );

/** {{like this}}. Highlighted everywhere, and fillable before a copy. */
const PLACEHOLDER = /\{\{([^}\n]*)\}\}/g;

const marked = (s) =>
  esc(s).replace(PLACEHOLDER, (m) => `<span class="ph">${m}</span>`);

/** The distinct placeholder names in some text, in the order they appear. */
function placeholdersIn(text) {
  const names = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    const key = m[1].trim();
    if (key && !names.includes(key)) names.push(key);
  }
  return names;
}

/** Fill what was given. A blank answer keeps its marker rather than a hole. */
function fillIn(text, values) {
  return text.replace(PLACEHOLDER, (whole, name) => {
    const given = values[name.trim()];
    return given === undefined || given === "" ? whole : given;
  });
}

function ago(ms) {
  const d = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return `${Math.floor(d / 86400)} d ago`;
}

function matches(b) {
  if (!filter) return true;
  const q = filter.toLowerCase();
  return b.h.toLowerCase().includes(q) || b.t.toLowerCase().includes(q);
}

function draw() {
  el.files.innerHTML = files.length
    ? files
        .map(
          (f) => `<li><button data-file="${esc(f.name)}" aria-current="${
            f.name === cur
          }"><span class="name">${esc(f.name)}</span><span class="when">${ago(
            f.modified
          )}</span></button></li>`
        )
        .join("")
    : `<li class="empty">No files yet. Create one to start a deck.</li>`;

  el.blocks.innerHTML = sheetHtml();

  const n = picked.size;
  el.compose.hidden = n < 2;
  el.compose.innerHTML =
    n < 2
      ? ""
      : `<span class="n">${n} blocks selected</span>
         ${
           placeholdersIn(textOf(chosen())).length
             ? `<button data-act="fill-all">Fill…</button>`
             : ""
         }
         <button class="accent" data-act="copy-all">${
           copied === "all" ? "Copied" : "Copy together"
         }</button>
         <button data-act="clear-picks">Clear selection</button>`;

  el.overlay.hidden = !asking;
  el.overlay.innerHTML = asking ? dialogHtml() : "";

  el.palette.hidden = !palette;
  el.palette.innerHTML = palette ? paletteHtml() : "";

  el["new-block"].disabled = !doc;
  el.reload.disabled = !cur;
  el["delete-file"].disabled = !cur;

  restoreFocus();
}

function sheetHtml() {
  if (!doc) {
    return `<div class="empty-state"><h2>Nothing open yet</h2><p>Pick a file on the left, or create one to start collecting prompts.</p></div>`;
  }
  const shown = doc.blocks
    .map((b, i) => [b, i])
    .filter(([b]) => matches(b));

  if (shown.length === 0) {
    return filter
      ? `<div class="empty-state"><h2>No blocks match “${esc(
          filter
        )}”</h2><p>Try a shorter search, or press Escape to see everything again.</p></div>`
      : `<div class="empty-state"><h2>This file has no blocks yet</h2><p>Add a <code>##</code> heading to make one — or press Ctrl+Shift+N.</p></div>`;
  }

  const lead = bodyText(doc.lead);
  const head = lead ? `<p class="lead">${marked(lead)}</p>` : "";
  return head + shown.map(([b, i]) => card(b, i)).join("");
}

function card(b, i) {
  const editingBody = editing && editing.i === i && editing.mode === "body";
  const renaming = editing && editing.i === i && editing.mode === "head";
  const body = bodyText(b.t);

  const title = renaming
    ? `<input class="rename" data-rename="${i}" value="${esc(draft)}" />`
    : `<h2 data-head="${i}" title="Double-click to rename">${esc(b.h)}</h2>`;

  const below = editingBody
    ? `<textarea class="editor" data-editor="${i}">${esc(draft)}</textarea>
       <div class="edit-actions">
         <button class="accent" data-act="save" data-i="${i}">Save</button>
         <button data-act="cancel">Cancel</button>
         <span class="hint">Ctrl+S saves, Escape cancels</span>
       </div>`
    : `<div class="body" data-body="${i}" title="Double-click to edit">${marked(
        body
      )}</div>`;

  return `<article class="block${picked.has(i) ? " picked" : ""}">
    <div class="block-head">
      <input type="checkbox" data-pick="${i}"${
        picked.has(i) ? " checked" : ""
      } aria-label="Select ${esc(b.h)}" />
      ${title}
      <span class="count">${body.length} characters</span>
      <div class="block-actions">
        <button data-act="edit" data-i="${i}"${
          editingBody ? " disabled" : ""
        }>Edit</button>
        <button class="danger" data-act="delete-block" data-i="${i}">Delete</button>
        ${
          placeholdersIn(body).length
            ? `<button data-act="fill" data-i="${i}">Fill…</button>`
            : ""
        }
        <button class="accent" data-act="copy" data-i="${i}">${
          copied === i ? "Copied" : "Copy"
        }</button>
      </div>
    </div>
    ${below}
  </article>`;
}

/** Every block in the vault that matches what has been typed. */
function paletteHits() {
  const q = palette.q.trim().toLowerCase();
  if (!q) return palette.items;
  return palette.items.filter(
    (it) =>
      it.h.toLowerCase().includes(q) ||
      it.body.toLowerCase().includes(q) ||
      it.file.toLowerCase().includes(q)
  );
}

function paletteHtml() {
  const hits = paletteHits();
  const sel = Math.min(palette.sel, Math.max(0, hits.length - 1));
  const list = hits.length
    ? `<ul class="hits">${hits
        .map(
          (it, k) =>
            `<li><button data-hit="${k}"${
              k === sel ? ' aria-current="true"' : ""
            }><span class="hit-h">${esc(it.h)}</span><span class="hit-f">${esc(
              it.file
            )}</span><span class="hit-b">${esc(
              it.body.split("\n")[0]
            )}</span></button></li>`
        )
        .join("")}</ul>`
    : `<p class="hit-none">${
        palette.items.length
          ? `Nothing matches “${esc(palette.q)}”.`
          : "There are no blocks in your vault yet."
      }</p>`;

  return `<div class="palette-box" role="dialog" aria-modal="true" aria-label="Find a block">
    <input id="palette-q" value="${esc(
      palette.q
    )}" placeholder="Find a block in any file" aria-label="Find a block in any file" autocomplete="off" />
    ${list}
    <p class="hint">Enter copies it and closes. Escape closes.</p>
  </div>`;
}

function dialogHtml() {
  return `<div class="dialog" role="dialog" aria-modal="true">
    <h2>${esc(asking.title)}</h2>
    <p>${esc(asking.message)}</p>
    ${
      asking.fields
        ? asking.fields
            .map(
              (f, k) =>
                `<label class="field"><span>${esc(
                  f.key
                )}</span><input data-field="${k}" value="${esc(
                  f.value
                )}" /></label>`
            )
            .join("")
        : asking.input
          ? `<input id="ask-input" value="${esc(
              asking.value
            )}" placeholder="${esc(asking.placeholder || "")}" />`
          : ""
    }
    <div class="dialog-actions">
      <button data-act="ask-cancel">${
        asking.danger ? "Keep it" : "Cancel"
      }</button>
      <button class="${
        asking.danger ? "danger" : "accent"
      }" data-act="ask-ok">${esc(asking.confirmLabel)}</button>
    </div>
  </div>`;
}

function restoreFocus() {
  if (palette) {
    const box = document.getElementById("palette-q");
    if (box) {
      box.focus();
      const at = caret === null ? box.value.length : caret;
      box.setSelectionRange(at, at);
      const on = el.palette.querySelector('[aria-current="true"]');
      if (on) on.scrollIntoView({ block: "nearest" });
    }
    return;
  }
  if (asking) {
    const input =
      document.getElementById("ask-input") ||
      el.overlay.querySelector("[data-field]");
    (input || el.overlay.querySelector('[data-act="ask-ok"]')).focus();
    return;
  }
  if (!editing) return;
  const node = el.blocks.querySelector(
    editing.mode === "body"
      ? `[data-editor="${editing.i}"]`
      : `[data-rename="${editing.i}"]`
  );
  if (!node) return;
  node.focus();
  const at = caret === null ? node.value.length : caret;
  node.setSelectionRange(at, at);
}

/* ------------------------------------------------------------------ *
 * Talking to the store
 * ------------------------------------------------------------------ */

const message = (e) => (typeof e === "string" ? e : e && e.message ? e.message : String(e));

/**
 * A message along the bottom, and at most one thing to do about it.
 *
 * The offer and the means to take it live and die together: `undoing` is set
 * here and cleared when the toast goes, so nothing can be undone after the
 * app has stopped saying it can be.
 */
function toast(text, action) {
  undoing = action ? action.undo : null;
  el.toast.innerHTML =
    esc(text) +
    (action ? ` <button data-act="toast-do">${esc(action.label)}</button>` : "");
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 9000 : 4000);
}

function hideToast() {
  clearTimeout(toastTimer);
  undoing = null;
  el.toast.hidden = true;
  el.toast.innerHTML = "";
}

async function guard(fn) {
  try {
    await fn();
  } catch (e) {
    toast(message(e));
  }
}

async function refreshFiles() {
  files = await store.list();
}

async function open(name) {
  const file = await store.read(name);
  doc = parse(file.content);
  doc.stamp = file.stamp;
  cur = name;
  editing = null;
  caret = null;
  picked.clear();
  draw();
}

/** Write the current document, then read it straight back from disk. */
async function save() {
  await store.write(cur, serialize(doc), doc.stamp);
  await refreshFiles();
  await open(cur);
}

/**
 * Change the document and write it. A write that is refused — by a newer
 * file on disk, a full disk, anything — leaves the document exactly as it
 * was, so the screen keeps matching the file and nobody loses their typing.
 */
async function commit(change) {
  const before = { ...doc, blocks: doc.blocks.map((b) => ({ ...b })) };
  change();
  try {
    await save();
  } catch (e) {
    doc = before;
    draw();
    throw e;
  }
}

function flash(which) {
  copied = which;
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copied = null;
    draw();
  }, 1400);
  draw();
}

function ask(opts) {
  return new Promise((resolve) => {
    asking = {
      title: opts.title,
      message: opts.message,
      input: !!opts.input,
      value: opts.value || "",
      fields: opts.fields,
      placeholder: opts.placeholder,
      confirmLabel: opts.confirmLabel,
      danger: !!opts.danger,
      resolve,
    };
    draw();
  });
}

/** What the dialog resolves to when it is confirmed. */
function answer() {
  if (asking.fields) {
    return Object.fromEntries(asking.fields.map((f) => [f.key, f.value]));
  }
  return asking.input ? document.getElementById("ask-input").value : true;
}

function settle(value) {
  const { resolve } = asking;
  asking = null;
  draw();
  resolve(value);
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

const newFile = () =>
  guard(async () => {
    const name = await ask({
      title: "New file",
      message: "Name it as it will sit in your vault.",
      input: true,
      placeholder: "prompts.md",
      confirmLabel: "Create file",
    });
    if (name === null) return;
    const created = await store.create(name); // sent through as typed
    await refreshFiles();
    await open(created);
  });

const newBlock = () =>
  guard(async () => {
    if (!doc) return;
    await commit(() => doc.blocks.push(newBlockOf(doc, "New block")));
    editing = { i: doc.blocks.length - 1, mode: "body" };
    draft = "";
    caret = null;
    draw();
  });

const deleteFile = () =>
  guard(async () => {
    if (!cur) return;
    const ok = await ask({
      title: `Delete ${cur}?`,
      message: "The file goes to your trash, so you can still get it back.",
      confirmLabel: "Delete file",
      danger: true,
    });
    if (!ok) return;
    const gone = cur;
    await store.remove(cur);
    toast(`${gone} is in your trash.`);
    cur = null;
    doc = null;
    picked.clear();
    await refreshFiles();
    draw();
  });

const deleteBlock = (i) =>
  guard(async () => {
    const ok = await ask({
      title: `Delete “${doc.blocks[i].h}”?`,
      message: "The block and its text are removed from the file.",
      confirmLabel: "Delete block",
      danger: true,
    });
    if (!ok) return;
    // Held by value, and by name: the way back has to survive opening
    // another file, because people look before they undo.
    const gone = { ...doc.blocks[i] };
    const from = cur;
    await commit(() => doc.blocks.splice(i, 1));
    toast(`“${gone.h}” deleted.`, {
      label: "Put it back",
      undo: () =>
        guard(async () => {
          if (cur !== from) await open(from);
          await commit(() =>
            doc.blocks.splice(Math.min(i, doc.blocks.length), 0, gone)
          );
        }),
    });
  });

/** The blocks' bodies, in file order, the way they go on the clipboard. */
const textOf = (indices) =>
  indices.map((i) => bodyText(doc.blocks[i].t)).join("\n\n");

const chosen = () => [...picked].sort((a, b) => a - b);

const copyBlock = (i) =>
  guard(async () => {
    await store.copy(textOf([i]));
    flash(i);
  });

const copyTogether = () =>
  guard(async () => {
    await store.copy(textOf(chosen()));
    flash("all");
  });

/** Ask for each {{placeholder}} once, then copy the filled-in text. */
const fillAndCopy = (indices, which) =>
  guard(async () => {
    const text = textOf(indices);
    const names = placeholdersIn(text);
    if (names.length === 0) {
      await store.copy(text);
      return flash(which);
    }
    const values = await ask({
      title: names.length === 1 ? "Fill in the placeholder" : "Fill in the placeholders",
      message: "Anything you leave blank keeps its marker, so you can spot it later.",
      fields: names.map((key) => ({ key, value: "" })),
      confirmLabel: "Fill and copy",
    });
    if (values === null) return;
    await store.copy(fillIn(text, values));
    flash(which);
  });

/**
 * Open the summoned search over every block in the vault.
 *
 * Already open stays open: the shortcut can arrive while it is up, and
 * wiping out what someone has typed is not what they asked for.
 */
const openPalette = () =>
  guard(async () => {
    if (palette) return;
    await refreshFiles();
    const items = [];
    for (const f of files) {
      const file = await store.read(f.name);
      for (const b of parse(file.content).blocks) {
        items.push({ file: f.name, h: b.h, body: bodyText(b.t) });
      }
    }
    palette = { q: "", items, sel: 0 };
    caret = null;
    draw();
  });

const closePalette = () => {
  palette = null;
  caret = null;
  draw();
};

/** Copy the chosen block and get out of the way, which is the whole point. */
const takeFromPalette = (k) =>
  guard(async () => {
    const hits = paletteHits();
    const it = hits[k === undefined ? Math.min(palette.sel, hits.length - 1) : k];
    if (!it) return;
    await store.copy(it.body);
    closePalette();
    await store.hide();
  });

const movePalette = (by) => {
  const n = paletteHits().length;
  if (n) palette.sel = (Math.min(palette.sel, n - 1) + by + n) % n;
  draw();
};

/** A fresh editor has nothing to undo, whatever the last one had. */
const forgetHistory = () => {
  past = [];
  future = [];
  typed = null;
};

const startEdit = (i) => {
  editing = { i, mode: "body" };
  draft = bodyText(doc.blocks[i].t);
  caret = null;
  forgetHistory();
  draw();
};

const startRename = (i) => {
  editing = { i, mode: "head" };
  draft = doc.blocks[i].h;
  caret = null;
  forgetHistory();
  draw();
};

const cancelEdit = () => {
  editing = null;
  caret = null;
  forgetHistory();
  draw();
};

/**
 * Keep the draft as it was before this input, unless the input carries on
 * a run of the same kind of typing, so one Ctrl+Z takes back a word or a
 * paste rather than a single letter.
 */
const remember = (kind) => {
  const now = Date.now();
  const run =
    typed && typed.kind === kind && now - typed.at < 1000 && !/paste|drop|cut/i.test(kind);
  if (!run) past.push(draft);
  future = [];
  typed = { kind, at: now };
};

/**
 * Step the draft back or forward through its history.
 *
 * The editor is redrawn from `draft` like everything else, so the textarea's
 * own undo stack cannot be relied on; this one lives in state instead. The
 * caret lands at the end of the change, found by matching the tails.
 */
const stepHistory = (from, to) => {
  if (!from.length) return;
  const was = draft;
  to.push(was);
  draft = from.pop();
  let tail = 0;
  while (
    tail < draft.length &&
    tail < was.length &&
    draft[draft.length - 1 - tail] === was[was.length - 1 - tail]
  ) {
    tail++;
  }
  caret = draft.length - tail;
  typed = null;
  draw();
};

const commitEdit = () =>
  guard(async () => {
    if (!editing) return;
    const { i, mode } = editing;
    const h = draft.trim();
    if (mode === "head" && !h) return cancelEdit();
    // A refused save leaves `editing` alone, so the editor stays open with
    // the typing still in it and the toast says what went wrong.
    await commit(() =>
      mode === "body" ? setBody(doc, doc.blocks[i], draft) : setHeading(doc.blocks[i], h)
    );
  });

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

function onClick(e) {
  const hit = e.target.closest("[data-hit]");
  if (hit) return takeFromPalette(Number(hit.dataset.hit));

  const file = e.target.closest("[data-file]");
  if (file) return guard(() => open(file.dataset.file));

  const pick = e.target.closest("[data-pick]");
  if (pick) {
    const i = Number(pick.dataset.pick);
    if (pick.checked) picked.add(i);
    else picked.delete(i);
    return draw();
  }

  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const i = Number(btn.dataset.i);
  switch (btn.dataset.act) {
    case "edit":
      return startEdit(i);
    case "save":
      return commitEdit();
    case "cancel":
      return cancelEdit();
    case "copy":
      return copyBlock(i);
    case "delete-block":
      return deleteBlock(i);
    case "fill":
      return fillAndCopy([i], i);
    case "fill-all":
      return fillAndCopy(chosen(), "all");
    case "copy-all":
      return copyTogether();
    case "toast-do": {
      const run = undoing;
      hideToast();
      return run && run();
    }
    case "clear-picks":
      picked.clear();
      return draw();
    case "ask-ok":
      return settle(answer());
    case "ask-cancel":
      return settle(asking.input || asking.fields ? null : false);
  }
}

function onInput(e) {
  const t = e.target;
  if (t.id === "palette-q") {
    palette.q = t.value;
    palette.sel = 0;
    caret = t.selectionStart;
    return draw();
  }
  if (t === el.search) {
    filter = t.value;
    return draw();
  }
  if (t.dataset.field !== undefined) {
    asking.fields[Number(t.dataset.field)].value = t.value;
    return;
  }
  if (t.dataset.editor !== undefined || t.dataset.rename !== undefined) {
    remember(e.inputType || "");
    draft = t.value;
    caret = t.selectionStart;
  }
}

function onKey(e) {
  const ctrl = e.ctrlKey || e.metaKey;

  // The summoned search owns the keyboard while it is up.
  if (palette) {
    if (e.key === "Escape") return closePalette();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      return movePalette(e.key === "ArrowDown" ? 1 : -1);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      return takeFromPalette();
    }
    return;
  }

  if (ctrl && e.altKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    return openPalette();
  }

  if (e.key === "Escape") {
    if (asking) return settle(asking.input || asking.fields ? null : false);
    if (editing) return cancelEdit();
    if (filter || document.activeElement === el.search) {
      el.search.value = "";
      filter = "";
      el.search.blur();
      return draw();
    }
    return;
  }

  if (asking && e.key === "Enter" && (asking.input || asking.fields)) {
    e.preventDefault();
    return settle(answer());
  }

  if (editing && editing.mode === "head" && e.key === "Enter") {
    e.preventDefault();
    return commitEdit();
  }

  const inEditor =
    e.target.dataset && (e.target.dataset.editor !== undefined || e.target.dataset.rename !== undefined);
  if (editing && inEditor && ctrl && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === "z" || k === "y") {
      e.preventDefault();
      return k === "y" || e.shiftKey ? stepHistory(future, past) : stepHistory(past, future);
    }
  }

  if (ctrl && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (editing) commitEdit();
    return;
  }
  if (ctrl && e.key.toLowerCase() === "k") {
    e.preventDefault();
    el.search.focus();
    el.search.select();
    return;
  }
  if (ctrl && e.key.toLowerCase() === "n") {
    e.preventDefault();
    return e.shiftKey ? newBlock() : newFile();
  }
}

function bind() {
  document.addEventListener("click", onClick);
  document.addEventListener("input", onInput);
  document.addEventListener("keydown", onKey);
  document.addEventListener("dblclick", (e) => {
    const h = e.target.closest("[data-head]");
    if (h) return startRename(Number(h.dataset.head));
    const b = e.target.closest("[data-body]");
    if (b) startEdit(Number(b.dataset.body));
  });
  el["new-file"].addEventListener("click", newFile);
  el["new-block"].addEventListener("click", newBlock);
  el["delete-file"].addEventListener("click", deleteFile);
  el.reload.addEventListener("click", () =>
    guard(async () => {
      await refreshFiles();
      if (cur) await open(cur);
      else draw();
    })
  );
}

(async function init() {
  bind();
  await guard(async () => {
    el.vault.textContent = await store.vaultPath();
  });
  await guard(async () => {
    el.shortcut.textContent = `${await store.shortcut()} opens your deck`;
  });
  await guard(() => store.onSummon(openPalette));
  await guard(refreshFiles);
  if (files.length) await guard(() => open(files[0].name));
  else draw();
})();
