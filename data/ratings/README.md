# Catalog rating research — 12 November 2026

Every current CSV record was inspected, plus six editorial seed records. There
were 494 initial searches, ten unnamed records marked insufficient identity,
and 251 follow-up searches/source-opening checks. All original 498 CSV records
and original cell values were preserved. Editorial rows remain in the separate
rating audit, without inventing new map objects in the location CSV.

## Files

- `../scrapes/latest.csv`: location dataset with new `rating_*` fields.
- `catalog-ratings.csv`: 504 research rows, including six editorial entries.
- `references.json`: factual researched results keyed by source ID, name and address.
- `search-log.csv`: per-record searches and follow-up source URLs/statuses.
- `report.json`: coverage and methodology summary.

## Status and columns

`rating_value`, `rating_scale`, `rating_review_count`, `rating_platform`,
`rating_source_url`, and `rating_source_name` are populated only when the
provided catalog street/address matches the listing. Matching uses the available
street and house number, when supplied; it is not an independent geolocation
verification. Counts and scores belong to the same platform, never averaged.

`rating_candidate_value`, `rating_candidate_review_count`,
`rating_candidate_platform`, `rating_candidate_source_url`, and
`rating_candidate_source_name` expose a business-name match for spreadsheet
review. These can describe a different branch and must not be treated as
confirmed scores. `rating_candidates_json` retains the alternative platform
scores, matching status, factual evidence, source title, reported search-index
age when present, internal conflicts, and whether the source reports closure.
A source reporting closure is a source assertion, not a fresh operating check.

Coverage of the **498 location CSV rows**:

- 25 `address_matched`.
- 270 `needs_branch_review` with candidate scores.
- 193 `not_found`: no sufficiently matching aggregate rating found in these searches.
- 10 `insufficient_identity`: unnamed shops cannot safely be identified.

`rating_checked_at` is the research time. The rating source's own update date
is unknown; indexed results may be old. These are public directory/search-index
references, not a live Google Places fetch. Even a platform labeled Google is
attributed through its cited directory. User opinion, menu-item ratings, academic
tables, irrelevant cities, generic names, and multi-venue ranking pages are excluded.
Missing scores/counts stay empty; zero reviews or a default five-star score is
never filled in for missing data.

`node scripts/apply-ratings.mjs` reapplies cached evidence to matching identities
and addresses. The weekly workflow invokes this after expanded discovery so the
next location refresh does not discard this research. It preserves the original
check date and **does not claim to refresh ratings weekly**. New or changed
identities are marked `not_checked`. `scripts/prepare-ratings.py` is the extraction
utility used against ignored research scratch responses, not a standalone web
search service. Normal operation only needs the committed references JSON.

Validation: five Python extraction tests, two Node CSV/reference tests, plus
an exhaustive comparison of all original CSV cell values before/after enrichment.
