import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateKeyword, buildOverpassQuery, normalizeLocations, discoverLocations,
  scrapeWebsite, enrichLocations, isPublicAddress, csvCell, toCsv, CSV_COLUMNS,
  writeCsvFiles, runScrape,
} from './scrape-locations.mjs';

const now = new Date('2026-10-19T01:00:00.000Z');
const element = (id = 1, tags = {}) => ({ type: 'node', id, lat: -6.9, lon: 107.61,
  tags: { name: 'Kopi, "Énak"', amenity: 'cafe', 'addr:street': 'Jl. Braga', 'addr:housenumber': '81', ...tags } });
const publicLookup = async () => [{ address: '93.184.216.34' }];
const noWait = async () => {};
const html = text => new Response(text, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
const row = tags => normalizeLocations([element(1, tags)], { now })[0];

test('keywords are validated before querying and geographic filters are bounded', () => {
  assert.equal(validateKeyword('coffee in Bandung'), 'coffee in Bandung');
  assert.equal(validateKeyword('kopi di Bandung'), 'kopi di Bandung');
  assert.throws(() => validateKeyword('coffee in Jakarta'), /Bandung/);
  assert.throws(() => validateKeyword('coffee in Bandung;out;'), /Bandung/);
  assert.match(buildOverpassQuery(), /rel\(13290062\);map_to_area/);
  assert.match(buildOverpassQuery({ fallback: true }), /-6\.995,107\.540/);
});

test('normalization deduplicates source IDs, keeps separate branches, coordinates and provenance', () => {
  const elements = [element(1), element(1), element(2), { ...element(3), lat: 100 }, { ...element(4), tags: {} }];
  const rows = normalizeLocations(elements, { now });
  assert.equal(rows.length, 3);
  assert.equal(rows.find(r => r.source_id === 'node/1').address, 'Jl. Braga 81');
  assert.equal(rows.find(r => r.source_id === 'node/1').source_url, 'https://www.openstreetmap.org/node/1');
  assert.equal(rows.find(r => r.source_id === 'node/1').scraped_at_utc, now.toISOString());
  assert.match(rows.find(r => r.source_id === 'node/1').license, /ODbL/);
  assert.equal(rows.find(r => r.source_id === 'node/1').website_scrape_status, 'no_website');
  assert.equal('rating' in rows.find(r => r.source_id === 'node/1'), false);
  assert.ok(rows.some(r => r.name.startsWith('Kafe tanpa nama')));
});

test('discovery sends an uncapped Overpass query and marks bbox fallback', async () => {
  const bodies = [];
  const fetchImpl = async (_url, options) => {
    bodies.push(String(options.body));
    return Response.json({ elements: bodies.length === 1 ? [] : [element(1), element(2)] });
  };
  const rows = await discoverLocations({ now, fetchImpl, wait: noWait });
  assert.equal(bodies.length, 2);
  assert.equal(rows.length, 2);
  assert.match(rows[0].geographic_scope, /neighboring/);
  assert.match(decodeURIComponent(bodies[0]), /amenity/);
});

test('upstream query errors and invalid or empty payloads never count as success', async () => {
  for (const payload of [{ remark: 'runtime error', elements: [] }, {}, { elements: [] }]) {
    await assert.rejects(discoverLocations({ fetchImpl: async () => Response.json(payload), wait: noWait }), /failed|No valid/);
  }
});

test('provider failure uses the second documented endpoint', async () => {
  const urls = [];
  const rows = await discoverLocations({ now, wait: noWait, fetchImpl: async url => {
    urls.push(url);
    return urls.length === 1 ? new Response('busy', { status: 503 }) : Response.json({ elements: [element()] });
  } });
  assert.equal(rows.length, 1);
  assert.equal(urls[1], 'https://overpass.private.coffee/api/interpreter');
});

test('website scraping checks robots before extracting bounded HTML metadata', async () => {
  const visited = [];
  const result = await scrapeWebsite('https://example.com/', { lookupImpl: publicLookup, wait: noWait,
    fetchImpl: async url => { visited.push(url); return url.endsWith('/robots.txt') ? new Response('User-agent: *\nAllow: /') : html('<title>Coffee &amp; Bandung</title><meta name="description" content="Fresh coffee">'); } });
  assert.equal(visited[0], 'https://example.com/robots.txt');
  assert.equal(result.website_title, 'Coffee & Bandung');
  assert.equal(result.website_description, 'Fresh coffee');
  assert.equal(result.website_scrape_status, 'ok');
});

test('robots disallow and inaccessible robots prevent the page request', async () => {
  for (const robots of [new Response('User-agent: *\nDisallow: /'), new Response('Unavailable', { status: 503 })]) {
    let calls = 0;
    const result = await scrapeWebsite('https://example.com/', { lookupImpl: publicLookup, wait: noWait,
      fetchImpl: async () => { calls++; return robots; } });
    assert.equal(calls, 1);
    assert.notEqual(result.website_scrape_status, 'ok');
    assert.match(result.website_error, /robots.txt/);
  }
});

test('robots 404 allows a page while non-HTML, overlarge content and long delays are recorded', async () => {
  const fetchImpl = async url => url.endsWith('/robots.txt') ? new Response('', { status: 404 }) : html('<title>Open</title>');
  assert.equal((await scrapeWebsite('https://example.com/', { fetchImpl, lookupImpl: publicLookup, wait: noWait })).website_title, 'Open');
  const result = await scrapeWebsite('https://example.com/', { lookupImpl: publicLookup, wait: noWait,
    fetchImpl: async () => new Response('User-agent: *\nCrawl-delay: 30') });
  assert.equal(result.website_scrape_status, 'crawl_delay_exceeds_budget');
  const large = await scrapeWebsite('https://example.com/', { lookupImpl: publicLookup, wait: noWait,
    fetchImpl: async url => url.endsWith('/robots.txt') ? new Response('User-agent: *\nAllow: /') : html('x'.repeat(1_000_001)) });
  assert.equal(large.website_scrape_status, 'failed');
  assert.match(large.website_error, /size limit/);
});

test('private addresses, credentials, non-web URLs, and mixed DNS responses are rejected before fetch', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.1.1', '192.168.1.1', '169.254.169.254', '::1', 'fc00::1']) assert.equal(isPublicAddress(address), false);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  let calls = 0;
  const fetchImpl = async () => { calls++; throw Error('Should not fetch'); };
  for (const url of ['http://127.0.0.1', 'file:///etc/passwd', 'https://user:pass@example.com', 'https://example.com:8080']) {
    const result = await scrapeWebsite(url, { fetchImpl, lookupImpl: publicLookup });
    assert.equal(result.website_scrape_status, 'failed');
  }
  await scrapeWebsite('https://example.com', { fetchImpl, lookupImpl: async () => [{ address: '8.8.8.8' }, { address: '10.0.0.1' }] });
  assert.equal(calls, 0);
});

test('cross-domain redirects and robots-disallowed redirect targets are not visited', async () => {
  for (const location of ['https://other.example/', '/private']) {
    const visited = [];
    const result = await scrapeWebsite('https://example.com/', { lookupImpl: publicLookup, wait: noWait,
      fetchImpl: async url => { visited.push(url); return url.endsWith('/robots.txt') ? new Response('User-agent: *\nDisallow: /private') : new Response('', { status: 302, headers: { Location: location } }); } });
    assert.equal(result.website_scrape_status, 'failed');
    assert.equal(visited.length, 2);
  }
});

test('per-run enrichment budgets and exact-website caching prevent redundant crawls', async () => {
  const rows = [row({ website: 'https://example.com/' }), row({ website: 'https://example.com/' }), row({ website: 'https://other.example/' })];
  let calls = 0;
  await enrichLocations(rows, { maxWebsites: 1, lookupImpl: publicLookup, wait: noWait,
    fetchImpl: async url => { calls++; return url.endsWith('/robots.txt') ? new Response('User-agent: *\nAllow: /') : html('<title>Cafe</title>'); } });
  assert.equal(calls, 2);
  assert.equal(rows[1].website_title, 'Cafe');
  assert.equal(rows[2].website_scrape_status, 'budget_exceeded');
});

test('CSV escapes quotes, commas, multiline text, formulas and preserves numeric coordinates', () => {
  assert.equal(csvCell('one,"two"\nthree'), '"one,""two""\nthree"');
  assert.equal(csvCell('=HYPERLINK("url")'), '"\'=HYPERLINK(""url"")"');
  assert.equal(csvCell('  @SUM(1)'), "'  @SUM(1)");
  assert.equal(csvCell(-6.9), '-6.9');
  const csv = toCsv([row()]);
  assert.ok(csv.startsWith('\uFEFF' + CSV_COLUMNS.join(',') + '\r\n'));
  assert.ok(csv.includes('"Kopi, ""Énak"""'));
});

test('successful runs persist both an immutable dated CSV and matching latest CSV', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'coffee-csv-'));
  try {
    const result = await runScrape({ now, outputDir, discoverLinks: false, maxWebsites: 0, fetchImpl: async () => Response.json({ elements: [element()] }) });
    assert.equal(result.rowCount, 1);
    assert.match(result.snapshot, /coffee-in-bandung-20261019T010000Z\.csv$/);
    assert.equal(await readFile(result.snapshot, 'utf8'), await readFile(result.latest, 'utf8'));
    assert.equal((await readdir(outputDir)).length, 2);
    await assert.rejects(writeCsvFiles([], { now, outputDir }), /empty/);
  } finally { await rm(outputDir, { recursive: true }); }
});

test('failed discovery preserves the previously stored latest CSV', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'coffee-preserve-'));
  try {
    const latest = join(outputDir, 'latest.csv');
    await writeFile(latest, 'previous successful export');
    await assert.rejects(runScrape({ now, outputDir, wait: noWait, fetchImpl: async () => new Response('busy', { status: 503 }) }), /failed/);
    assert.equal(await readFile(latest, 'utf8'), 'previous successful export');
    assert.deepEqual(await readdir(outputDir), ['latest.csv']);
  } finally { await rm(outputDir, { recursive: true }); }
});

test('workflow schedules Monday at 08:00 WIB and treats keyword inputs as environment data', async () => {
  const workflow = await readFile(new URL('../.github/workflows/scrape-locations.yml', import.meta.url), 'utf8');
  assert.match(workflow, /cron: '0 1 \* \* 1'/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /SCRAPE_KEYWORD: \$\{\{ inputs.keyword/);
  assert.match(workflow, /--keyword "\$SCRAPE_KEYWORD"/);
  assert.match(workflow, /actions\/upload-artifact/);
  assert.match(workflow, /git add data\/scrapes\/\*\.csv/);
});


test('an administrative-query outage falls back to a bounded query and labels every result', async () => {
  const queries = [];
  const rows = await discoverLocations({ now, wait: noWait, fetchImpl: async (_url, options) => {
    const query = new URLSearchParams(options.body).get('data');
    queries.push(query);
    return query.includes('area.bandung') ? new Response('upstream unavailable', { status: 500 }) : Response.json({ elements: [element()] });
  } });
  assert.equal(queries.length, 3);
  assert.equal(rows.length, 1);
  assert.match(rows[0].geographic_scope, /bounding box/);
});


test('discovery returns every provider location beyond the previous 100 and 1000 caps', async () => {
  const elements = Array.from({ length: 1205 }, (_, index) => element(index + 1));
  const rows = await discoverLocations({ now, fetchImpl: async () => Response.json({ elements }) });
  assert.equal(rows.length, 1205);
  assert.equal(new Set(rows.map(r => r.source_id)).size, 1205);
  assert.ok(!buildOverpassQuery().match(/;\s*out\b[^;]*\d+/));
});
