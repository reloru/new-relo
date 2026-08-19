#!/usr/bin/env node
// Regression test for the service worker's PRECACHE branch: it must be
// stale-while-revalidate, never plain cache-first.
//
//   NODE_PATH=/opt/node22/lib/node_modules node scripts/test-sw-revalidate.mjs
//
// Why this exists. Navigations return from the network-first branch above and
// never reach the PRECACHE branch, so the only paths it actually serves are
// /manifest.json and /favicon.svg. Cache-first has no expiry: an installed PWA
// would keep the manifest it downloaded at install FOREVER — wrong name, icons,
// theme colour or start_url — and the single thing that ever cleared it was
// bumping CACHE. That failure is silent, and invisible on a fresh device,
// because only an already-installed client is affected. Exactly the shape of bug
// nobody finds by testing the deploy.
//
// This drives the REAL SW_SCRIPT against a tiny server whose /manifest.json
// changes underneath an installed worker, and asserts the change lands WITHOUT a
// CACHE bump. It discriminates: run it against the pre-2026-08-19 cache-first
// version and it reports v1,v1,v1 and fails.
//
// Companion to test-sw-offline.mjs, which covers the navigation/offline half.
// Env overrides: PORT (default 8801), PW_CHROMIUM (default /opt/pw-browsers/chromium).
// Playwright is the global install (no devDependency); NODE_PATH must point at it.

import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require("/opt/node22/lib/node_modules/playwright"));
}

const PORT = process.env.PORT || "8801";
const BASE = `http://127.0.0.1:${PORT}`;
const CHROMIUM = process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium";
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const { SW_SCRIPT } = await import(join(SRC, "assets", "sw-script.js"));

// The SW precaches "/", "/alerts", "/es", "/es/alerts", "/manifest.json" and
// "/favicon.svg"; addAll() rejects wholesale if any 404s, so serve all six.
let manifestVersion = 1;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title>
<link rel="manifest" href="/manifest.json"></head><body>ok
<script>navigator.serviceWorker.register("/sw.js");</script></body></html>`;

const server = createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  const send = (body, type) => {
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  };
  if (p === "/sw.js") return send(SW_SCRIPT, "text/javascript; charset=utf-8");
  if (p === "/manifest.json") return send(JSON.stringify({ v: manifestVersion }), "application/manifest+json");
  if (p === "/favicon.svg") return send("<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml");
  if (["/", "/alerts", "/es", "/es/alerts"].includes(p)) return send(html, "text/html; charset=utf-8");
  res.writeHead(404);
  res.end("not found");
});
await new Promise((r) => server.listen(Number(PORT), "127.0.0.1", r));

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ serviceWorkers: "allow" });
const page = await ctx.newPage();

let failed = false;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failed = true;
  console.log(`  ${ok ? "✓" : "✗"} ${label} — got v${got}, expected v${want}`);
};

try {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(1200);

  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    console.error("\nFAIL — the service worker never took control; nothing was tested.");
    process.exitCode = 1;
  } else {
    // Requests for a PRECACHE path that are NOT navigations hit the branch under test.
    const read = () => page.evaluate(async () => (await (await fetch("/manifest.json")).json()).v);

    console.log("Precached-asset revalidation:");
    check("initial read is the precached copy", await read(), 1);

    manifestVersion = 2; // the origin now serves something new
    check("immediately after the change, the cached copy still serves (fast)", await read(), 1);

    await page.waitForTimeout(1200); // let the background revalidate land
    check("after revalidation the new copy is served, with no CACHE bump", await read(), 2);

    console.log(failed ? "\nFAIL — the PRECACHE branch is not revalidating" : "\nPASS — stale-while-revalidate verified");
    process.exitCode = failed ? 1 : 0;
  }
} finally {
  await browser.close();
  server.close();
}
