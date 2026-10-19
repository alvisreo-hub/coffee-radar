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
Results are uncurated community data. At most 100 locations and 20 distinct
websites are processed per run. Website enrichment checks robots.txt and records
failures instead of inventing metadata. JavaScript-rendered pages are not rendered.

CSV snapshots are also available as downloadable workflow artifacts for 90 days.
A failed location-discovery run exits with an error and preserves the previous
CSV files. Individual business-website failures remain visible in their CSV rows.
The live app's catalog is not automatically replaced by these uncurated records.

© OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright).
