// The */15 cron. Each refresh gets its OWN try/catch so one failing upstream
// never blocks the others, and every fetcher throws rather than writing a
// partial snapshot — so an outage keeps the last good data instead of wiping
// it. News is NOT refreshed here: Google News blocks Worker IPs, so that key
// is written out-of-band by scripts/fetch-news.mjs.
//
// Cadences differ on purpose: weather/water/fishing/traffic every tick (they
// move fast), tropics ~1h June-November (Atlantic hurricane season) and ~24h
// the rest of the year, pollen only on weekday mornings once that day's count
// has posted (HHD publishes one count per weekday — polling more often buys
// nothing), calendar ~24h (Crosby ISD's calendar changes rarely), and
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
import { fetchWater, WATER_KV_KEY } from "./features/water.js";
import { fetchFishing, FISHING_KV_KEY } from "./features/fishing.js";
import { fetchTropics, TROPICS_KV_KEY } from "./features/tropics.js";
import { fetchTraffic, TRAFFIC_KV_KEY } from "./features/traffic.js";
import { fetchPollen, POLLEN_KV_KEY } from "./features/pollen.js";
import { fetchBurnBan, burnbanHistory, BURNBAN_KV_KEY } from "./features/burnban.js";
import { ctDateStr } from "./features/air.js";
import { pushSevereAlerts } from "./push.js";
import { cronRunRecorder, recordCronRun } from "./api/health.js";

export async function scheduled(event, env, ctx) {
    // Refresh the weather cache. News is NOT fetched here — it's written to the
    // KV "news" key out-of-band by scripts/fetch-news.mjs (a Claude routine),
    // because Google News blocks Worker IPs. The Worker only renders that key.
    const run = cronRunRecorder();
    try {
      const data = await fetchWeather(env);
      await env.WEATHER.put(KV_KEY, JSON.stringify(data));
      run.ok("weather");
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
      await env.WEATHER.put(WATER_KV_KEY, JSON.stringify(await fetchWater()));
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
    try {
      const weekday = new Date().toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" });
      if (weekday !== "Sat" && weekday !== "Sun") {
        const cur = await env.WEATHER.get(POLLEN_KV_KEY, "json");
        const today = ctDateStr(Date.now());
        if (!cur || !cur.groups || !cur.countDate || cur.countDate !== today) {
          await env.WEATHER.put(POLLEN_KV_KEY, JSON.stringify(await fetchPollen()));
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
        await env.WEATHER.put(BURNBAN_KV_KEY, JSON.stringify(burnbanHistory(cur, await fetchBurnBan())));
        run.ok("burnban");
      }
    } catch (e) {
      console.error("Cron burnban refresh failed:", e && e.stack);
      run.failed("burnban", e);
    }
    // Last, so a failure here can never affect the refreshes it describes.
    await recordCronRun(env, run);
}
