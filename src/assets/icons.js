// App icons and the web app manifest.
//
// The icons are real PNG files in public/, served through Workers static assets
// (the ASSETS binding in wrangler.jsonc) and drawn by scripts/build-icons.mjs,
// which is where the art lives. None of them is an SVG: iOS Add to Home Screen
// cannot use one and shows a letter tile instead, and Chrome's WebAPK install
// wants raster 192 and 512 icons. The 180px touch icon is also inlined into
// every page as a data URI (src/assets/apple-touch-icon.js, generated).

// Paths the router hands to env.ASSETS. scripts/test-icons.mjs asserts this is
// exactly the set of files in public/.
export const ICON_ASSET_PATHS = new Set([
  "/favicon.ico",
  "/favicon-32.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/og-image.png",
  "/notification-badge.png",
]);

// Older iOS probes this name by convention; it gets the same file.
export const ICON_ALIASES = { "/apple-touch-icon-precomposed.png": "/apple-touch-icon.png" };

// Absolute og:image. A 512px opaque square (the full-bleed icon), so link
// previews and the iOS share sheet show the app icon rather than a blank card.
export const OG_IMAGE = { path: "/og-image.png", width: 512, height: 512, type: "image/png" };

// Web app manifest (/manifest.json) — makes the site installable and names
// the PWA. `display: standalone` so an installed copy opens app-like; colors
// match the brand navy and BASE_CSS light background.
//
// Icons: PNG `any` at 192 and 512 (Chrome's install criteria name both sizes),
// plus a SEPARATE maskable icon. A combined "any maskable" entry makes platforms
// show the maskable art, padded for its safe zone, where they want an `any`
// icon; the maskable one is full-bleed navy with the art inside the safe zone.
export const MANIFEST = {
  name: "Crosby News — Crosby, TX Weather",
  short_name: "Crosby News",
  description: "Live weather, alerts, water levels, local news, and school events for Crosby, Texas.",
  id: "/",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#eef2f6",
  theme_color: "#0b3d61",
  lang: "en-US",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};
