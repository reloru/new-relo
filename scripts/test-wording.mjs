// The wording, checked on the pages as they ship.
//
// Two habits creep back one page at a time and nothing else would catch them:
// an emoji or symbol standing in for a word, and an arrow tacked onto a link
// instead of words that say where it goes. Symbols are still used as
// decoration (the status panels, the menu button), but only inside a
// <span aria-hidden="true">, so the text reads the same without them.
//
// Every page in the registry is rendered in both languages by the real Worker
// against the KV fixtures, and the rules are applied to the bytes it returns.
//
// Run: node scripts/test-wording.mjs

import { createHarness } from "./lib/harness.mjs";
import { PAGES } from "../src/registry.js";

const h = await createHarness();
const failures = [];
const fail = (msg) => failures.push(msg);

// Emoji and symbol blocks, plus the arrows and marks that were used as icons.
const PICTOGRAPH = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{24D8}\u{2190}-\u{21FF}\u{2139}]/u;
// Technical notation in the two developer pages is not decoration.
const ARROW_OK = new Set(["/developers", "/mcp"]);

// Split HTML without regex replacement: drop everything between the open and
// close of an element by index, and walk tags one character at a time.
const dropElements = (html, name) => {
  let out = "", i = 0;
  for (;;) {
    const open = html.indexOf(`<${name}`, i);
    if (open < 0) return out + html.slice(i);
    out += html.slice(i, open);
    const close = html.indexOf(`</${name}>`, open);
    if (close < 0) return out;
    i = close + name.length + 3;
  }
};
const HIDDEN = '<span aria-hidden="true">';
const HIDDEN_ICON = '<span class="status-icon" aria-hidden="true">';
const dropHidden = (html) => {
  for (const open of [HIDDEN, HIDDEN_ICON]) {
    for (;;) {
      const at = html.indexOf(open);
      if (at < 0) break;
      const close = html.indexOf("</span>", at);
      if (close < 0) break;
      html = html.slice(0, at) + html.slice(close + 7);
    }
  }
  return html;
};
const textOf = (html) => {
  let out = "", inTag = false;
  for (const ch of html) {
    if (ch === "<") { inTag = true; out += " "; } else if (ch === ">") inTag = false; else if (!inTag) out += ch;
  }
  return out;
};

const decode = (s) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&rarr;/g, "→").replace(/&larr;/g, "←");

let pages = 0;
for (const p of PAGES) {
  for (const lang of ["en", "es"]) {
    const path = lang === "es" ? (p.path === "/" ? "/es" : `/es${p.path}`) : p.path;
    const res = await h.get(path, { headers: { accept: "text/html" } });
    if (res.status !== 200) { fail(`${path}: status ${res.status}`); continue; }
    const html = await res.text();
    pages++;

    // What a reader sees: the body, without scripts, styles or tags.
    const body = decode(dropElements(dropElements(html.slice(html.indexOf("<body")), "script"), "style"));
    // A symbol is allowed as decoration only: inside a <span aria-hidden="true">,
    // where a screen reader skips it and the words beside it carry the meaning.
    const text = textOf(dropHidden(body));
    if (!ARROW_OK.has(p.path)) {
      const hit = PICTOGRAPH.exec(text);
      if (hit) fail(`${path}: pictograph "${hit[0]}" in the text: "${text.slice(Math.max(0, hit.index - 40), hit.index + 20).replace(/\s+/g, " ")}"`);
    }
    for (const [, label] of body.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) {
      if (/[←-⇿]/.test(label)) fail(`${path}: an arrow in a link: "${textOf(label).trim()}"`);
    }
    // One <h1>, and the menu button has a name a screen reader can say.
    if ((html.match(/<h1\b/g) || []).length !== 1) fail(`${path}: ${(html.match(/<h1\b/g) || []).length} <h1> elements`);
    if (!html.includes(lang === "es" ? '<summary aria-label="Menú">' : '<summary aria-label="Menu">')) fail(`${path}: the menu button has no label`);
  }
}
if (pages < 50) fail(`only ${pages} pages rendered; the registry or the harness changed`);

// The front page, by hand.
const home = await (await h.get("/")).text();
for (const [needle, why] of [
  ['<a class="brand" href="/">crosbynews.com</a>', "the masthead"],
  ['<section class="hub-hero">', "current conditions sit in the coloured panel"],
  ['<section class="hub-card"', "each section is a card"],
  ["<summary>What these numbers mean</summary>", "one explainer, not five"],
  [">Seven-day forecast</a>", "the button says where it goes"],
]) if (!home.includes(needle)) fail(`/: missing ${needle} (${why})`);
for (const gone of ["at a Glance", "Full forecast", "Details"]) if (home.includes(gone)) fail(`/: "${gone}" is back`);

if (failures.length) {
  console.error(`Wording checks failed (${failures.length}):\n  ${failures.slice(0, 40).join("\n  ")}`);
  process.exit(1);
}
console.log(`Wording OK: ${pages} pages, no symbols in the text and no arrows on links.`);
