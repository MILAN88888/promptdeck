#!/usr/bin/env node
"use strict";

/* Proof that a file survives being read and written back.
 *
 * There is no module system in this project and there is not going to
 * be one, so this reads the marked markdown region out of src/app.js
 * and runs it over the files that have caught us out before. Every
 * case here is a file someone could really have in their vault. */

const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");
const begin = src.indexOf("/* markdown:begin */");
const end = src.indexOf("/* markdown:end */");
if (begin < 0 || end < 0) {
  console.error(
    "src/app.js has lost a /* markdown:begin */ or /* markdown:end */ marker,\n" +
      "so the round trip cannot be checked. Put it back."
  );
  process.exit(1);
}

const md = {};
new Function(
  "exports",
  src.slice(begin, end) +
    "Object.assign(exports, { parse, serialize, bodyText, setBody, setHeading, newBlockOf });"
)(md);
const { parse, serialize, bodyText, setBody, setHeading, newBlockOf } = md;

let failed = 0;
const show = (s) => JSON.stringify(s);

function check(name, ok, detail) {
  if (ok) return;
  failed++;
  console.error(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
}

/* --- Byte for byte, in and out ------------------------------------- */

const FILES = {
  "an empty file": "",
  "no headings at all": "just notes, no headings\n",
  "one block": "## A\n\nbody\n",
  "a title above the first block": "# Deck\n\nlead text\n\n## A\n\nbody\n",
  "frontmatter and lead": "---\ntitle: x\ntags: [a, b]\n---\n\nlead\n\n## A\n\nbody\n",
  "frontmatter and nothing else": "---\ntitle: x\n---\n",
  "no trailing newline": "## A\n\nbody",
  "a heading with no body": "## A\n",
  "two headings with nothing between": "## A\n## B\n\nbody\n",
  "a heading written without a space": "##A\n\nbody\n",
  "a heading padded with spaces": "##   A  \n\nbody\n",
  "a heading padded with a tab": "## A\t\n\nbody\n",
  "a ### that is not a block": "## A\n\n### sub\n\ntext\n",
  "blank lines inside a body": "## A\n\none\n\n\n\ntwo\n\n## B\n\nb\n",
  "a fenced example containing ##": "## A\n\n```md\n## not a heading\n```\n\ntail\n",
  "a tilde fence containing ##": "## A\n\n~~~\n## not a heading\n~~~\n",
  "an indented fence containing ##": "## A\n\n   ```\n   ## not a heading\n   ```\n",
  "a fence that is never closed": "## A\n\n```\n## still code\n",
  "a fence closed only by its own length":
    "## A\n\n````\n```\n## not a heading\n````\n",
  "CRLF throughout": "## A\r\n\r\nbody\r\n## B\r\n\r\nmore\r\n",
  "CRLF with frontmatter": "---\r\ntitle: x\r\n---\r\n\r\nlead\r\n\r\n## A\r\n\r\nbody\r\n",
  "trailing blank lines": "## A\n\nbody\n\n\n",
  "a body that is only whitespace": "## A\n   \n\t\n",
  "unicode in a heading and body": "## Café ☕ {{name}}\n\nrésumé — ναι\n",
};

for (const [name, text] of Object.entries(FILES)) {
  const out = serialize(parse(text));
  check(
    `round trip: ${name}`,
    out === text,
    `in  ${show(text)}\n        out ${show(out)}`
  );
}

/* --- What counts as a block ---------------------------------------- */

const count = (text) => parse(text).blocks.length;

check("CRLF headings are found", count(FILES["CRLF throughout"]) === 2);
check("### is not a block", count(FILES["a ### that is not a block"]) === 1);
check("## inside a fence is code", count(FILES["a fenced example containing ##"]) === 1);
check("## inside a ~~~ fence is code", count(FILES["a tilde fence containing ##"]) === 1);
check("## inside an indented fence is code", count(FILES["an indented fence containing ##"]) === 1);
check("a fence with no closer runs to the end", count(FILES["a fence that is never closed"]) === 1);
check("a short fence does not close a longer one", count(FILES["a fence closed only by its own length"]) === 1);
check("a heading is read without its padding", parse("##   A  \n").blocks[0].h === "A");
check("spaces inside a heading are kept", parse("## A  B\n").blocks[0].h === "A  B");

/* --- Editing one block leaves the rest of the file alone ------------ */

{
  const text =
    "---\nk: v\n---\nlead\n\n##   Odd  spacing  \n\nfirst\n\n## B\n\nsecond\n";
  const doc = parse(text);
  setBody(doc, doc.blocks[1], "rewritten");
  const out = serialize(doc);
  check("an edit keeps the frontmatter and lead", out.startsWith("---\nk: v\n---\nlead\n"));
  check(
    "an edit keeps the neighbouring block byte for byte",
    out.includes("##   Odd  spacing  \n\nfirst\n"),
    show(out)
  );
  check("an edit writes the new body", out.endsWith("## B\n\nrewritten\n\n"), show(out));
}

{
  const doc = parse("## A\r\n\r\nold\r\n");
  setBody(doc, doc.blocks[0], "one\ntwo");
  check(
    "an edit in a CRLF file stays CRLF",
    serialize(doc) === "## A\r\n\r\none\r\ntwo\r\n\r\n",
    show(serialize(doc))
  );
}

{
  const doc = parse("##A\n\nbody\n");
  setBody(doc, doc.blocks[0], "body");
  check(
    "editing a body does not rewrite its heading",
    serialize(doc) === "##A\n\nbody\n\n",
    show(serialize(doc))
  );
  setHeading(doc.blocks[0], "B");
  check(
    "renaming writes the heading properly",
    serialize(doc) === "## B\n\nbody\n\n",
    show(serialize(doc))
  );
}

{
  const doc = parse("## A\r\n\r\nbody\r\n");
  doc.blocks.push(newBlockOf(doc, "New block"));
  check(
    "a new block takes the file's line ending",
    serialize(doc) === "## A\r\n\r\nbody\r\n## New block\r\n\r\n\r\n",
    show(serialize(doc))
  );
}

/* --- What reaches the clipboard ------------------------------------ */

check("a body loses its surrounding blank lines", bodyText("\n\nbody\n\n") === "body");
check("a CRLF body reaches the clipboard as LF", bodyText("\r\nline one\r\nline two\r\n\r\n") === "line one\nline two");
check("indentation inside a body is kept", bodyText("\n    indented\n\n") === "    indented");
check("a blank body is empty, not whitespace", bodyText("\n   \n\t\n") === "");

if (failed) {
  console.error(`\n${failed} round trip check${failed === 1 ? "" : "s"} failed.`);
  process.exit(1);
}
console.log(
  `round trip intact over ${Object.keys(FILES).length} files, and editing is local`
);
