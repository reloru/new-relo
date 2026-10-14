// Structured data and the head tags shared by every page.

import { LAT, LON, SITE } from "./config.js";
import { OG_IMAGE } from "./assets/icons.js";
import { APPLE_TOUCH_ICON_DATA_URI } from "./assets/apple-touch-icon.js";

// Sitewide structured data (schema.org JSON-LD): the site's identity + publisher.
// Static, so it's built once at module load; it's a non-executable data block, so
// CSP `script-src` doesn't apply (no hash needed). Pages can add a page-specific
// node (e.g. AboutPage) alongside it. Kept honest — no invented schema for the
// forecast (there's no truthful schema.org type for it) and no fake ratings/FAQ.
export const ORG_ID = SITE + "/#org";
export const WEBSITE_ID = SITE + "/#website";
export const JSONLD_SITE = `<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": ORG_ID,
      name: "crosbynews.com",
      alternateName: "Crosby News",
      url: SITE + "/",
      description: "Independent live weather and local news for Crosby, Texas.",
      email: "contact@crosbynews.com",
      sameAs: ["https://github.com/reloru/new-relo"],
    },
    {
      "@type": "WebSite",
      "@id": WEBSITE_ID,
      url: SITE + "/",
      name: "crosbynews.com",
      description: "Live weather and local news for Crosby, Texas — fast, ad-free, no trackers.",
      inLanguage: "en-US",
      publisher: { "@id": ORG_ID },
    },
  ],
})}</script>`;

// schema.org Dataset describing the public weather API — emitted on /developers
// (both languages; the API itself is English-only and language-neutral) so
// dataset search engines (e.g. Google Dataset Search) can discover it. Honest:
// unlike forecast markup, a Dataset is a truthful schema type for what the API
// actually is. Static, so built once at module load, like JSONLD_SITE.
export const JSONLD_DATASET = `<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Dataset",
  "@id": SITE + "/#weather-dataset",
  name: "Crosby, TX weather — current conditions, forecast, and alerts",
  description:
    "Current conditions, hourly forecast, 7-day forecast, and active National Weather Service alerts for Crosby, Texas (northeast Harris County), refreshed every 15 minutes from the U.S. National Weather Service (api.weather.gov). Free public JSON API, no authentication.",
  url: SITE + "/developers",
  isAccessibleForFree: true,
  license: "https://www.weather.gov/disclaimer",
  creator: { "@id": ORG_ID },
  spatialCoverage: {
    "@type": "Place",
    name: "Crosby, TX",
    geo: { "@type": "GeoCoordinates", latitude: LAT, longitude: LON },
  },
  distribution: [
    { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: SITE + "/api/weather" },
  ],
})}</script>`;

// The head tags every page shares: viewport, theme-color, the site-wide Open
// Graph / Twitter tags, the icons and the manifest. Per-page tags (charset,
// title, description, og:title/description/type/url, canonical, hreflang,
// JSON-LD) stay in each page; charset in particular must stay first in <head>.
//
// Icons: no SVG anywhere, because iOS Add to Home Screen falls back to a letter
// tile when the only icons it finds are SVG. The 180px touch icon is inlined as
// a data URI so iOS has it with no further fetch, on every page.
//
// `manifest: false` is for the /news?admin= view: with a manifest linked, iOS
// pins the manifest's start_url (/) instead of the admin URL. It keeps every
// other tag, the touch icon included.
//
// scripts/test-icons.mjs renders every page in both languages and checks this
// block is present exactly once and that its icon URLs resolve.
export function sharedHead(lang, { manifest = true } = {}) {
  const alt = lang === "es"
    ? "Ícono de Crosby News: un sol detrás de una nube sobre azul marino"
    : "Crosby News app icon: a sun behind a cloud on navy blue";
  return `<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b3d61">
<meta property="og:site_name" content="Crosby News">
<meta property="og:image" content="${SITE}${OG_IMAGE.path}">
<meta property="og:image:type" content="${OG_IMAGE.type}">
<meta property="og:image:width" content="${OG_IMAGE.width}">
<meta property="og:image:height" content="${OG_IMAGE.height}">
<meta property="og:image:alt" content="${alt}">
<meta name="twitter:card" content="summary">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
<link rel="apple-touch-icon" sizes="180x180" href="${APPLE_TOUCH_ICON_DATA_URI}">${manifest ? `
<link rel="manifest" href="/manifest.json">` : ""}`;
}
