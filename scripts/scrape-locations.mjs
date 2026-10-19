import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { metadata, robotsAllows } from '../worker/index.js';

export const DEFAULT_KEYWORD = 'coffee in Bandung';
export const CSV_COLUMNS = [
  'keyword', 'name', 'address', 'latitude', 'longitude', 'website', 'phone',
  'opening_hours', 'neighborhood', 'city', 'internet_access', 'outdoor_seating', 'wheelchair', 'source', 'source_id', 'source_url', 'geographic_scope',
  'website_title', 'website_description', 'website_scrape_status', 'website_error',
  'scraped_at_utc', 'license',
];
const USER_AGENT = 'CoffeeRadar/1.0 (+https://github.com/alvisreo-hub/coffee-radar)';
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function validateKeyword(keyword) {
  if (typeof keyword !== 'string' || !/^(?:coffee(?: shops?)?|caf[eé]s?|kopi|kafe)\s+(?:in|di)\s+Bandung$/i.test(keyword.trim())) {
    throw new Error('This scraper currently supports coffee locations in Bandung, for example "coffee in Bandung".');
  }
  return keyword.trim();
}

// Bandung's OSM boundary relation is linked from https://www.wikidata.org/wiki/Q10389.
// Resolving a known relation avoids the expensive global administrative-name scan.
export function buildOverpassQuery({ fallback = false } = {}) {
  const scope = fallback ? '(-6.995,107.540,-6.825,107.775)' : '(area.bandung)';
  return '[out:json][timeout:90];' + (fallback ? '' :
    'rel(13290062);map_to_area->.bandung;') +
    '(nwr["amenity"="cafe"]' + scope + ';nwr["shop"="coffee"]' + scope +
    ';nwr["cuisine"="coffee_shop"]' + scope + ';);out center tags;';
}

export async function readBounded(response, maxBytes = 1_000_000) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error('Response exceeds the configured size limit.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

async function overpass(query, { fetchImpl = fetch, wait = sleep, onProgress = () => {} } = {}) {
  const errors = [];
  for (let i = 0; i < ENDPOINTS.length; i++) {
    try {
      onProgress('Querying ' + new URL(ENDPOINTS[i]).hostname);
      const response = await fetchImpl(ENDPOINTS[i], {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(105_000),
      });
      if (!response.ok) {
        const detail = (await readBounded(response, 32_000)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
        throw new Error('Overpass returned HTTP ' + response.status + (detail ? ': ' + detail : '.'));
      }
      const data = JSON.parse(await readBounded(response, 64_000_000));
      if (data.remark) throw new Error('Overpass did not complete the query: ' + data.remark);
      if (!Array.isArray(data.elements)) throw new Error('Overpass returned an invalid locations response.');
      return data.elements;
    } catch (error) {
      errors.push(new URL(ENDPOINTS[i]).hostname + ': ' + error.message);
      onProgress(errors.at(-1));
      if (i < ENDPOINTS.length - 1) await wait(2000);
    }
  }
  throw new Error('Location discovery failed: ' + errors.join('; '));
}

export function normalizeLocations(elements, { keyword = DEFAULT_KEYWORD, now = new Date(), geographicScope = 'Bandung administrative boundary' } = {}) {
  const unique = new Map();
  for (const element of elements) {
    const tags = element.tags || {};
    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;
    if (!['node', 'way', 'relation'].includes(element.type) || !Number.isSafeInteger(element.id) ||
        !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) continue;
    const id = element.type + '/' + element.id;
    unique.set(id, {
      keyword,
      name: typeof tags.name === 'string' && tags.name.trim() ? tags.name.trim() : 'Kafe tanpa nama · ' + id,
      address: tags['addr:full'] || [
        [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' '),
        tags['addr:suburb'], tags['addr:city'], tags['addr:postcode'],
      ].filter(Boolean).join(', '),
      latitude, longitude,
      website: tags.website || tags['contact:website'] || '',
      phone: tags.phone || tags['contact:phone'] || '',
      opening_hours: tags.opening_hours || '',
      neighborhood: tags['addr:suburb'] || tags['addr:district'] || '',
      city: tags['addr:city'] || '',
      internet_access: tags.internet_access || '',
      outdoor_seating: tags.outdoor_seating || '',
      wheelchair: tags.wheelchair || '',
      source: 'OpenStreetMap', source_id: id,
      source_url: 'https://www.openstreetmap.org/' + id,
      geographic_scope: geographicScope,
      website_title: '', website_description: '',
      website_scrape_status: tags.website || tags['contact:website'] ? 'not_requested' : 'no_website',
      website_error: '', scraped_at_utc: now.toISOString(),
      license: 'ODbL 1.0 — © OpenStreetMap contributors',
    });
  }
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'id') || a.source_id.localeCompare(b.source_id));
}

export async function discoverLocations({ keyword = DEFAULT_KEYWORD, now = new Date(), ...options } = {}) {
  validateKeyword(keyword);
  let elements;
  let areaError;
  let geographicScope = 'Bandung administrative boundary';
  try { elements = await overpass(buildOverpassQuery(), options); }
  catch (error) { areaError = error; elements = []; }
  if (!elements.length) {
    options.onProgress?.('Administrative query unavailable or empty; trying the bounded Bandung query.');
    try { elements = await overpass(buildOverpassQuery({ fallback: true }), options); }
    catch (error) { throw new Error((areaError ? areaError.message + ' | Bounding-box fallback: ' : '') + error.message); }
    geographicScope = 'Bandung bounding box; may include neighboring areas';
  }
  const rows = normalizeLocations(elements, { keyword: keyword.trim(), now, geographicScope });
  options.onProgress?.('Discovered ' + rows.length + ' locations.');
  if (!rows.length) throw new Error('No valid coffee locations were returned; existing CSV files have been preserved.');
  return rows;
}

// Only public destinations on ordinary web ports may be scraped from provider records.
export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
      a === 192 && [0, 168].includes(b) || a === 100 && b >= 64 && b <= 127 ||
      a === 198 && [18, 19, 51].includes(b) || a === 203 && b === 0);
  }
  if (isIP(address) === 6) return /^[23]/i.test(address) && !/^2001:db8:/i.test(address);
  return false;
}

async function publicUrl(value, lookupImpl = lookup) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.port && !['80', '443'].includes(url.port)) throw new Error('Unsupported website URL.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookupImpl(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('Website does not resolve exclusively to public addresses.');
  return url;
}

async function websiteRequest(value, { fetchImpl = fetch, lookupImpl = lookup, timeout = 12_000, canFetch } = {}) {
  let url = await publicUrl(value, lookupImpl);
  const initialHost = url.hostname.replace(/^www\./, '');
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetchImpl(url.href, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain;q=0.9' },
      redirect: 'manual', signal: AbortSignal.timeout(timeout),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('Website redirect is missing a destination.');
    const next = await publicUrl(new URL(location, url).href, lookupImpl);
    if (next.hostname.replace(/^www\./, '') !== initialHost || url.protocol === 'https:' && next.protocol !== 'https:') {
      throw new Error('Cross-domain redirects and HTTPS downgrades are not followed.');
    }
    if (canFetch && !canFetch(next)) throw new Error('robots.txt disallows the redirected page.');
    url = next;
  }
  throw new Error('Website redirected too many times.');
}

export async function scrapeWebsite(value, options = {}) {
  try {
    const url = await publicUrl(value, options.lookupImpl);
    if (/(^|\.)(instagram|facebook|tiktok)\.com$/i.test(url.hostname)) {
      return { website_scrape_status: 'requires_provider_api', website_error: 'Social media ingestion is not configured.' };
    }
    let robotsText = '';
    const robotsResponse = await websiteRequest(new URL('/robots.txt', url).href, options);
    if (robotsResponse.status !== 404) {
      if (!robotsResponse.ok) throw new Error('robots.txt could not be verified (HTTP ' + robotsResponse.status + ').');
      const robots = await readBounded(robotsResponse, 256_000);
      robotsText = robots;
      if (!robotsAllows(robots, url.pathname + url.search)) {
        return { website_scrape_status: 'robots_disallowed', website_error: 'robots.txt disallows this page.' };
      }
      // Enrichment is deliberately sequential; honor the crawl-delay declared by the site.
      const delays = [...robots.matchAll(/^\s*crawl-delay\s*:\s*([0-9.]+)/gim)].map(m => Number(m[1]));
      const seconds = delays.length ? Math.max(...delays) : 1;
      if (!Number.isFinite(seconds) || seconds > 15) return { website_scrape_status: 'crawl_delay_exceeds_budget', website_error: 'Site requests a crawl delay greater than 15 seconds.' };
      await (options.wait || sleep)(Math.max(1, seconds) * 1000);
    } else { await robotsResponse.body?.cancel(); await (options.wait || sleep)(1000); }
    const response = await websiteRequest(url.href, { ...options, canFetch: next => robotsAllows(robotsText, next.pathname + next.search) });
    if (!response.ok) throw new Error('Website returned HTTP ' + response.status + '.');
    if (!(response.headers.get('content-type') || '').toLowerCase().includes('text/html')) {
      await response.body?.cancel();
      return { website_scrape_status: 'not_html', website_error: 'Website does not return HTML.' };
    }
    const details = metadata(await readBounded(response));
    return { website_title: details.title, website_description: details.description, website_scrape_status: 'ok', website_error: '' };
  } catch (error) {
    return { website_scrape_status: 'failed', website_error: error.message };
  }
}

export async function enrichLocations(rows, { maxWebsites = 20, ...options } = {}) {
  if (!Number.isInteger(maxWebsites) || maxWebsites < 0 || maxWebsites > 100) throw new Error('maxWebsites must be between 0 and 100.');
  const cache = new Map();
  for (const row of rows) {
    if (!row.website) continue;
    if (!cache.has(row.website)) {
      if (cache.size >= maxWebsites) { row.website_scrape_status = 'budget_exceeded'; continue; }
      cache.set(row.website, await scrapeWebsite(row.website, options));
      options.onProgress?.('Website ' + cache.size + '/' + maxWebsites + ': ' + cache.get(row.website).website_scrape_status);
    }
    Object.assign(row, cache.get(row.website));
  }
  return rows;
}

export function csvCell(value) {
  let text = String(value ?? '');
  if (typeof value !== 'number' && /^\s*[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}
export function toCsv(rows) {
  // UTF-8 BOM and CRLF make exports easy to open in Excel, including Indonesian text.
  return '\uFEFF' + [CSV_COLUMNS.join(','), ...rows.map(row => CSV_COLUMNS.map(key => csvCell(row[key])).join(','))].join('\r\n') + '\r\n';
}

async function atomicWrite(path, content) {
  const temp = path + '.' + process.pid + '.tmp';
  await writeFile(temp, content);
  await rename(temp, path);
}
export async function writeCsvFiles(rows, { outputDir = 'data/scrapes', now = new Date() } = {}) {
  if (!rows.length) throw new Error('Refusing to replace CSV files with an empty dataset.');
  const directory = resolve(outputDir);
  await mkdir(directory, { recursive: true });
  // UTC run time is unambiguous; WIB schedule is documented in the workflow.
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const snapshot = resolve(directory, 'coffee-in-bandung-' + stamp + '.csv');
  const latest = resolve(directory, 'latest.csv');
  const csv = toCsv(rows);
  await atomicWrite(snapshot, csv);
  await atomicWrite(latest, csv);
  return { snapshot, latest, rowCount: rows.length };
}

export async function runScrape(options = {}) {
  const now = options.now || new Date();
  const keyword = options.keyword || DEFAULT_KEYWORD;
  const rows = await discoverLocations({ ...options, keyword, now });
  await enrichLocations(rows, options);
  return writeCsvFiles(rows, { ...options, now });
}

function parseOptions(args) {
  const options = { keyword: DEFAULT_KEYWORD, outputDir: 'data/scrapes', maxWebsites: 20 };
  for (let i = 0; i < args.length; i++) {
    const key = { '--keyword': 'keyword', '--output-dir': 'outputDir', '--max-websites': 'maxWebsites' }[args[i]];
    if (!key || !args[i + 1]) throw new Error('Usage: npm run scrape:locations -- [--keyword "coffee in Bandung"] [--output-dir data/scrapes] [--max-websites 20]');
    const value = args[++i];
    options[key] = key.startsWith('max') ? Number(value) : value;
  }
  validateKeyword(options.keyword);
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runScrape({ ...parseOptions(process.argv.slice(2)), onProgress: message => console.log(message) });
    console.log(JSON.stringify(result, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Coffee Radar location scrape\n\nSaved ${result.rowCount} locations for **coffee in Bandung**.\n\n- Latest CSV: \`data/scrapes/latest.csv\`\n- Source: OpenStreetMap contributors (ODbL). Website fields include per-site status.\n- Schedule: Monday, 08:00 WIB (01:00 UTC).\n`);
    }
  } catch (error) {
    console.error('Scrape failed: ' + error.message);
    process.exitCode = 1;
  }
}
