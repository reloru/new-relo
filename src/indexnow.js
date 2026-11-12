// IndexNow: tell participating search engines (Bing, and through it the
// assistants that search with Bing's index) that a page really changed.
//
// A crawler revisits this site every few days at best, so a page whose state
// just flipped — a burn ban lifted, a warning issued — would sit wrong in an
// index until the next visit. IndexNow is the one way to say "fetch this now".
// Google does not take part; for Google the accurate <lastmod> in
// /sitemap.xml is the only lever.
//
// The rule that keeps this honest and useful: submit a page only when its
// STATE changed, never because its numbers moved. Weather, fishing and
// traffic change every tick and are never submitted.
//
// The key is public by design: the protocol proves ownership by serving it at
// /<key>.txt, which the router does.

import { SITE } from "./config.js";
import { esPath } from "./i18n.js";
import { PAGES } from "./registry.js";

export const INDEXNOW_KEY = "72a0e4671cc205122a446b7c49b06bff";
export const INDEXNOW_KEY_PATH = `/${INDEXNOW_KEY}.txt`;
export const INDEXNOW_STATE_KV_KEY = "indexnow_state";
// Tried in order. The shared endpoint throttled the Worker's first submission
// with a 429 (Workers share egress addresses with every other Worker), so
// Bing's own endpoint — which takes the same request — is the fallback.
const ENDPOINTS = ["https://api.indexnow.org/indexnow", "https://www.bing.com/indexnow"];
const RETRY_AFTER_MS = 60 * 60 * 1000;
const MAX_TRIES = 6;

// A signal is a short string that changes exactly when a page's state does.
// `status` is the cron's status record, whose per-feed hash already moves
// only when that feed's content changes; `seen` is what this tick fetched.
const SIGNALS = {
  burnban: { pages: ["/burn-ban"], of: (status) => status?.feeds?.burnban?.hash },
  pollen: { pages: ["/pollen"], of: (status) => status?.feeds?.pollen?.hash },
  news: { pages: ["/news"], of: (status) => status?.feeds?.news?.hash },
  calendar: { pages: ["/calendar"], of: (status) => status?.feeds?.calendar?.hash },
  // Which alerts are active, not their text or expiry.
  alerts: { pages: ["/alerts"], of: (_, seen) => (seen.weather ? (seen.weather.alerts || []).map((a) => a.id).sort().join("|") || "none" : undefined) },
  // Each gauge's flood category, not its level.
  water: { pages: ["/water"], of: (_, seen) => (seen.water ? seen.water.gauges.map((g) => `${g.lid}:${g.category}`).sort().join("|") : undefined) },
  // Which storms and watched areas exist, not the outlook's issue time.
  tropics: { pages: ["/tropics"], of: (_, seen) => (seen.tropics ? [...(seen.tropics.storms || []).map((s) => s.id), ...(seen.tropics.disturbances || []).map((d) => d.id || d.area)].sort().join("|") || "none" : undefined) },
};

const bothLanguages = (paths) => paths.flatMap((p) => [SITE + p, SITE + esPath(p)]);

// Compare this tick's signals with the stored ones and submit what changed.
// The first run has nothing to compare with, so it submits every page once —
// which also proves, on /api/health, that the Worker can reach the endpoint.
// Returns the outcome it stored, or null when nothing was due.
export async function indexNowTick(env, status, seen, nowIso = new Date().toISOString()) {
  if (!env?.WEATHER) return null;
  const state = (await env.WEATHER.get(INDEXNOW_STATE_KV_KEY, "json").catch(() => null)) || null;
  const signals = { ...(state?.signals || {}) };
  const changed = [];
  for (const [name, def] of Object.entries(SIGNALS)) {
    const value = def.of(status, seen);
    if (value === undefined || value === null) continue; // not observed this tick
    if (signals[name] !== undefined && signals[name] !== value) changed.push(name);
    signals[name] = value;
  }
  const first = !state;
  // A submission that failed is retried hourly, a bounded number of times,
  // with whatever has changed since folded in.
  const pending = state?.pending;
  const retryDue = pending && pending.tries < MAX_TRIES && Date.parse(nowIso) - Date.parse(state.last?.at ?? 0) >= RETRY_AFTER_MS;
  if (!first && !changed.length && !retryDue) {
    return null;
  }

  const fresh = first ? bothLanguages(PAGES.map((p) => p.path)) : bothLanguages(changed.flatMap((n) => SIGNALS[n].pages));
  const urls = [...new Set([...(pending?.urls || []), ...fresh])];
  const why = [...new Set([...(pending ? [pending.why] : []), ...(first ? ["first run"] : changed)])].join(", ");
  const last = { at: nowIso, ok: false, status: null, urls: urls.length, why };
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ host: new URL(SITE).host, key: INDEXNOW_KEY, keyLocation: SITE + INDEXNOW_KEY_PATH, urlList: urls }),
      });
      last.status = res.status;
      last.endpoint = new URL(endpoint).host;
      delete last.error;
      // 200 accepted; 202 accepted, key check pending.
      if (res.status === 200 || res.status === 202) {
        last.ok = true;
        break;
      }
    } catch (e) {
      last.error = (e && e.message) || String(e);
    }
  }
  // Signals are stored whatever happened, so a change is noticed once; the
  // URLs of a failed submission wait in `pending` for the hourly retry.
  const next = { signals, last };
  if (!last.ok) next.pending = { urls, why, tries: (pending?.tries || 0) + 1 };
  await env.WEATHER.put(INDEXNOW_STATE_KV_KEY, JSON.stringify(next));
  return last;
}
