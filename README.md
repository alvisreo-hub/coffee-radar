# Coffee Radar — Bandung

A responsive Indonesian-language web application to discover coffee shops, inspect editorial recommendations and their sources, save a device-local collection, view a map, and retrieve public internet data.

## Run

Node.js 22 or newer. No application dependencies are needed.

```sh
npm run build
npm test
npm run dev
```

Open http://127.0.0.1:4173. The deployable Cloudflare Worker is `dist/server/index.js`, with hosting configuration in `dist/.openai/hosting.json`. The source is in `work/index.html`, `work/backend.js`, and `work/seed.json`; the assembly script embeds those and all local visual assets into `worker/index.js`.

## Included behavior

- Six initially researched Bandung listings with citations and a review date of 19 October 2026.
- Search by place, neighborhood, menu, or tag; filter by neighborhood and recommendation type; alphabetical and review-count sorting.
- Editorial exploration of taste, location-based suggestions, signature-menu references, and popularity based only on available review counts. These are separate from sales data. No sales ranking is fabricated.
- Detail dialog, Google Maps directions, social-profile links, sharing, and a responsive OpenStreetMap view.
- Favorites, imports, and crawl activity persist **only in the current browser**. Export JSON for a portable snapshot. No shared database or cross-device account synchronization is implemented.
- `POST /api/crawl`: fetches four allowlisted public source pages, checking robots.txt first, and extracts bounded title/description metadata. Each outcome has provenance, a timestamp, and an individual success/failure status. It does not infer menu prices, sentiment, or sales from metadata.
- `POST /api/discover`: queries the public Overpass API for cafes in an initial Bandung bounding box; imports up to 60 records with coordinates and community-data provenance. The box may include neighboring administrative areas. New records remain explicitly uncurated.
- `POST /api/google`: calls Google Places Text Search when a server-side secret is configured. Results are displayed as a source log and do not silently replace curated listings.

## Google Places and social media

Set `GOOGLE_PLACES_API_KEY` as a secret in the production hosting runtime, then redeploy. Enable Places API (New) and the required billing/API permissions in your Google Cloud account. Never place a key in the HTML or tracked configuration. Without this key, the application reports Google Places as unconnected.

Instagram and TikTok **are not connected**. Instagram links are ordinary links, not API access. Live social ingestion requires supported provider APIs, access tokens, account scopes, and an implemented authorized ingestion pipeline. No social crawling or sales-volume collection is claimed.

Public-web requests follow same-domain HTTPS redirects only, have time and body-size limits, and respect wildcard/specific robots.txt rules. Web metadata and OSM discovery responses may be cached for six hours by the production Worker Cache API. The UI logs actual attempts. Public APIs and websites can block or rate-limit requests; a failed fetch is reported without inventing successful results. No scheduled crawler is installed.

## Data and assets

All six initial records cite their source in the app and JSON export. Hours, facilities, prices, current operating status, and precise coordinates have not been independently verified. Initial map coordinates are approximate. The Two Hands Full listing refers to the roastery contact address; confirm dine-in service before visiting.

The rating and approximate review count for Kopi Toko Djawa are attributed to Citour, not a direct live Google fetch. Other initial places have no invented rating or review count. Menu suggestions and taste recommendations are editorial references, not direct tasting results.

OpenStreetMap data is © OpenStreetMap contributors, available under ODbL; attribution is retained via the embedded map, source links, and export provenance. Generic cafe photography is illustrative and does not depict the listed businesses. DM Sans and Manrope fonts are bundled under the SIL Open Font License, with licenses included.

## Checks

`npm test` covers catalog provenance, JavaScript parsing, missing provider configuration, origin validation, invalid input, robots precedence and patterns, HTML metadata parsing, OSM normalization, crawler refusal and success, and provider transformation. Browser interaction checks cover search, favorites, persistence, details, filters, map records, provider status, desktop and mobile layouts, and JavaScript exceptions. Live Google/social ingestion cannot be verified without provider credentials.

The bundled photography was generated specifically for the application as generic atmospheric illustration. It is visibly labeled as illustration; it is not evidence about any business. All essential photographs and Latin fonts are served locally by the Worker, so the UI does not rely on external font/photo CDNs. The OpenStreetMap embed still needs internet access.
