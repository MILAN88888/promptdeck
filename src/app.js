"use strict";

/* ------------------------------------------------------------------ *
 * Storage
 *
 * Two implementations of one shape. The real one talks to Rust; the
 * in-memory one lets src/index.html open in a plain browser for looking
 * at the UI. A command added to one half must be added to the other.
 * ------------------------------------------------------------------ */

function tauriStore() {
  const { core, clipboardManager } = window.__TAURI__;
  return {
    vaultPath: () => core.invoke("vault_path"),
    list: () => core.invoke("list_files"),
    read: (name) => core.invoke("read_file", { name }),
    write: (name, content) => core.invoke("write_file", { name, content }),
    create: (name) => core.invoke("create_file", { name }),
    remove: (name) => core.invoke("delete_file", { name }),
    copy: (text) => clipboardManager.writeText(text),
  };
}

function memoryStore() {
  const now = () => Math.floor(Date.now() / 1000);
  const files = new Map([
    [
      "welcome.md",
      {
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
    vaultPath: async () => "Preview — no vault on disk",
    list: async () =>
      [...files.entries()]
        .map(([name, f]) => ({ name, modified: f.modified }))
        .sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name)),
    read: async (name) => get(name).content,
    write: async (name, content) => {
      get(name);
      files.set(name, { content, modified: now() });
    },
    create: async (name) => {
      const full = name.endsWith(".md") ? name : `${name}.md`;
      guard(full);
      if (files.has(full)) {
        throw new Error(`${full} already exists in your vault.`);
      }
      const title = full.slice(0, -3);
      files.set(full, {
        content: `# ${title}\n\n## New block\n\n`,
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
 * parse(md) -> { front, lead, blocks:[{h,t}] } and serialize(doc) put a
 * file back together byte for byte. Frontmatter and the text above the
 * first heading are carried through untouched: losing them would be
 * losing the user's writing.
 * ------------------------------------------------------------------ */

const HEADING = /^##(?!#)[ \t]*(.*)$/;
const FRONT = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/;

function parse(md) {
  let front = "";
  let rest = md;
  const fm = rest.match(FRONT);
  if (fm) {
    front = fm[0];
    rest = rest.slice(front.length);
  }

  const lines = rest.split("\n");
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    if (HEADING.test(lines[i])) heads.push(i);
  }
  if (heads.length === 0) return { front, lead: rest, blocks: [] };

  let lead = lines.slice(0, heads[0]).join("\n");
  if (heads[0] > 0) lead += "\n";

  const blocks = heads.map((start, k) => {
    const end = k + 1 < heads.length ? heads[k + 1] : lines.length;
    let t = lines.slice(start + 1, end).join("\n");
    if (end < lines.length) t += "\n";
    return { h: lines[start].match(HEADING)[1].trim(), t };
  });

  return { front, lead, blocks };
}

function serialize(doc) {
  return (
    doc.front +
    doc.lead +
    doc.blocks.map((b) => `## ${b.h}\n${b.t}`).join("")
  );
}

/** The body without its surrounding blank lines. Indentation is kept. */
function bodyText(t) {
  const lines = t.split("\n");
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a].trim() === "") a++;
  while (b > a && lines[b - 1].trim() === "") b--;
  return lines.slice(a, b).join("\n");
}

function setBody(block, text) {
  block.t = text === "" ? "\n\n" : `\n${text}\n\n`;
}

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

let files = [];
let doc = null;
let cur = null;
let editing = null; // { i, mode: "body" | "head" }
let draft = "";
let caret = null;
let picked = new Set();
let filter = "";
let copied = null; // block index, or "all"
let asking = null; // { title, message, input, value, confirmLabel, danger, resolve }
let copyTimer = null;
let toastTimer = null;

const el = {};
for (const id of [
  "vault",
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

const marked = (s) =>
  esc(s).replace(/\{\{[^}\n]*\}\}/g, (m) => `<span class="ph">${m}</span>`);

function ago(secs) {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - secs);
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
         <button class="accent" data-act="copy-all">${
           copied === "all" ? "Copied" : "Copy together"
         }</button>
         <button data-act="clear-picks">Clear selection</button>`;

  el.overlay.hidden = !asking;
  el.overlay.innerHTML = asking ? dialogHtml() : "";

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
    : `<div class="body">${marked(body)}</div>`;

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
        <button class="accent" data-act="copy" data-i="${i}">${
          copied === i ? "Copied" : "Copy"
        }</button>
      </div>
    </div>
    ${below}
  </article>`;
}

function dialogHtml() {
  return `<div class="dialog" role="dialog" aria-modal="true">
    <h2>${esc(asking.title)}</h2>
    <p>${esc(asking.message)}</p>
    ${
      asking.input
        ? `<input id="ask-input" value="${esc(
            asking.value
          )}" placeholder="${esc(asking.placeholder || "")}" />`
        : ""
    }
    <div class="dialog-actions">
      <button data-act="ask-cancel">Keep it</button>
      <button class="${
        asking.danger ? "danger" : "accent"
      }" data-act="ask-ok">${esc(asking.confirmLabel)}</button>
    </div>
  </div>`;
}

function restoreFocus() {
  if (asking) {
    const input = document.getElementById("ask-input");
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

function toast(text) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 4000);
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
  doc = parse(await store.read(name));
  cur = name;
  editing = null;
  caret = null;
  picked.clear();
  draw();
}

/** Write the current document, then read it straight back from disk. */
async function save() {
  await store.write(cur, serialize(doc));
  await refreshFiles();
  await open(cur);
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
      placeholder: opts.placeholder,
      confirmLabel: opts.confirmLabel,
      danger: !!opts.danger,
      resolve,
    };
    draw();
  });
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
    doc.blocks.push({ h: "New block", t: "\n\n" });
    await save();
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
      message: "The file is removed from your vault. This cannot be undone.",
      confirmLabel: "Delete file",
      danger: true,
    });
    if (!ok) return;
    await store.remove(cur);
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
    doc.blocks.splice(i, 1);
    await save();
  });

const copyBlock = (i) =>
  guard(async () => {
    await store.copy(bodyText(doc.blocks[i].t));
    flash(i);
  });

const copyTogether = () =>
  guard(async () => {
    const text = [...picked]
      .sort((a, b) => a - b)
      .map((i) => bodyText(doc.blocks[i].t))
      .join("\n\n");
    await store.copy(text);
    flash("all");
  });

const startEdit = (i) => {
  editing = { i, mode: "body" };
  draft = bodyText(doc.blocks[i].t);
  caret = null;
  draw();
};

const startRename = (i) => {
  editing = { i, mode: "head" };
  draft = doc.blocks[i].h;
  caret = null;
  draw();
};

const cancelEdit = () => {
  editing = null;
  caret = null;
  draw();
};

const commitEdit = () =>
  guard(async () => {
    if (!editing) return;
    const { i, mode } = editing;
    if (mode === "body") {
      setBody(doc.blocks[i], draft);
    } else {
      const h = draft.trim();
      if (!h) return cancelEdit();
      doc.blocks[i].h = h;
    }
    editing = null;
    caret = null;
    await save();
  });

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

function onClick(e) {
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
    case "copy-all":
      return copyTogether();
    case "clear-picks":
      picked.clear();
      return draw();
    case "ask-ok":
      return settle(asking.input ? document.getElementById("ask-input").value : true);
    case "ask-cancel":
      return settle(asking.input ? null : false);
  }
}

function onInput(e) {
  const t = e.target;
  if (t === el.search) {
    filter = t.value;
    return draw();
  }
  if (t.dataset.editor !== undefined || t.dataset.rename !== undefined) {
    draft = t.value;
    caret = t.selectionStart;
  }
}

function onKey(e) {
  const ctrl = e.ctrlKey || e.metaKey;

  if (e.key === "Escape") {
    if (asking) return settle(asking.input ? null : false);
    if (editing) return cancelEdit();
    if (filter || document.activeElement === el.search) {
      el.search.value = "";
      filter = "";
      el.search.blur();
      return draw();
    }
    return;
  }

  if (asking && e.key === "Enter" && asking.input) {
    e.preventDefault();
    return settle(document.getElementById("ask-input").value);
  }

  if (editing && editing.mode === "head" && e.key === "Enter") {
    e.preventDefault();
    return commitEdit();
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
    if (h) startRename(Number(h.dataset.head));
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
  await guard(refreshFiles);
  if (files.length) await guard(() => open(files[0].name));
  else draw();
})();
