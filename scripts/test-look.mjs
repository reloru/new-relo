// The look and the wording, checked on the pages as they ship.
//
// The site is laid out like a printed bulletin: flat, ruled, no cards. The
// things this file refuses are the ones that creep back one page at a time
// and make a site look machine-made: gradients, drop shadows, rounded cards,
// pill badges, letter-spaced capitals, emoji used as icons, and arrows tacked
// onto links. None of them breaks a page, so nothing else would catch them.
//
// Every page in the registry is rendered in both languages by the real Worker
// against the KV fixtures, and the rules are applied to the bytes it returns.
//
// Run: node scripts/test-look.mjs

import { createHarness } from "./lib/harness.mjs";
import { PAGES } from "../src/registry.js";

const h = await createHarness();
const failures = [];
const fail = (msg) => failures.push(msg);

// Banned in the shipped CSS. Written out by hand, one reason each.
const CSS_RULES = [
  [/(?:linear|radial|conic)-gradient/, "a gradient"],
  [/box-shadow/, "a drop shadow"],
  [/border-radius\s*:\s*(?!0\b)/, "a rounded corner"],
  [/text-transform\s*:\s*uppercase/, "capitals set by CSS"],
  [/letter-spacing\s*:\s*0?\.\d|letter-spacing\s*:\s*[1-9]/, "letter-spaced text"],
  [/backdrop-filter/, "a blur"],
];
// Emoji and symbol blocks, plus the arrows and marks that were used as icons.
const PICTOGRAPH = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{24D8}\u{2190}-\u{21FF}\u{2139}]/u;
// Technical notation in the two developer pages is not decoration.
const ARROW_OK = new Set(["/developers", "/mcp"]);

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

    const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
    if (!css.includes("--serif")) fail(`${path}: the shared stylesheet is missing`);
    for (const [re, what] of CSS_RULES) {
      const hit = re.exec(css);
      if (hit) fail(`${path}: ${what} in the CSS: "${css.slice(Math.max(0, hit.index - 50), hit.index + 40).replace(/\s+/g, " ")}"`);
    }
    for (const [, style] of html.matchAll(/\sstyle="([^"]*)"/g)) {
      for (const [re, what] of CSS_RULES) if (re.test(style)) fail(`${path}: ${what} in an inline style: "${style}"`);
    }

    // What a reader sees: the body, without scripts, styles or tags.
    const body = decode(html.slice(html.indexOf("<body")).replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ""));
    const text = body.replace(/<[^>]+>/g, " ");
    if (!ARROW_OK.has(p.path)) {
      const hit = PICTOGRAPH.exec(text);
      if (hit) fail(`${path}: pictograph "${hit[0]}" in the text: "${text.slice(Math.max(0, hit.index - 40), hit.index + 20).replace(/\s+/g, " ")}"`);
    }
    for (const [, label] of body.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) {
      if (/[←-⇿]/.test(label)) fail(`${path}: an arrow in a link: "${label.replace(/<[^>]+>/g, "").trim()}"`);
    }
    // One <h1>, and the menu is a word.
    if ((html.match(/<h1\b/g) || []).length !== 1) fail(`${path}: ${(html.match(/<h1\b/g) || []).length} <h1> elements`);
    if (!html.includes(lang === "es" ? "<summary>Menú</summary>" : "<summary>Menu</summary>")) fail(`${path}: the menu is not labelled with a word`);
  }
}
if (pages < 50) fail(`only ${pages} pages rendered; the registry or the harness changed`);

// The front page, by hand.
const home = await (await h.get("/")).text();
for (const [needle, why] of [
  ['<h1 class="place">Crosby, Texas</h1>', "the place is the headline"],
  ['<a class="brand" href="/">crosbynews.com</a>', "the masthead"],
  ["<h2>Alerts and conditions</h2>", "status is one list, not three cards"],
  ["<summary>What these numbers mean</summary>", "one explainer, not five"],
]) if (!home.includes(needle)) fail(`/: missing ${needle} (${why})`);
for (const gone of ["at a Glance", "hub-card", "Full forecast"]) if (home.includes(gone)) fail(`/: "${gone}" is back`);

if (failures.length) {
  console.error(`Look checks failed (${failures.length}):\n  ${failures.slice(0, 40).join("\n  ")}`);
  process.exit(1);
}
console.log(`Look OK: ${pages} pages, no gradients, shadows, rounded cards, pictographs or link arrows.`);
