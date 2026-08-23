// /api/health — three facts, and nothing else.
//
//   1. Is the site live?           Reaching this response is the answer.
//   2. When did each feed last     From the `cron_status` KV key, written at
//      TRY to fetch new data,      the end of every cron tick.
//      and did it work?
//   3. When did the data being     Also from `cron_status`: the cron
//      shown on the page           fingerprints every cached entry each tick
//      actually CHANGE?            and stamps the moment a fingerprint moves.
//
// (2) and (3) are different questions, and the gap between them is where this
// site's real failure mode lives. /pollen served the same count for three
// business days in Aug 2026 while every refresh succeeded and rewrote the KV
// entry on schedule: the fetch was fine, the write was fine, and the content
// never moved. Anything that judges a feed by when it was last WRITTEN calls
// that healthy. `dataChangedAt` is the number that does not.
//
// This endpoint reads exactly one KV key and never touches an upstream, so
// polling it is cheap and cannot turn a monitor's interval into an upstream
// request rate.
//
// It always answers 200. Whether the data is fresh ENOUGH is a judgment that
// depends on who is asking; the timestamps are reported and the caller decides.
//
// Every timestamp is rendered for a human reading it — US Central, 12-hour, with
// the weekday and the CST/CDT abbreviation ("Friday, Aug 7, 2026, 11:20:35 AM CDT").
// This is a page someone opens to decide whether something looks stuck, and a
// UTC ISO string is the wrong thing to hand them for that. `cron_status` still
// stores ISO internally — the formatting happens on the way out, so the change
// detection below keeps comparing exact instants.

import { KV_KEY } from "../config.js";
import { centralStamp } from "../lib/format.js";
import { CALENDAR_KV_KEY } from "../features/calendar.js";
import { WATER_KV_KEY } from "../features/water.js";
import { FISHING_KV_KEY } from "../features/fishing.js";
import { TROPICS_KV_KEY } from "../features/tropics.js";
import { TRAFFIC_KV_KEY } from "../features/traffic.js";
import { POLLEN_KV_KEY } from "../features/pollen.js";
import { BURNBAN_KV_KEY } from "../features/burnban.js";
import { NEWS_KV_KEY } from "../features/news.js";

// Written by the cron at the end of every tick (see recordCronRun), read here.
export const CRON_STATUS_KV_KEY = "cron_status";

// The feed table: a name and the KV key holding its cached data. That is the
// whole per-feed configuration — /api/health reports one entry per row and the
// cron fingerprints one row per tick.
export const FEEDS = [
  { name: "weather", kvKey: KV_KEY },
  { name: "water", kvKey: WATER_KV_KEY },
  { name: "fishing", kvKey: FISHING_KV_KEY },
  { name: "traffic", kvKey: TRAFFIC_KV_KEY },
  { name: "tropics", kvKey: TROPICS_KV_KEY },
  { name: "pollen", kvKey: POLLEN_KV_KEY },
  { name: "calendar", kvKey: CALENDAR_KV_KEY },
  { name: "burnban", kvKey: BURNBAN_KV_KEY },
  // The one key the cron does not write: Google News blocks Worker IPs, so a
  // Claude routine writes it out-of-band. Nothing records a fetch ATTEMPT for
  // it, so `lastAttempt`/`ok` stay null — but its content is fingerprinted like
  // every other feed's, so `dataChangedAt` is real.
  { name: "news", kvKey: NEWS_KV_KEY },
];

// A cheap content fingerprint (FNV-1a over the JSON) with the entry's own
// `updated` write-stamp removed — the entire point is that re-storing identical
// content must NOT read as a change. Deliberately not a cryptographic hash and
// it does not need to be: a collision costs one missed change stamp, nothing
// more.
function fingerprint(value) {
  if (!value || typeof value !== "object") return null;
  const { updated, ...content } = value;
  const json = JSON.stringify(content);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

// Elapsed hours since an instant, to one decimal. Paired with every stamp so
// "how long has this been frozen" — the question the stamps exist to answer —
// does not require arithmetic across AM/PM, and so a monitor can threshold on it
// without parsing a human date.
//
// Computed from the stored ISO instant, never from the rendered stamp, so the
// formatting cannot cost precision. Hours throughout, including when that means
// 121.4: one unit stays comparable across feeds whose cadences differ by two
// orders of magnitude. null in, null out.
function hoursSince(iso, now) {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? Math.round((now - t) / 360000) / 10 : null;
}

// The whole report. Returns {httpStatus, body} so the route stays a thin
// serializer and this stays testable without a Request.
export async function healthReport(env) {
  // One instant for the whole report: every elapsed figure below is relative to
  // the same moment, so they can be compared against each other.
  const now = Date.now();
  // Sits directly above `feeds` because it is a legend for what follows. A
  // large hoursSinceChange reads as alarming and usually isn't: the fingerprint
  // tracks whether the CONTENT moved, so a feed with nothing new to report
  // correctly sits still. Without this, judging the number needs the endpoint
  // doc open alongside it — which is one lookup too many for a page whose whole
  // point is being scannable.
  const body = {
    site: "live",
    checkedAt: centralStamp(new Date(now).toISOString()),
    cronLastRun: null,
    hoursSinceCronRun: null,
    note: "hoursSinceChange is when the content last changed, not whether it is current. A feed with nothing new to report (no active storms, no weekend pollen count) correctly sits still — judge it against how often that feed's data really changes, not against hoursSinceAttempt.",
    feeds: {},
  };

  let cron = null;
  if (!env?.WEATHER) {
    body.error = "WEATHER KV binding is missing — no refresh record is reachable";
  } else {
    try {
      cron = await env.WEATHER.get(CRON_STATUS_KV_KEY, "json");
    } catch (e) {
      body.error = `could not read ${CRON_STATUS_KV_KEY}: ${(e && e.message) || e}`;
    }
  }

  body.cronLastRun = centralStamp(cron?.at);
  // Well past 0.25 means the cron itself has stopped — a failure no per-feed
  // field would show, since they would all just sit still together.
  body.hoursSinceCronRun = hoursSince(cron?.at, now);

  for (const feed of FEEDS) {
    const rec = cron?.feeds?.[feed.name] || {};
    body.feeds[feed.name] = {
      // The last time a fetch was ATTEMPTED — not the last tick. A throttled
      // feed that was not due records nothing, so this keeps pointing at the
      // real attempt instead of being bumped by a tick that did nothing.
      lastAttempt: centralStamp(rec.at),
      hoursSinceAttempt: hoursSince(rec.at, now),
      ok: typeof rec.ok === "boolean" ? rec.ok : null,
      ...(rec.error ? { error: rec.error } : {}),
      // When the CONTENT last moved, which is not when it was last written.
      // Read against hoursSinceAttempt: refreshing while this climbs is the
      // frozen-feed signature.
      dataChangedAt: centralStamp(rec.changedAt),
      hoursSinceChange: hoursSince(rec.changedAt, now),
    };
  }

  return { httpStatus: 200, body };
}

// --- cron side -------------------------------------------------------------

// Build a recorder the cron threads through its refreshes. Kept here, next to
// the reader, so the record's shape has exactly one definition.
//
// Only real attempts are recorded. A throttled feed that was not due this tick
// records NOTHING, and recordCronRun carries its previous attempt forward —
// "last time it tried" must not be reset by a tick where it did not try.
export function cronRunRecorder() {
  const attempts = {};
  return {
    ok: (name) => { attempts[name] = { at: new Date().toISOString(), ok: true }; },
    failed: (name, err) => { attempts[name] = { at: new Date().toISOString(), ok: false, error: (err && err.message) || String(err) }; },
    attempts: () => attempts,
  };
}

// Persist the run: this tick's attempts merged over the previous record, plus a
// content fingerprint per feed so the next tick can tell a real change from a
// rewrite of identical data.
//
// Own try/catch and last in the tick: health reporting must never be able to
// break the refresh it reports on.
export async function recordCronRun(env, recorder) {
  try {
    const at = new Date().toISOString();
    const prev = (await env.WEATHER.get(CRON_STATUS_KV_KEY, "json"))?.feeds || {};
    const attempts = recorder.attempts();
    const feeds = {};

    await Promise.all(
      FEEDS.map(async (feed) => {
        const was = prev[feed.name] || {};
        // No attempt this tick (throttled, or written out-of-band) keeps the
        // previous one rather than blanking it or implying a success.
        const attempt = attempts[feed.name] || {
          at: was.at ?? null,
          ok: typeof was.ok === "boolean" ? was.ok : null,
          ...(was.error ? { error: was.error } : {}),
        };

        // Fingerprint whatever is in KV right now, regardless of who put it
        // there — that is what makes this work for the routine-owned `news` key
        // as well as the seven the cron writes.
        let value = null;
        try {
          value = await env.WEATHER.get(feed.kvKey, "json");
        } catch {
          value = null; // unreadable or corrupt: leave the last change stamp alone
        }
        const hash = fingerprint(value);
        const changed = hash != null && hash !== was.hash;

        feeds[feed.name] = {
          ...attempt,
          // Prefer the entry's own write stamp over the tick time: it is when
          // the changed content actually landed, which for an out-of-band key
          // can be up to a tick earlier than we noticed. On the very first run
          // there is no prior fingerprint, so this seeds from the same stamp
          // and becomes exact from the next change onward.
          changedAt: changed ? (value.updated ?? at) : (was.changedAt ?? null),
          hash,
        };
      }),
    );

    await env.WEATHER.put(CRON_STATUS_KV_KEY, JSON.stringify({ at, feeds }));
  } catch (e) {
    console.error("cron status write failed:", e && e.stack);
  }
}
