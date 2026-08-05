// Opt-in Web Push for life-threatening warnings only.
//
// Design: the Worker sends an EMPTY VAPID-authenticated wake-up — no encrypted
// payload, which sidesteps the ECDH/HKDF/AES-GCM payload encryption entirely —
// and the service worker composes the notification locally from /api/weather.
// Only an anonymous endpoint + its keys are stored, one KV entry per
// subscription under the `push:` prefix; dead ones are pruned on 404/410.
//
// SEVERE_PUSH_EVENTS is kept in sync BY HAND with PUSH_EVENTS in SW_SCRIPT.
// Changing one means changing both.
//
// pushEndpointAllowed() is an SSRF guard, not a formality: the cron POSTs to
// whatever endpoint was stored, so an arbitrary URL here would be a
// server-side request forgery primitive. Do not relax it to 'any https URL'.

export const PUSH_PREFIX = "push:";
export const PUSH_NOTIFIED_KEY = "push_notified"; // alert IDs already pushed (dedupe)
// Warnings that earn a push — warnings only, never watches/advisories. Kept in
// sync with PUSH_EVENTS in SW_SCRIPT.
export const SEVERE_PUSH_EVENTS = new Set([
  "Tornado Warning",
  "Flash Flood Warning",
  "Hurricane Warning",
  "Hurricane Force Wind Warning",
  "Extreme Wind Warning",
  "Tropical Storm Warning",
]);
// SSRF guard: the cron POSTs to whatever endpoint a subscription stored, so we
// only ever accept real browser push-service hosts. Without this, a crafted
// subscribe body could turn our cron into an SSRF vector.
export const PUSH_HOST_ALLOW = [
  /\.googleapis\.com$/, // FCM (Chrome/Edge/Android)
  /\.push\.apple\.com$/, // Safari/iOS
  /\.notify\.windows\.com$/, // legacy Edge/Windows
  /\.push\.services\.mozilla\.com$/, // Firefox
];
export function pushEndpointAllowed(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOST_ALLOW.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

// Only the encode direction is needed: the JWT and the public key are built
// here, never parsed here. (A decode helper lived alongside this one until the
// 2026-08-01 audit — it was the leftover of a payload-encryption path this
// design deliberately avoids, and nothing ever called it.)
export const bytesToB64url = (bytes) => {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const b64urlJson = (obj) => bytesToB64url(new TextEncoder().encode(JSON.stringify(obj)));

// Build a VAPID Authorization header for a given push endpoint. Signs a short
// ES256 JWT (WebCrypto ECDSA P-256 already yields the raw r||s form JWS wants,
// so no DER unwrapping) with the private JWK secret. Returns null if the
// VAPID secrets aren't configured, so the whole feature no-ops safely.
export async function vapidAuth(endpoint, env) {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return null;
  const { origin } = new URL(endpoint);
  const jwk = JSON.parse(env.VAPID_PRIVATE_KEY);
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64urlJson({ typ: "JWT", alg: "ES256" });
  const payload = b64urlJson({ aud: origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:security@crosbynews.com" });
  const unsigned = `${header}.${payload}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${bytesToB64url(sig)}`;
  return { Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}` };
}

// Send one empty wake-up. 201/202 = accepted; 404/410 = subscription gone
// (caller prunes). Returns the HTTP status (or 0 on network error).
export async function sendPush(subscription, env) {
  const headers = await vapidAuth(subscription.endpoint, env);
  if (!headers) return 0;
  try {
    const res = await fetch(subscription.endpoint, {
      method: "POST",
      headers: { ...headers, TTL: "3600", "Content-Length": "0", Urgency: "high" },
    });
    return res.status;
  } catch (e) {
    console.error("push send failed:", e && e.message);
    return 0;
  }
}

// A stable KV key for a subscription (hash of its endpoint), so re-subscribing
// the same browser overwrites rather than duplicates.
export async function pushKeyFor(endpoint) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return PUSH_PREFIX + [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Cron hook: if any NEW severe warning is active (not already notified), wake
// every subscriber once, then remember the alert IDs so ongoing warnings don't
// re-notify every 15 minutes. Prunes dead subscriptions and stale notified IDs.
export async function pushSevereAlerts(env, alerts) {
  if (!env.VAPID_PRIVATE_KEY) return; // feature not configured
  const severe = (alerts ?? []).filter((a) => SEVERE_PUSH_EVENTS.has(a.event));
  const activeIds = severe.map((a) => a.id).filter(Boolean);
  let notified = [];
  try {
    notified = (await env.WEATHER.get(PUSH_NOTIFIED_KEY, "json")) || [];
  } catch {}
  const fresh = activeIds.filter((id) => !notified.includes(id));
  // Always reconcile the notified set to only-currently-active IDs (so an alert
  // that clears and later reissues under a new ID can notify again).
  const nextNotified = activeIds.slice();
  if (JSON.stringify(nextNotified.sort()) !== JSON.stringify([...notified].sort())) {
    await env.WEATHER.put(PUSH_NOTIFIED_KEY, JSON.stringify(nextNotified));
  }
  if (!fresh.length) return; // nothing new to announce

  const list = await env.WEATHER.list({ prefix: PUSH_PREFIX });
  for (const k of list.keys) {
    let sub = null;
    try {
      sub = await env.WEATHER.get(k.name, "json");
    } catch {}
    if (!sub || !sub.endpoint) {
      await env.WEATHER.delete(k.name);
      continue;
    }
    const status = await sendPush(sub, env);
    if (status === 404 || status === 410) await env.WEATHER.delete(k.name); // gone — prune
  }
}
