// The */15 cron. Each refresh gets its OWN try/catch so one failing upstream
// never blocks the others, and every fetcher throws rather than writing a
// partial snapshot — so an outage keeps the last good data instead of wiping
// it. News is NOT refreshed here: Google News blocks Worker IPs, so that key
// is written out-of-band by scripts/fetch-news.mjs.
//
// Cadences differ on purpose: weather/water/fishing/traffic every tick (they
// move fast), tropics ~1h June-November (Atlantic hurricane season) and ~24h
// the rest of the year, pollen only on weekdays until that day's count
// has posted and at most hourly (HHD publishes one count per weekday — polling
// more often buys nothing, and on a day it publishes none the hourly floor is
// the only thing that ends the retry), calendar ~24h (Crosby ISD's calendar
// changes rarely), and
// burnban ~4h (TFS updates roughly daily, not on a schedule, but a status
// change during fire-weather conditions is worth catching sooner than half a
// day out).
//
// Every branch that actually FETCHES records its outcome through the recorder,
// written once at the end to the `cron_status` key — the only place
// /api/health can learn when each feed last tried and whether it worked. A
// throttled feed that was not due records nothing at all, so its previous
// attempt is carried forward: "last time it tried" must not be reset by a tick
// where it did not try. recordCronRun() also fingerprints every cached entry
// there, which is what lets /api/health report when the data on the page
// actually changed rather than when it was last rewritten.

import { KV_KEY, TZ } from "./config.js";
import { fetchWeather } from "./features/weather.js";
import { fetchCalendar, CALENDAR_KV_KEY } from "./features/calendar.js";
import { fetchWaterFull, WATER_KV_KEY } from "./features/water.js";
import { fetchFishing, FISHING_KV_KEY } from "./features/fishing.js";
import { fetchTropics, TROPICS_KV_KEY } from "./features/tropics.js";
import { fetchTraffic, TRAFFIC_KV_KEY } from "./features/traffic.js";
import { fetchPollen, POLLEN_KV_KEY } from "./features/pollen.js";
import { fetchBurnBan, burnbanHistory, BURNBAN_KV_KEY } from "./features/burnban.js";
import { ctDateStr, carryUvToday } from "./features/air.js";
import { pushSevereAlerts } from "./push.js";
import { cronRunRecorder, recordCronRun } from "./api/health.js";
import { mcpRollUp } from "./mcp/metrics.js";
import { pruneHits } from "./metrics.js";
import { recordAlerts, recordAqi, recordGauges, recordGaugeHistory, hasGaugeHistory, recordPollen, recordBurnBan } from "./record.js";

export async function scheduled(event, env, ctx) {
    // Refresh the weather cache. News is NOT fetched here — it's written to the
    // KV "news" key out-of-band by scripts/fetch-news.mjs (a Claude routine),
    // because Google News blocks Worker IPs. The Worker only renders that key.
    const run = cronRunRecorder();
    // What this tick observed, kept for the record written at the end.
    const seen = {};
    try {
      const data = await fetchWeather(env);
      // EPA's UV product drops today's daytime hours at its ~7 PM rollover;
      // keep them from the previous snapshot so "peak today" lasts until
      // midnight. A failed read only loses the carry, never the refresh.
      const prev = await env.WEATHER.get(KV_KEY, "json").catch(() => null);
      // AQI and UV ride inside the weather fetch and come back null when their
      // upstream fails, so they need their own health rows to be seen. Judged on
      // the fresh fetch, before the UV carry-over can fill in yesterday's rows.
      const airOk = data.aqi != null;
      const uvOk = data.uv != null;
      data.uv = carryUvToday(data.uv, prev?.uv);
      await env.WEATHER.put(KV_KEY, JSON.stringify(data));
      seen.weather = data;
      run.ok("weather");
      if (airOk) run.ok("air");
      else run.failed("air", "AQI fetch returned nothing (AirNow and Open-Meteo both failed; see Worker logs)");
      if (uvOk) run.ok("uv");
      else run.failed("uv", "EPA UV fetch returned nothing (see Worker logs)");
      // After a fresh forecast, wake push subscribers for any NEW severe
      // warning. Independent of the writes below; a push failure is logged and
      // never blocks the cache refresh (own try/catch inside).
      try {
        await pushSevereAlerts(env, data.alerts);
      } catch (e) {
        console.error("Cron push dispatch failed:", e && e.stack);
      }
    } catch (e) {
      console.error("Cron weather refresh failed:", e && e.stack);
      run.failed("weather", e);
      // AQI and UV are fetched inside the same call, so they were not stored either.
      run.failed("air", e);
      run.failed("uv", e);
    }
    // Refresh the Crosby ISD school calendar at most ~every 24h — it changes
    // rarely (a handful of new events a month, not per day) and the Worker CAN
    // reach crosbyisd.org. This is NOT how same-day closure announcements would
    // reach users: those aren't published to this calendar feed at all, so
    // there's nothing here for a tighter cadence to catch sooner. Independent
    // try/catch so a calendar hiccup never affects the weather refresh above.
    try {
      const cur = await env.WEATHER.get(CALENDAR_KV_KEY, "json");
      const age = cur?.updated ? Date.now() - new Date(cur.updated).getTime() : Infinity;
      if (!cur || !Array.isArray(cur.events) || age > 24 * 3600 * 1000) {
        await env.WEATHER.put(CALENDAR_KV_KEY, JSON.stringify(await fetchCalendar()));
        run.ok("calendar");
      }
    } catch (e) {
      console.error("Cron calendar refresh failed:", e && e.stack);
      run.failed("calendar", e);
    }
    // Refresh river/bayou levels every tick (levels move fast in a flood).
    // fetchWater() throws on a total NWPS outage, so we skip the write and the
    // last good snapshot survives. Independent try/catch from the above.
    try {
      const { snapshot, history } = await fetchWaterFull();
      await env.WEATHER.put(WATER_KV_KEY, JSON.stringify(snapshot));
      seen.water = snapshot;
      seen.waterHistory = history;
      run.ok("water");
    } catch (e) {
      console.error("Cron water refresh failed:", e && e.stack);
      run.failed("water", e);
    }
    // Refresh fishing conditions every tick (USGS continuous data posts ~every
    // 15-30 min). fetchFishing() throws on a total USGS outage, so a hiccup
    // keeps the last snapshot. Independent try/catch from the above.
    try {
      await env.WEATHER.put(FISHING_KV_KEY, JSON.stringify(await fetchFishing(env)));
      run.ok("fishing");
    } catch (e) {
      console.error("Cron fishing refresh failed:", e && e.stack);
      run.failed("fishing", e);
    }
    // Refresh the Atlantic tropical outlook at most ~hourly during hurricane
    // season (June-November, Central time, when NHC advisories update every
    // 2-6h) and at most ~daily the rest of the year (NHC issues far fewer
    // outlooks off-season, so hourly polling buys nothing then). Month is
    // read in Central time, not UTC, so a late-night UTC rollover can't flip
    // the season boundary for a Central-time site. fetchTropics() throws on
    // failure, so a transient NHC outage skips the write and the last
    // snapshot survives.
    try {
      const cur = await env.WEATHER.get(TROPICS_KV_KEY, "json");
      const age = cur?.updated ? Date.now() - new Date(cur.updated).getTime() : Infinity;
      const month = new Date().toLocaleDateString("en-US", { timeZone: TZ, month: "short" });
      const inSeason = ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"].includes(month);
      const threshold = inSeason ? 3600 * 1000 : 24 * 3600 * 1000;
      if (!cur || !Array.isArray(cur.storms) || age > threshold) {
        await env.WEATHER.put(TROPICS_KV_KEY, JSON.stringify(await fetchTropics()));
        run.ok("tropics");
      }
    } catch (e) {
      console.error("Cron tropics refresh failed:", e && e.stack);
      run.failed("tropics", e);
    }
    // Refresh Crosby-corridor traffic every tick (TranStar updates the feeds
    // about once a minute; incidents and high-water reports move fast).
    // fetchTraffic() throws only when BOTH feeds fail, so a total TranStar
    // outage skips the write and the last snapshot survives.
    try {
      await env.WEATHER.put(TRAFFIC_KV_KEY, JSON.stringify(await fetchTraffic()));
      run.ok("traffic");
    } catch (e) {
      console.error("Cron traffic refresh failed:", e && e.stack);
      run.failed("traffic", e);
    }
    // Refresh the pollen & mold count on weekday mornings only — HHD publishes
    // exactly one count per weekday, so a flat age threshold is the wrong
    // mechanism (it can't tell "still waiting on today's count" from "already
    // have it"). Skip the block entirely on Sat/Sun (Central time); on
    // weekdays, only fetch if the cached entry's countDate isn't today's date
    // yet. fetchPollen() throws on failure OR an unparseable layout, so the
    // last good count survives.
    //
    // The 1h floor bounds the case that condition can't settle. "Keep asking
    // until countDate is today" self-limits on a normal weekday — it stops the
    // moment the morning count lands — but nothing ended it on a day the count
    // never arrives, so it ran all 96 ticks. That is not hypothetical: HHD
    // doesn't publish on City of Houston holidays (Labor Day, Thanksgiving,
    // Christmas…), and on 2026-09-04 a slug change hid a count that HAD been
    // published, which put the feed in that state every weekday until it was
    // fixed. Each tick costs two requests to a city health department, so the
    // floor is politeness, not correctness — a count still lands within an hour
    // of posting, which is immaterial for a once-a-day number.
    //
    // Deliberately keyed on the last successful WRITE, not the last attempt:
    // the case being bounded is a fetch that SUCCEEDS and re-stores the same
    // countDate (quiet, and persists for days). A throwing upstream writes
    // nothing, so it still retries each tick — that one is loud in /api/health
    // (ok:false with the error) and transient, so it doesn't need a floor.
    try {
      const weekday = new Date().toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" });
      if (weekday !== "Sat" && weekday !== "Sun") {
        const cur = await env.WEATHER.get(POLLEN_KV_KEY, "json");
        const today = ctDateStr(Date.now());
        const sinceWrite = cur?.updated ? Date.now() - new Date(cur.updated).getTime() : Infinity;
        // Written as "is it throttled" rather than "is it old enough" so an
        // unparseable `updated` (NaN) fails OPEN and fetches. The inverted form
        // would compare NaN, get false, and skip forever — a brand-new silent
        // freeze in the throttle added to stop one.
        const throttled = Number.isFinite(sinceWrite) && sinceWrite <= 3600 * 1000;
        if ((!cur || !cur.groups || !cur.countDate || cur.countDate !== today) && !throttled) {
          const fresh = await fetchPollen();
          await env.WEATHER.put(POLLEN_KV_KEY, JSON.stringify(fresh));
          seen.pollen = fresh;
          run.ok("pollen");
        }
      }
    } catch (e) {
      console.error("Cron pollen refresh failed:", e && e.stack);
      run.failed("pollen", e);
    }
    // Refresh the Harris County burn-ban status at most ~every 4h — TFS's feed
    // updates roughly daily (a county judge's order, not a schedule), so a flat
    // 4h gate still doesn't hammer it while catching a change well inside a
    // single day (was 12h; tightened 2026-08-26 so a status flip during active
    // fire weather doesn't sit stale for half a day).
    // fetchBurnBan() throws on failure, an error-shaped body, or an
    // unrecognized status, so a transient TFS outage skips the write and the
    // last good status survives.
    try {
      const cur = await env.WEATHER.get(BURNBAN_KV_KEY, "json");
      const age = cur?.updated ? Date.now() - new Date(cur.updated).getTime() : Infinity;
      if (!cur || (cur.status !== "Yes" && cur.status !== "No") || age > 4 * 3600 * 1000) {
        // burnbanHistory carries the status-history stamps forward off the
        // PREVIOUS entry, so the write has to be built from `cur` — a bare
        // fetchBurnBan() result would reset "since when" on every refresh.
        const fresh = burnbanHistory(cur, await fetchBurnBan());
        await env.WEATHER.put(BURNBAN_KV_KEY, JSON.stringify(fresh));
        seen.burnban = fresh;
        run.ok("burnban");
      }
    } catch (e) {
      console.error("Cron burnban refresh failed:", e && e.stack);
      run.failed("burnban", e);
    }
    // File what this tick observed in the record (src/record.js). After every
    // cache write, so the record can never cost a live page its refresh.
    await recordTick(env, seen, run);

    // Fold the per-isolate MCP counters into the durable record. Its own
    // try/catch, and deliberately NOT a `run` feed: this is not a content feed,
    // and a fake row in /api/health's table would cost that endpoint the
    // honesty it exists for. Its health is reported inside `mcp_metrics.rollup`
    // and surfaced by /api/mcp-usage.
    try {
      await mcpRollUp(env);
    } catch (e) {
      console.error("Cron MCP metrics rollup failed:", e && e.stack);
    }

    // Drop page-request totals past retention. Once a day is plenty, so it
    // runs on the first tick of the 09:00 UTC hour. Not a `run` feed, for the
    // same reason the MCP rollup is not.
    try {
      const now = new Date();
      if (now.getUTCHours() === 9 && now.getUTCMinutes() < 15) await pruneHits(env);
    } catch (e) {
      console.error("Cron site-metrics prune failed:", e && e.stack);
    }

    // Last, so a failure here can never affect the refreshes it describes.
    await recordCronRun(env, run);
}

// Write this tick's observations to D1. Each writer is isolated, so one
// failing table does not stop the others, and the outcome is reported as the
// `record` row on /api/health — with Workers Logs off, that row is the only
// place a failing database would show.
async function recordTick(env, seen, run) {
  if (!env.DB) return;
  const errors = [];
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      errors.push(`${name}: ${(e && e.message) || e}`);
      console.error(`Cron record (${name}) failed:`, e && e.stack);
    }
  };
  const now = new Date();
  const topOfHour = now.getUTCMinutes() < 15;

  if (seen.weather) {
    await step("alerts", () => recordAlerts(env, seen.weather.alerts));
    await step("air quality", () => recordAqi(env, seen.weather));
  }
  if (seen.water) {
    await step("gauges", () => recordGauges(env, seen.water));
    // Crests and impact statements change a few times a decade: once a day,
    // or at once when the tables are still empty.
    await step("gauge history", async () => {
      if ((now.getUTCHours() === 10 && topOfHour) || !(await hasGaugeHistory(env))) await recordGaugeHistory(env, seen.waterHistory);
    });
  }
  // Pollen and the burn ban are fetched only when due, so the cached value is
  // also filed once an hour: that seeds the record after a deploy and keeps a
  // count from being missed when the fetch and the first write straddle one.
  const cached = async (key) => (topOfHour ? env.WEATHER.get(key, "json").catch(() => null) : null);
  await step("pollen", async () => {
    const pollen = seen.pollen || (await cached(POLLEN_KV_KEY));
    if (pollen) await recordPollen(env, pollen);
  });
  await step("burn ban", async () => {
    const ban = seen.burnban || (await cached(BURNBAN_KV_KEY));
    if (ban) await recordBurnBan(env, ban);
  });

  if (errors.length) run.failed("record", new Error(errors.join("; ")));
  else run.ok("record");
}
