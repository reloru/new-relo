#!/usr/bin/env node
// Two-phase offline test for the service worker (/sw.js). Verifies that the SW
// precaches the storm-critical pages and serves them (plus a language-hub
// fallback for uncached paths) when the network is truly gone — the behavior
// that keeps the site answering during storm-time connectivity drops.
//
//   NODE_PATH=/opt/node22/lib/node_modules node scripts/test-sw-offline.mjs
//
// Why two phases with the dev server actually KILLED (not Playwright's
// setOffline): setOffline does NOT apply to SW-initiated fetches, so it can't
// exercise the offline path at all. This script boots `wrangler dev`, registers
// + precaches with it up (phase 1), then kills the server and navigates again
// (phase 2) against a persistent browser profile that keeps the registered SW.
//
// Vary gotcha (why this test exists): the content pages send `Vary: Accept`,
// and the Cache API respects Vary — a navigation's Accept header never equals
// the precache fetch's `*/*`, so every `caches.match` in the SW must pass
// `{ ignoreVary: true }` or all offline matches miss and collapse to the hub.
// If someone drops that flag, phase 2's per-page assertions fail here.
//
// Env overrides: PORT (default 8799), PW_CHROMIUM (default /opt/pw-browsers/chromium).
// Playwright is the global install (no devDependency); NODE_PATH must point at it.

import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require("/opt/node22/lib/node_modules/playwright"));
}

const PORT = process.env.PORT || "8799";
const BASE = `http://127.0.0.1:${PORT}`;
const CHROMIUM = process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium";
const PRECACHE = ["/", "/alerts", "/es", "/es/alerts", "/manifest.json", "/favicon.svg"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); failures++; };

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}
async function serverUp() {
  try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), "sw-test-"));

  // Boot wrangler dev in its own process group so we can kill the whole tree
  // (wrangler spawns workerd as a child).
  console.log(`Starting wrangler dev on :${PORT} ...`);
  const dev = spawn("npx", ["wrangler", "dev", "--port", PORT, "--local", "--ip", "127.0.0.1"], {
    stdio: "ignore",
    detached: true,
  });
  const killDev = () => { try { process.kill(-dev.pid, "SIGKILL"); } catch {} };

  let browser;
  try {
    if (!(await waitForServer(60000))) throw new Error("dev server never became ready");
    ok("dev server ready");

    // --- Phase 1: register + precache with the server UP ---
    console.log("Phase 1 — register SW and precache:");
    browser = await chromium.launchPersistentContext(profile, { executablePath: CHROMIUM });
    let page = await browser.newPage();
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const cached = await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      for (let i = 0; i < 50; i++) {
        const keys = await caches.keys();
        if (keys.length) {
          const c = await caches.open(keys[0]);
          const entries = await c.keys();
          if (entries.length >= 6) return entries.map((e) => new URL(e.url).pathname).sort();
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      return [];
    });
    const missing = PRECACHE.filter((p) => !cached.includes(p));
    if (missing.length === 0) ok(`precached all ${PRECACHE.length} storm-critical entries`);
    else bad(`precache missing: ${missing.join(", ")} (got ${JSON.stringify(cached)})`);
    await browser.close();
    browser = null;

    // --- Kill the server: a real network failure the SW cannot bypass ---
    console.log("Killing dev server ...");
    killDev();
    for (let i = 0; i < 20 && (await serverUp()); i++) await sleep(300);
    if (await serverUp()) throw new Error("dev server still up after kill");
    ok("dev server confirmed down");

    // --- Phase 2: navigate with the server GONE ---
    console.log("Phase 2 — navigate offline (server killed):");
    browser = await chromium.launchPersistentContext(profile, { executablePath: CHROMIUM });
    page = await browser.newPage();
    const title = async (path) => {
      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
      return (await page.title()).trim();
    };
    // Precached pages serve their own cached copy (correct per-language title).
    if ((await title("/alerts")).includes("Weather Alerts")) ok("/alerts served its cached page"); else bad(`/alerts wrong: "${await page.title()}"`);
    if ((await title("/es/alerts")).includes("Alertas")) ok("/es/alerts served its cached Spanish page"); else bad(`/es/alerts wrong: "${await page.title()}"`);
    // Uncached path falls back to the language hub, not a browser error. Match
    // the hub title positively — "News & Schools" is unique to the hub (the
    // real /water page title is "Crosby, TX Water Levels"; note the hub title
    // also contains the word "Water", so a "lacks water" check would misfire).
    const waterTitle = await title("/water");
    if (/News & Schools/.test(waterTitle)) ok(`uncached /water fell back to the hub ("${waterTitle}")`);
    else bad(`/water offline fallback wrong: "${waterTitle}"`);
    // Spanish uncached path falls back to the Spanish hub.
    const esWater = await title("/es/water");
    if (/noticias y escuelas/.test(esWater)) ok(`uncached /es/water fell back to the Spanish hub ("${esWater}")`);
    else bad(`/es/water offline fallback wrong: "${esWater}"`);
    await browser.close();
    browser = null;
  } finally {
    if (browser) await browser.close().catch(() => {});
    killDev();
    rmSync(profile, { recursive: true, force: true });
  }

  console.log("");
  if (failures) { console.log(`FAIL — ${failures} check(s) failed`); process.exit(1); }
  console.log("PASS — service worker offline behavior verified");
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
