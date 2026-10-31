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

- Six editorial Bandung selections, enriched with every valid location in the latest saved CSV. Each record retains source provenance, coordinates, and its retrieval time.
- Search by place, neighborhood, menu, or tag; filter by neighborhood and recommendation type; alphabetical and review-count sorting.
- Editorial exploration of taste, location-based suggestions, signature-menu references, and popularity based only on available review counts. These are separate from sales data. No sales ranking is fabricated.
- Detail dialog, Google Maps directions, social-profile links, sharing, and a responsive OpenStreetMap view.
- Favorites and crawl activity persist **only in the current browser**. The CSV-backed catalog is shared across devices. Export JSON or download the CSV for a portable snapshot; personal favorites do not synchronize across devices.
- `POST /api/crawl`: fetches four allowlisted public source pages, checking robots.txt first, and extracts bounded title/description metadata. Each outcome has provenance, a timestamp, and an individual success/failure status. It does not infer menu prices, sentiment, or sales from metadata.
- `GET /api/catalog`: merges all latest CSV locations with editorial selections. `GET /api/catalog.csv` downloads the full CSV. `POST /api/discover` returns this same shared catalog without a result cap. CSV records show automatic data curation separately from human editorial selections.
- `POST /api/google`: calls Google Places Text Search when a server-side secret is configured. Results are displayed as a source log and do not silently replace curated listings.

## Google Places and social media

Set `GOOGLE_PLACES_API_KEY` as a secret in the production hosting runtime, then redeploy. Enable Places API (New) and the required billing/API permissions in your Google Cloud account. Never place a key in the HTML or tracked configuration. Without this key, the application reports Google Places as unconnected.

Instagram profile links are discovered from map contact tags, business websites, editorial references, and web search results, then stored in the CSV with evidence and confidence. Instagram and TikTok content APIs remain unconnected: this collects public profile links, not private posts, engagement analytics, or sales data.

Public-web requests follow same-domain HTTPS redirects only, have time and body-size limits, and respect wildcard/specific robots.txt rules. Web metadata and OSM discovery responses may be cached for six hours by the production Worker Cache API. The UI logs actual attempts. Public APIs and websites can block or rate-limit requests; a failed fetch is reported without inventing successful results. A weekly location-to-CSV crawler is configured in GitHub Actions (see below).

## Data and assets

All six initial records cite their source in the app and JSON export. Hours, facilities, prices, current operating status, and precise coordinates have not been independently verified. Initial map coordinates are approximate. The Two Hands Full listing refers to the roastery contact address; confirm dine-in service before visiting.

The rating and approximate review count for Kopi Toko Djawa are attributed to Citour, not a direct live Google fetch. Other initial places have no invented rating or review count. Menu suggestions and taste recommendations are editorial references, not direct tasting results.

OpenStreetMap data is © OpenStreetMap contributors, available under ODbL; attribution is retained via the embedded map, source links, and export provenance. Catalog photography comes from the cited business or review source. Each photograph has a credit, source link, caption, and branch scope. Shops without a matching photograph show an explicit empty state. DM Sans and Manrope fonts are bundled under the SIL Open Font License, with licenses included.

## Checks

`npm test` covers catalog provenance, JavaScript parsing, missing provider configuration, origin validation, invalid input, robots precedence and patterns, HTML metadata parsing, OSM normalization, crawler refusal and success, and provider transformation. Browser interaction checks cover search, favorites, persistence, details, filters, map records, provider status, desktop and mobile layouts, and JavaScript exceptions. Live Google/social ingestion cannot be verified without provider credentials.

The bundled photography was generated specifically for the application as generic atmospheric illustration. It is visibly labeled as illustration; it is not evidence about any business. All essential photographs and Latin fonts are served locally by the Worker, so the UI does not rely on external font/photo CDNs. The OpenStreetMap embed still needs internet access.

## Scheduled location scraping → CSV

The repository workflow [Scrape coffee locations](.github/workflows/scrape-locations.yml)
runs **every Monday at 08:00 WIB / 01:00 UTC**, and can also run manually from
**Actions → Scrape coffee locations → Run workflow**. Changes to the scraper or
workflow trigger a first run immediately. GitHub schedules are best effort and
may start late; public-repository schedules can be disabled after 60 days without
repository activity ([GitHub schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)).

Default keyword: **coffee in Bandung**. No API key, npm install, or paid search
service is required. The keyword maps to cafe/coffee-shop categories in Bandung
on OpenStreetMap; this does not scrape Google's search UI or social media.
All available locations returned by OpenStreetMap are collected without a result cap. Public business websites are checked for title, description, and Instagram links, with robots.txt, request timeouts, bounded
response sizes, public-address validation, and sequential requests.

```sh
npm run scrape:locations
npm run scrape:locations -- --keyword "coffee in Bandung"
```

Run this function from another Node script:

```js
import { runScrape } from './scripts/scrape-locations.mjs';
const result = await runScrape({
  keyword: 'coffee in Bandung',
  outputDir: 'data/scrapes',
});
console.log(result.snapshot, result.latest, result.rowCount);
```

Successful runs write dated CSVs and `data/scrapes/latest.csv`, commit them to
`main`, and upload downloadable CSV artifacts retained for 90 days. Existing CSVs
are preserved if discovery fails or returns no valid records. Individual website
failures are recorded per row. The workflow uses the repository's automatic
`GITHUB_TOKEN` with `contents: write`; no personal token is saved in the code.
If branch protection prevents bot pushes, the run will retain the uploaded CSV
artifact and report the commit/push failure. Actions must be enabled for this repo.

CSV columns include name, address, coordinates, website, phone, opening-hours
text, source URL, geographic scope, scrape timestamp, and website scraping status.
See [CSV storage notes](data/scrapes/README.md) for provenance, escaping, and the geographic fallback. All CSV locations are included in the live catalog and marked as community data. Editorial notes and ratings are preserved when a nearby matching location is merged. Different branches remain separate.

### CSV-backed catalog updates

The build embeds the full `data/scrapes/latest.csv` as a last-known-good snapshot.
The deployed Worker also reads the public repository's latest CSV, caches a
successful read for ten minutes, and exposes the full catalog at `/api/catalog`.
The browser refreshes it on page load and every ten minutes while visible, so the
Monday CSV commit updates the site without redeployment. Failed, malformed, or
empty CSV replacements leave the bundled or previously loaded catalog available.
A source/status timestamp is visible in the catalog. Invalid source IDs or
coordinates are rejected; unnamed valid OSM records remain as unnamed cafes.

All CSV rows are considered; there is no location slicing in discovery, catalog
import, API responses, search, map lists, or CSV download. The scheduled contact discovery visits every identified location, with cached search queries, three workers, and rate-limited search requests. Website failures never remove a location from the CSV.
OpenStreetMap is a community dataset and may omit real businesses or misclassify
cafes. “All available” means all matching records returned by that source, not an
assertion that every operating coffee shop in Bandung has been independently found.

Bandung's administrative boundary uses OSM relation
[13290062](https://www.openstreetmap.org/relation/13290062), also linked by
[Wikidata](https://www.wikidata.org/wiki/Q10389). If that boundary query cannot
complete, the wider fallback box is explicitly recorded in every row.

## Per-shop website and Instagram enrichment

The existing Monday 08:00 WIB workflow now includes contact discovery before it
writes CSV files. No extra schedule is created. Each identified shop is checked
for OSM `contact:instagram`/`instagram` and `website`/`contact:website` tags;
business websites are inspected for matching Instagram profile links; missing
links are looked up using the shop name, neighborhood, and Bandung context.
Unnamed cafes are preserved with `insufficient_identity` rather than guessed links.

Search defaults to Bing's public RSS search feed. Optionally configure a
`BRAVE_SEARCH_API_KEY` repository Actions secret to use Brave Search's supported
API instead. The code never stores that key in the CSV, source, or build. A search
provider returning 403 or 429 is paused for that run, with per-row failure status;
there is no CAPTCHA bypass or proxy rotation. Weekly runs retry unresolved rows.
Existing contact data survives network failures. Positive matches checked within
six days are reused, and identical search queries/websites are cached within a run.

New CSV columns: `instagram_url`, `instagram_source_url`, `instagram_confidence`,
`website_source_url`, `website_confidence`, `link_lookup_status`,
`link_lookup_error`, `link_checked_at`, `link_search_query`, `link_candidates_json`.
Website metadata columns remain present. Discovery uses `mapped`,
`editorial_reference`, `website_link`, `search_match`, and `candidate`, `directory_reference`, `web_reference`, and `brand_reference` evidence
labels. A search result is not proof of account ownership: the UI visibly labels
search matches and candidates as needing confirmation, links to evidence, and
shows the last check time. Directory pages are never labeled as official business websites; matching listings can supply attributed Instagram or website references. Links to Instagram posts, reels, login pages, lookalike domains, or
non-web schemes are rejected.

The website detail panel displays these contact links and their sources,
including alternative candidates and unresolved lookup states. It receives CSV
updates through the existing shared catalog refresh without redeploying.


Initial enrichment also uses targeted public-web research saved in
`data/contact-references.json`. These references are keyed by OSM object ID and
business name, retain their evidence URL, and are reapplied by the same scheduled
scraper. Brand contacts are labeled as shared brand accounts/sites; uncertain
branch matches remain candidates. Explicit identity corrections retain displaced
links as candidates rather than silently discarding their provenance. The
initial CSV includes contact references for 196 of 490 locations: 190 listings
have Instagram URLs and 86 have websites (counts overlap and include brand-level
links). Missing or uncertain contacts remain visible as such.

## CSV data curation

The Monday 08:00 WIB workflow runs location discovery and contact enrichment,
then **curates every row**, then uploads and commits the resulting CSVs. Run
`npm run curate:locations` to reassess the saved CSV without making internet requests.
The raw scrape snapshot is retained; `latest.csv` and an additional
`coffee-in-bandung-curated-<UTC timestamp>.csv` contain the assessment.

Curation adds source-backed facility/contact tags, an Indonesian summary, review
flags, potential duplicate IDs, a rules version, and a separate curation time.
`curation_completeness_pct` measures six available facts: name, coordinates,
address, hours, phone, and a website or Instagram link. It is not a quality score.
Unknown facts remain unknown. Named locations within 50 metres with the same
normalized name are flagged as possible duplicates; they are retained for review.
Distant same-name branches remain separate. Unnamed locations, invalid source
identity, uncertain contact matches, and geographic fallback records need review.
Missing addresses, hours, and contacts are also shown as information gaps.

The initial assessment covers all 490 saved rows: 446 listed, 44 needing review.
All remain in the CSV. The website displays the assessment, information gaps,
and completeness in each shop detail, with Wi-Fi, outdoor, contact-link, and
review filters. Human editorial recommendations remain distinct; the curation
rules do not infer taste, sales rankings, current opening status, or ownership
of profile links. Historical snapshots retain the data as originally collected.


## Actual shop photographs

`npm run photos:locations` examines all saved CSV rows without a location cap.
The Monday 08:00 WIB workflow now runs location discovery and contact lookup,
then photo lookup, then curation, then uploads/commits the CSV. On source pushes,
it reuses saved locations and refreshes photo evidence/curation without repeating
location discovery. Manual and scheduled runs refresh discovery as before.

Photo lookup uses saved human-matched references in `data/photo-references.json`,
business websites and linked review pages, then public web search for missing
photos. It requires a dedicated matching business page, excludes listicle covers,
logos, avatars and thumbnails, checks image content type/size and public network
addresses, and respects the same robots rules as website enrichment. Instagram
or Google private/provider endpoints are not scraped; no API key is needed for
public review/website photos. Source blocks are recorded, not bypassed.

Photo fields: `photo_url`, `photo_source_url`, `photo_credit`, `photo_caption`,
`photo_scope` (`branch` or `business`), `photo_status`, `photo_license`,
`photo_checked_at`, `photo_lookup_error`, and `photo_candidates_json`.
Photos and contacts survive later discovery runs and transient network failures.
The 21-day cache avoids unnecessary downloads. Explicit different-branch photos
are excluded from reviewed primary references; unconfirmed branch photos visibly
say that they show the business and need branch confirmation. Historical dates
remain in captions. Attribution does not imply a public-domain license.

The hero, cards and detail panels render actual sourced images with lazy loading,
source links and credits. Image failures keep the source link and display a clear
empty state. No generated illustration or stock cafe is substituted. Photos are
loaded directly from their source hosts; those hosts can change or block them.
The existing fixed-height clipped detail banner remains in place.

Use `npm run photos:locations -- --references-only` to apply the reviewed references
without external requests. It retains all existing CSV fields and original scrape
times, adds a dated photo-enriched snapshot, and atomically replaces `latest.csv`.
The next curation step writes the final curated snapshot. The live catalog loads
photo updates from the same shared CSV without requiring a redeploy.

## Expanded discovery and social recommendations

The weekly pipeline now searches 14 Bandung neighborhoods across public web and
indexed TikTok recommendations (28 queries), after map/contact discovery and before
photo lookup and curation. Search uses the existing Bing RSS / optional Brave
provider and records failures in `data/scrapes/discovery-status.json`. All returned
hits are considered; provider result availability still bounds coverage.
Dedicated business pages with explicit CafeOrCoffeeShop structured data and a
Bandung address can enter the catalog. Human-reviewed dated article references
also enter; coordinates stay missing until sourced, so those places are omitted
from map markers while remaining searchable in the catalog.

Unresolved search hits are retained in `discovery-candidates.csv`, visible under
Sumber & kurasi. TikTok Notes / Lemon8 is labeled separately from TikTok. Direct
robots/login blocks are not bypassed. Unknown post dates remain unknown; crawl
recency is never treated as publication recency. A mention or a publisher's
“viral” wording is not a measured viral score. No engagement counts are invented.
`web-locations.csv` preserves promoted venues across subsequent OSM refreshes.
The initial expansion adds ten address-sourced coffee venues from Nibble's June
and August 2026 guides and four social discovery leads needing address review.

## Experimental TikTokApi trial

A bounded manual trial uses `davidteather/TikTok-Api` (PyPI TikTokApi 7.3.3)
and Playwright 1.64.1. This is not enabled in the weekly production pipeline.
It tries the public hashtags `coffeeshopbandung`, `cafebandung`, and
`kopibandung`, up to five videos each, with a 100-second overall timeout.
No account login, residential proxy rotation, CAPTCHA solving or session-token
input is configured. The inherited environment proxy is preserved.

```sh
python3 -m venv work/tiktok-venv
work/tiktok-venv/bin/pip install -r scripts/requirements-tiktok.txt
# Install the Playwright Chromium browser if there is no system Chromium.
work/tiktok-venv/bin/python -m playwright install chromium
work/tiktok-venv/bin/python scripts/tiktok-trial.py
# For a preinstalled system Chromium:
work/tiktok-venv/bin/python scripts/tiktok-trial.py --browser /usr/bin/chromium
python3 -m unittest discover -s scripts -p test_tiktok_trial.py -v
```

Each run writes its own CSV and status JSON under `data/tiktok-trial/`; failed
runs never erase the existing catalog or earlier successful exports. Videos
retain source links, published dates and only metrics actually returned by the
provider; unknown metrics stay empty. A video is only a discovery lead, pending
shop identity/address review. Hashtag sampling is not exhaustive discovery and
does not establish a viral ranking.

The 31 October 2026 trial installed and invoked the library but stopped during
landing-page navigation with `net::ERR_TUNNEL_CONNECTION_FAILED`. The managed
Cloud Environment's network policy permits package/Git hosts but does not allow
`www.tiktok.com`. Zero videos were returned. This diagnoses environment egress,
not whether TikTok would accept the library after network access is configured.
To continue the live trial, enable the TikTok destination in Cloud Environment
network settings through its normal configuration/approval flow, then rerun.
No cookies or account credentials are needed to resolve this particular block.
