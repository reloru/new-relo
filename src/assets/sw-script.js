// Inline assets, served byte-for-byte. Kept in their own module and moved
// verbatim: these are template literals holding client-side JS and CSS, and
// their escape sequences (\\uXXXX, \\n) are meaningful to the *shipped* string,
// not to this file. Reformatting them silently ships broken client code that
// `node --check` cannot see. Edit the content, never the framing.

// Service worker (/sw.js) — offline resilience for storm time, when Crosby's
// connectivity is at its flakiest exactly when the site matters most. Served
// as a Worker route (no static assets, per the repo rule) with `no-cache` so
// deploys pick up on the next visit. Strategy: precache the storm-critical
// pages at install, then network-first for navigations (always fresh online)
// with the last-good cached copy as the offline fallback. Bump CACHE when
// changing this script's behavior so old caches are swept on activate.
// Registered from HOME_SCRIPT (its CSP hash recomputes automatically).
export const SW_SCRIPT = `// crosbynews.com service worker - offline cache of storm-critical pages
// plus severe-alert Web Push (empty wake-up + local composition).
var CACHE = "crosby-v3";
var PRECACHE = ["/", "/alerts", "/es", "/es/alerts", "/manifest.json", "/favicon.svg"];
// Warning events that earn a push (life-threatening; warnings only, never
// watches/advisories - avoids alert fatigue). Kept in sync with the Worker's
// SEVERE_PUSH_EVENTS.
var PUSH_EVENTS = ["Tornado Warning", "Flash Flood Warning", "Hurricane Warning", "Hurricane Force Wind Warning", "Extreme Wind Warning", "Tropical Storm Warning"];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(PRECACHE); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Navigations: network first so pages are always fresh online; cache the
  // successful copy (query-less URLs only, so variants can't bloat the cache)
  // and fall back to it - or to the language hub - when the network dies.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res.ok && !url.search) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function (err) {
        // ignoreVary: the content pages send "Vary: Accept", and a navigation's
        // Accept header never equals the precache fetch's "*/*" - without it
        // every offline match misses and falls through to the hub.
        return caches.match(req, { ignoreVary: true }).then(function (hit) {
          if (hit) return hit;
          var hub = url.pathname === "/es" || url.pathname.indexOf("/es/") === 0 ? "/es" : "/";
          return caches.match(hub, { ignoreVary: true }).then(function (fb) { if (fb) return fb; throw err; });
        });
      })
    );
    return;
  }

  // Precached assets (favicon, manifest): stale-while-revalidate. Serve the
  // cached copy immediately - still instant, still works offline - but always
  // kick off a background fetch that refreshes it for next time.
  //
  // Plain cache-first was a trap here. The pages in PRECACHE never reach this
  // branch (navigations return above), but /manifest.json and /favicon.svg do,
  // and cache-first has no expiry: an installed PWA would keep the manifest it
  // downloaded at install FOREVER - wrong name, icons, theme colour or
  // start_url - and the only thing that ever cleared it was bumping CACHE.
  // That failure is silent and invisible on a fresh device, so it would only
  // ever be found by the one user who already installed the app.
  if (PRECACHE.indexOf(url.pathname) !== -1) {
    e.respondWith(
      caches.match(req, { ignoreVary: true }).then(function (hit) {
        var fresh = fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        });
        // Offline with nothing cached is the only case that can reject, and
        // respondWith needs that rejection to surface as a normal failure.
        if (!hit) return fresh;
        e.waitUntil(fresh.catch(function () {}));
        return hit;
      })
    );
  }
});

// Severe-alert push. The Worker sends an EMPTY wake-up (no encrypted payload),
// so the SW composes the notification here from live data - it fetches the
// current alerts and shows the active severe warning(s). userVisibleOnly
// requires we always show something, so an expired-by-now race falls back to a
// generic prompt rather than a silent (penalized) push.
self.addEventListener("push", function (e) {
  e.waitUntil(
    fetch("/api/weather", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var alerts = (data && data.alerts) || [];
        var severe = alerts.filter(function (a) { return PUSH_EVENTS.indexOf(a.event) !== -1; });
        if (!severe.length) {
          return self.registration.showNotification("Crosby, TX weather alert", {
            body: "A severe weather alert may be active. Tap for details.",
            icon: "/icon.svg", badge: "/icon.svg", tag: "crosby-alert", data: { url: "/alerts" },
          });
        }
        return Promise.all(severe.map(function (a) {
          return self.registration.showNotification("\\u26A0\\uFE0F " + a.event + " - Crosby, TX", {
            body: a.headline || (a.description ? String(a.description).split("\\n")[0] : "Take shelter and follow official guidance."),
            icon: "/icon.svg", badge: "/icon.svg",
            tag: a.id || a.event, renotify: true, requireInteraction: true,
            data: { url: "/alerts" },
          });
        }));
      })
      .catch(function () {
        return self.registration.showNotification("Crosby, TX weather alert", {
          body: "A severe weather alert may be active. Tap for details.",
          icon: "/icon.svg", badge: "/icon.svg", tag: "crosby-alert", data: { url: "/alerts" },
        });
      })
  );
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || "/alerts";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(target) !== -1 && "focus" in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
`;
