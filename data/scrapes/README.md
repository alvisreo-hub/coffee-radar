# Coffee location CSV files

The **Scrape coffee locations** workflow runs every **Monday at 08:00 WIB**
(`01:00 UTC`), on manual dispatch, and after changes to the scraper/workflow.
GitHub may queue scheduled runs later than the nominal time.

Successful runs commit:

- `coffee-in-bandung-YYYYMMDDTHHMMSSZ.csv`: timestamped snapshot (UTC filename).
- `latest.csv`: the most recent successful dataset.

CSV files are UTF-8 with a BOM, CRLF line endings, and properly escaped cells.
Untrusted text that could be interpreted as a spreadsheet formula is prefixed
with an apostrophe. Missing facts stay empty. Each row includes the query,
coordinates, address, business website and phone if listed, opening-hours text,
source URL, geographic scope, retrieval time, and web scraping outcome.

Discovery uses OpenStreetMap cafes and coffee shops in Bandung's administrative
area. If the administrative-area query fails or returns no results, a Bandung bounding box is
used and every row states that it may include neighboring areas. The keyword is
mapped to these location categories; this is not a Google search-results scrape.
Results are uncurated community data. All matching source locations are saved without a result cap, including unnamed cafes. Every identified location is checked for website and Instagram links using map tags, business website links, and web search. Search and website caches avoid duplicate requests. Website enrichment checks robots.txt and records
failures instead of inventing metadata. JavaScript-rendered pages are not rendered.

CSV snapshots are also available as downloadable workflow artifacts for 90 days.
A failed location-discovery run exits with an error and preserves the previous
CSV files. Individual business-website failures remain visible in their CSV rows.
The website automatically loads every valid row from `latest.csv`, combines it with editorial selections, and marks the imported locations as uncurated. Weekly CSV commits become visible without redeploying; the website caches successful CSV reads for ten minutes.

© OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright).


Contact fields include `instagram_url`, evidence URLs and confidence for both
Instagram and website matches, lookup status/error, checked time, query, and
alternative candidates. Found links are not guaranteed to be official: mapped,
website-linked, editorial, search-match, and candidate evidence remain distinct
in the CSV and website. The workflow preserves saved links on lookup errors.
Missing names have `insufficient_identity`; provider blocks or timeouts are
recorded explicitly. No location is removed for a failed contact lookup.

Public-web reference evidence is stored in `../contact-references.json` and reused
by the scheduled scraper. `web_reference` and `brand_reference` distinguish public
references and shared brand contacts. Branch-specific accounts without a matching
address remain candidates. `link_reference_note` explains the distinction or a
reviewed identity correction. Profile links do not prove current account ownership.
