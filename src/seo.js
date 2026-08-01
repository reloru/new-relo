// Structured data and link-preview tags shared by every page.

import { LAT, LON, SITE } from "./config.js";

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

// Invariant Open Graph / Twitter tags every page repeats. og:url is per-page
// (it mirrors <link rel="canonical">). No og:image — that would need a binary
// asset, which the "no static assets" rule forbids; cards still render the
// title, description, and site name.
export const OG_COMMON = `<meta property="og:site_name" content="Crosby News">
<meta name="twitter:card" content="summary">`;
