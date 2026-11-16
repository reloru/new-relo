// Colour contrast — the palette tokens, and which token may carry text.
//
// Why this file exists: a contrast regression is INVISIBLE to every other gate.
// Nothing throws, no render fails, the page returns 200 and looks fine to
// whoever changed it — it is only unreadable for the people who most need to
// read it. `--accent` (#2c7fb8) sat at 3.6-4.3:1 on the four surfaces for the
// life of the site, under the 4.5:1 WCAG AA needs for normal text, and it took
// a human squinting at /burn-ban's resources list to notice.
//
// So this pins two things a code review will not catch:
//   1. the tokens themselves still measure AA against the surfaces they are
//      used on, in BOTH themes;
//   2. --accent has not crept back onto body text. It is a DECORATION token
//      (gradients, badge fills, large display numerals). Every readable use
//      belongs to --link (coloured text) or --btn (a surface under white text).

import { readFileSync, readdirSync } from "node:fs";
import { BASE_CSS } from "../src/assets/base-css.js";

let failed = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `\n          ${detail}`}`);
};

// --- WCAG 2.x relative luminance / contrast ratio -------------------------
const lin = (c) => (c /= 255) <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const lum = (hex) => {
  const n = parseInt(hex.slice(1).length === 3 ? hex.slice(1).replace(/./g, (d) => d + d) : hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// --- Read the palette out of the shipped CSS, not a copy of it ------------
// Light values come from the bare :root; the dark block overrides a subset, so
// dark = light with those applied. Reading BASE_CSS itself is the point: a
// hand-maintained duplicate of the palette here could drift and pass anyway.
const tokensIn = (block) => Object.fromEntries([...block.matchAll(/(--[a-z]+)\s*:\s*(#[0-9a-fA-F]{3,6})/g)].map((m) => [m[1], m[2]]));
const rootBlock = BASE_CSS.match(/:root\s*\{([^}]*)\}/)[1];
const darkBlock = BASE_CSS.match(/prefers-color-scheme:\s*dark\s*\)\s*\{\s*:root\s*\{([^}]*)\}/)[1];
const light = tokensIn(rootBlock);
const dark = { ...light, ...tokensIn(darkBlock) };

console.log("\nPalette tokens — AA against the surfaces they sit on:\n");

const AA_TEXT = 4.5; // WCAG 1.4.3, normal-size text
const AA_UI = 3.0; // WCAG 1.4.11, non-text UI boundaries

for (const [theme, t] of [["light", light], ["dark", dark]]) {
  for (const surface of ["--bg", "--card"]) {
    for (const fg of ["--link", "--ink", "--muted"]) {
      const r = ratio(t[fg], t[surface]);
      check(`${theme}: ${fg} on ${surface} is AA text`, r >= AA_TEXT, `${r.toFixed(2)}:1 (needs ${AA_TEXT})`);
    }
  }
  // --btn exists to carry WHITE text, which is why it deliberately does NOT
  // flip between themes: a light --btn would fail its own label. It still has
  // to be discernible as a shape against the page it sits on.
  const onBtn = ratio("#ffffff", t["--btn"]);
  check(`${theme}: white text on --btn is AA text`, onBtn >= AA_TEXT, `${onBtn.toFixed(2)}:1 (needs ${AA_TEXT})`);
  const btnEdge = ratio(t["--btn"], t["--bg"]);
  check(`${theme}: --btn reads as a shape on --bg`, btnEdge >= AA_UI, `${btnEdge.toFixed(2)}:1 (needs ${AA_UI})`);
}

// The guard that explains the whole file: if --accent ever became readable,
// the sweep below would be pointless and someone would "simplify" the tokens
// back into one. It is bright BECAUSE it is decoration.
const accentBest = Math.max(...[light, dark].flatMap((t) => [ratio(t["--accent"], t["--bg"]), ratio(t["--accent"], t["--card"])]));
check("--accent is still decoration-only (below AA everywhere)", accentBest < AA_TEXT, `best surface measures ${accentBest.toFixed(2)}:1 — if this now passes, retire --link rather than leaving two tokens`);

console.log("\n--accent must not carry text — every readable use is --link / --btn:\n");

// Large display numerals are exempt: WCAG's large-text threshold is 18.66px
// bold, and these are 1.45rem/800 and 1.5rem/800 with no root font-size
// override, so 3:1 applies to them and --accent clears it.
const LARGE_TEXT_OK = new Set([".cal-day", ".period .temp"]);
const sources = readdirSync("src", { recursive: true }).filter((f) => f.endsWith(".js"));
const offenders = [];
for (const file of sources) {
  const text = readFileSync(`src/${file}`, "utf8");
  text.split("\n").forEach((line, i) => {
    // `color:var(--accent)` only — border-color / background / gradients are
    // decoration and stay. The negative lookbehind keeps `border-left-color`
    // and `border-color` out, which a naive /color:var\(--accent\)/ would hit.
    if (!/(?<![-a-z])color\s*:\s*var\(--accent\)/.test(line)) return;
    const selector = line.trim().split("{")[0].trim();
    if (LARGE_TEXT_OK.has(selector)) return;
    offenders.push(`${file}:${i + 1}  ${selector}`);
  });
}
check("no new --accent text colour", offenders.length === 0, offenders.join("\n          "));

// And the exempt ones must still clear the LARGE-text bar they are exempt under.
for (const [theme, t] of [["light", light], ["dark", dark]]) {
  const r = ratio(t["--accent"], t["--card"]);
  check(`${theme}: --accent large display numerals clear 3:1`, r >= AA_UI, `${r.toFixed(2)}:1 (needs ${AA_UI})`);
}

// --- Coloured fills under white text --------------------------------------
//
// The status banners, AQI hero, and gauge/fishing/hub badges set white text on
// a hard-coded fill or gradient. Every one of those carries normal-size text
// (the banners' sub-line, the badges' labels), so EVERY gradient stop must
// clear 4.5:1 against white — text sits over the light end as often as the dark
// one. Before 2026-11-10 the green fill measured 4.32:1, its gradient end
// 2.57:1, and the amber/orange/gray ends 2.2-3.8:1; the palette sweep above
// never saw them because they are not tokens.
//
// Two sources, both read from the shipped files:
//   1. any rule that declares `color:#fff` and a hard-coded background on the
//      same line (finds new ones without anyone listing them);
//   2. modifier rules that only set the background of a white-text element
//      declared elsewhere (`.status-ok`, `.w-normal .gauge-badge`, `.a-good`).
//      Each pattern must match at least once, so a rename cannot make this vacuous.
console.log("\nColoured fills carrying white text — every stop AA (4.5:1):\n");

const WHITE = "#ffffff";
const BLUE_TOKENS = { "var(--blue)": light["--blue"], "var(--btn)": light["--btn"], "var(--accent)": light["--accent"] };
const stopsIn = (bg) => [
  ...[...bg.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)].map((m) => m[0]),
  ...Object.entries(BLUE_TOKENS).filter(([v]) => bg.includes(v)).map(([, hex]) => hex),
];
const MODIFIERS = [
  ["features/home.js", /^\.hub-water\.[\w-]+ \.hub-water-badge$/],
  ["features/water.js", /^\.w-[\w-]+ \.gauge-badge$/],
  ["features/water.js", /^\.status-[\w-]+$/],
  ["features/fishing.js", /^\.f-[\w-]+ \.fbadge$/],
  ["features/traffic.js", /^\.status-[\w-]+$/],
  ["features/tropics.js", /^\.status-[\w-]+$/],
  ["features/burnban.js", /^\.status-[\w-]+$/],
  ["features/air.js", /^\.a-[\w-]+$/],
];
const STRUCTURAL = new Set([".status-icon", ".status-title", ".status-sub"]);
const fills = []; // [where, selector, stop]
for (const file of sources) {
  const text = readFileSync(`src/${file}`, "utf8");
  const mods = MODIFIERS.filter(([f]) => file.replace(/\\/g, "/") === f).map(([, re]) => re);
  text.split("\n").forEach((line, i) => {
    // Several rules can share a line (`.w-normal { … } .w-normal .gauge-badge { … }`).
    for (const [, rawSel, body] of line.matchAll(/([^{}@]+?)\s*\{([^{}]*)\}/g)) {
      const selector = rawSel.trim();
      const bg = /(?:^|;)\s*background\s*:\s*([^;]+)/.exec(body)?.[1];
      if (!bg) continue;
      const whiteHere = /(?<![-a-z])color\s*:\s*#fff(?:fff)?\b/i.test(body);
      const isModifier = mods.some((re) => re.test(selector)) && !STRUCTURAL.has(selector);
      if (!whiteHere && !isModifier) continue;
      for (const stop of stopsIn(bg)) fills.push([`${file}:${i + 1}`, selector, stop]);
    }
  });
}
for (const [f, re] of MODIFIERS) {
  const hit = fills.some(([where, sel]) => where.startsWith(`${f}:`) && re.test(sel));
  check(`modifier pattern still matches: ${f} ${re}`, hit, "renamed? update MODIFIERS so these fills stay measured");
}
const lowFills = fills.filter(([, , stop]) => ratio(WHITE, stop) < AA_TEXT);
check(`${fills.length} fill stops under white text are AA`, lowFills.length === 0,
  lowFills.map(([w, s, stop]) => `${w}  ${s}  ${stop} = ${ratio(WHITE, stop).toFixed(2)}:1`).join("\n          "));

// Pollen category names are coloured TEXT on --card, in both themes, and at
// 1.35rem/800 they are large text (3:1).
const pollenText = readFileSync("src/features/pollen.js", "utf8");
const pcats = [...pollenText.matchAll(/\.(c-[\w-]+) \.pcat \{ color:(#[0-9a-fA-F]{6}); \}/g)];
check("pollen category colours found", pcats.length >= 4, `found ${pcats.length}`);
for (const [, cls, hex] of pcats) {
  for (const [theme, t] of [["light", light], ["dark", dark]]) {
    const r = ratio(hex, t["--card"]);
    check(`${theme}: pollen .${cls} label on --card clears 3:1 (large text)`, r >= AA_UI, `${hex} = ${r.toFixed(2)}:1`);
  }
}

console.log(
  failed === 0
    ? "\nContrast OK — every readable token measures AA, and --accent carries no body text.\n"
    : `\n${failed} check(s) FAILED\n`
);
process.exit(failed === 0 ? 0 : 1);
