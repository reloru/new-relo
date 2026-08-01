// Inline assets, served byte-for-byte. Kept in their own module and moved
// verbatim: these are template literals holding client-side JS and CSS, and
// their escape sequences (\\uXXXX, \\n) are meaningful to the *shipped* string,
// not to this file. Reformatting them silently ships broken client code that
// `node --check` cannot see. Edit the content, never the framing.

// Homepage inline script (15-min auto-refresh + WebMCP tool registration). Kept
// as one constant so its Content-Security-Policy hash can be derived from the
// exact bytes that ship — the same can't-drift trick used for the SKILL.md
// digest. Editing this string automatically changes the CSP hash to match.
export const HOME_SCRIPT = `
// Auto-refresh the page every 15 minutes to keep the forecast current.
// (Done in JS rather than a meta-refresh http-equiv tag, which search engines
// flag.) Only reloads a foreground tab, so a background tab isn't thrashed.
setTimeout(function () {
  if (document.visibilityState === "visible") location.reload();
  else document.addEventListener("visibilitychange", function once() {
    if (document.visibilityState === "visible") { document.removeEventListener("visibilitychange", once); location.reload(); }
  });
}, 900000);

// Offline resilience: register the service worker (storm-time cache of the
// hub + alerts — see SW_SCRIPT). Progressive enhancement: rejected/absent
// registration is silently ignored.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(function () {});
}

// WebMCP: expose Crosby weather as in-browser agent tools. Progressive
// enhancement — a no-op in browsers without navigator.modelContext.
(function () {
  var mc = navigator.modelContext;
  if (!mc) return;
  async function weather() { return (await fetch("/api/weather")).json(); }
  var tools = [
    {
      name: "get_crosby_forecast",
      description: "Current conditions and forecast for Crosby, TX.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async function () {
        var w = await weather(), c = w.current;
        var text = c ? "Crosby, TX: " + c.temperature + "°" + c.temperatureUnit + ", " + c.shortForecast : "unavailable";
        return { content: [{ type: "text", text: text }] };
      },
    },
    {
      name: "get_crosby_alerts",
      description: "Active NWS weather alerts for Crosby, TX.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async function () {
        var w = await weather();
        var text = (w.alerts && w.alerts.length) ? w.alerts.map(function (a) { return a.event; }).join(", ") : "No active weather alerts.";
        return { content: [{ type: "text", text: text }] };
      },
    },
  ];
  try {
    if (typeof mc.provideContext === "function") mc.provideContext({ tools: tools });
    else if (typeof mc.registerTool === "function") tools.forEach(function (t) { mc.registerTool(t); });
  } catch (e) {}
})();
`;

// Admin nuke wiring for /news (only injected when the request carried a valid
// ?admin=<secret>). Each button POSTs the article link + the secret (read from
// the URL) to /api/news/delete or /restore; on success it flips the row's
// blocked state in place. Language-agnostic bytes (labels via data-*), so one
// CSP hash serves both languages, like PUSH_CLIENT_SCRIPT.
export const NEWS_ADMIN_SCRIPT = `
(function () {
  var key = new URLSearchParams(location.search).get("admin");
  if (!key) return;
  document.querySelectorAll(".news-admin-btn").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var li = btn.closest(".news-item");
      var action = btn.getAttribute("data-action");
      btn.disabled = true;
      try {
        var r = await fetch("/api/news/" + action, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ link: btn.getAttribute("data-link"), key: key }),
        });
        if (r.ok) {
          var blocked = action === "delete";
          if (li) li.classList.toggle("news-blocked", blocked);
          btn.setAttribute("data-action", blocked ? "restore" : "delete");
          btn.innerHTML = blocked ? "\\u21a9 " + btn.getAttribute("data-restore") : "\\uD83D\\uDDD1 " + btn.getAttribute("data-hide");
        } else {
          alert("Action failed (" + r.status + ")");
        }
      } catch (e) {
        alert("Network error");
      }
      btn.disabled = false;
    });
  });
})();
`;

// Severe-alert push opt-in (the /alerts page). One constant so its CSP hash is
// derived from the exact bytes shipped (like HOME_SCRIPT). Language-agnostic:
// all user-facing strings are read from data-* attributes on the container, so
// the same bytes (one hash) serve both languages. Progressive enhancement —
// the container stays hidden unless the browser supports push AND the server
// returns a VAPID key.
export const PUSH_CLIENT_SCRIPT = `
(function () {
  var el = document.getElementById("push-optin");
  if (!el) return;
  var d = el.dataset;
  var descEl = el.querySelector(".push-desc");
  var btn = el.querySelector(".push-btn");
  var statusEl = el.querySelector(".push-status");
  var vapidKey = null, reg = null;

  // iOS Safari exposes Push ONLY to Home-Screen web apps. In a plain Safari
  // tab, don't hide the feature's existence - show how to get it instead.
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !navigator.standalone && d.ios) {
      descEl.textContent = d.ios;
      if (btn) btn.hidden = true;
      el.hidden = false;
    }
    return;
  }

  function toBytes(s) {
    // base64url -> Uint8Array. Pad to a multiple of 4 (same loop as the
    // Worker-side decoder - a slicker closed-form version shipped broken once).
    while (s.length % 4) s += "=";
    var b = s.replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(b), arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  function setState(subbed) {
    descEl.textContent = subbed ? d.on : d.off;
    btn.textContent = subbed ? d.unsub : d.sub;
    btn.setAttribute("aria-pressed", subbed ? "true" : "false");
    btn.dataset.subbed = subbed ? "1" : "";
  }

  async function init() {
    try { vapidKey = (await (await fetch("/api/push/vapid-key")).json()).key; } catch (e) {}
    if (!vapidKey) return;
    try { await navigator.serviceWorker.register("/sw.js"); reg = await navigator.serviceWorker.ready; } catch (e) { return; }
    var sub = null;
    try { sub = await reg.pushManager.getSubscription(); } catch (e) {}
    setState(!!sub);
    el.hidden = false;
  }

  btn && btn.addEventListener("click", async function () {
    btn.disabled = true; statusEl.textContent = "";
    try {
      if (btn.dataset.subbed) {
        var sub = await reg.pushManager.getSubscription();
        if (sub) {
          try { await fetch("/api/push/unsubscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }); } catch (e) {}
          await sub.unsubscribe();
        }
        setState(false);
      } else {
        // Permission FIRST: Safari only honors the prompt while the tap's
        // transient activation is alive, so no other awaits may come before it.
        var perm = await Notification.requestPermission();
        if (perm !== "granted") { statusEl.textContent = d.blocked; btn.disabled = false; return; }
        var newSub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(vapidKey) });
        var r = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(newSub) });
        if (!r.ok) throw new Error("subscribe failed");
        setState(true);
      }
    } catch (e) { statusEl.textContent = d.error; }
    btn.disabled = false;
  });

  init();
})();
`;
