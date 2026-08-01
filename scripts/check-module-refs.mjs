// Catch a module using a name that belongs to another module without importing
// it — the failure a multi-file src/ invites, and one that NEITHER CI gate sees.
//
//   node --check          parses one file at a time and does not follow imports,
//                         so an unimported name is perfectly valid syntax.
//   wrangler --dry-run    bundles with esbuild, which treats an unresolved
//                         identifier as a *global* and emits no error at all.
//
// This is not hypothetical. During the src/index.js decomposition,
// src/lib/format.js used TZ without importing it. Both gates went green. The
// bug would not even have crashed: fmt() wraps its body in try/catch and
// returns "", so every timestamp, day heading, hour label and "Updated" stamp
// on the site would have silently rendered as an empty string, with nothing in
// the logs. A swallowed ReferenceError is worse than a loud one.
//
// Method: build the set of names exported anywhere under src/, then for each
// module flag any of those names it references without importing or declaring
// locally. Deliberately narrow — it only asks "does this file reach for another
// module's export without saying so", which is exactly the mistake a file split
// makes easy. It is not a general undefined-variable checker and does not try
// to be one.
//
// To keep it accurate, the scanner reduces each file to code only: comments and
// string bodies are dropped, while template-literal `${...}` substitutions are
// kept, because those are real code. That matters in this repo, where most of
// the HTML lives inside template literals — without it, prose in a page body
// would false-positive, and with a cruder fix (only matching short names in
// call position) the original TZ bug still slipped through, since TZ is used as
// a value, not called.
//
// Run: node scripts/check-module-refs.mjs

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname;

async function jsFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await jsFiles(p)));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out.sort();
}

// Reduce a source file to code only. Drops comments and the *text* of string
// and template literals, but keeps template `${...}` substitutions, which are
// code and routinely reference imports in this repo's HTML builders.
function codeOnly(s) {
  let out = "";
  let i = 0;
  const stack = []; // brace depth per open template substitution
  while (i < s.length) {
    const c = s[i];
    const next = s[i + 1];
    if (c === "/" && next === "/") {
      while (i < s.length && s[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      i += 2;
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++;
      i += 2;
    } else if (c === '"' || c === "'") {
      const q = c;
      i++;
      while (i < s.length && s[i] !== q) i += s[i] === "\\" ? 2 : 1;
      i++;
      out += ' "" ';
    } else if (c === "`") {
      i++;
      // Walk the template, emitting only what is inside ${ }.
      let depth = 0;
      while (i < s.length) {
        if (s[i] === "\\") { i += 2; continue; }
        if (depth === 0 && s[i] === "`") { i++; break; }
        if (depth === 0 && s[i] === "$" && s[i + 1] === "{") {
          depth = 1; i += 2; out += " ";
          continue;
        }
        if (depth > 0) {
          if (s[i] === "{") depth++;
          else if (s[i] === "}") { depth--; if (depth === 0) { i++; out += " "; continue; } }
          // Nested strings/templates inside a substitution: recurse cheaply by
          // letting the outer loop handle them on the next pass.
          out += s[i];
        }
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  // A substitution can itself contain strings/templates; one more pass settles it.
  return stack.length === 0 && /["'`]/.test(out) && out.length < s.length ? codeOnly(out) : out;
}

const EXPORT_RE =
  /^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g;
const DECL_RE =
  /(?:^|\s)(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;

const files = await jsFiles(SRC);
const sources = new Map(); // code-only text, for reference matching
const raws = new Map();    // raw text, for import parsing (paths are literals)
const owner = new Map();   // exported name -> module it comes from

for (const f of files) {
  const raw = await readFile(f, "utf8");
  raws.set(f, raw);
  sources.set(f, codeOnly(raw));
  for (const m of raw.matchAll(EXPORT_RE)) owner.set(m[1], relative(SRC, f));
}

const failures = [];

for (const f of files) {
  const rel = relative(SRC, f);
  const code = sources.get(f);

  // Parse imports from the raw source: codeOnly() blanks the module path, which
  // is a string literal, and IMPORT_RE needs it to anchor the match.
  const imported = new Set();
  for (const m of raws.get(f).matchAll(IMPORT_RE)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) imported.add(name);
    }
  }
  const declared = new Set([...code.matchAll(DECL_RE)].map((m) => m[1]));

  for (const [name, from] of owner) {
    if (from === rel || imported.has(name) || declared.has(name)) continue;
    // Skip property access (obj.TZ) and object-literal keys ({ TZ: ... }) —
    // both are same-name-different-thing, not a reference to the export.
    const re = new RegExp(`(^|[^.\\w$])${name}\\b(?!\\s*:)`);
    if (re.test(code)) failures.push({ rel, name, from });
  }
}

if (failures.length) {
  console.error(`\n${failures.length} unimported cross-module reference(s):\n`);
  for (const f of failures) {
    console.error(`  ${f.rel} uses '${f.name}', which is exported by ${f.from}`);
  }
  console.error("\nAdd the import, or the name resolves to undefined at runtime.\n");
  process.exit(1);
}

console.log(
  `Module references OK — ${files.length} modules, ${owner.size} exported names, no unimported use.`,
);
