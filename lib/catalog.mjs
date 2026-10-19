// Shared by the build and the deployed Worker. No Node-only imports.
export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false, endedQuote = false;
  function finishCell() { row.push(cell); cell = ''; endedQuote = false; }
  function finishRow() { finishCell(); if (row.some(v => v !== '')) rows.push(row); row = []; }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; endedQuote = true; }
      else cell += ch;
    } else if (ch === '"') {
      if (cell || endedQuote) throw new Error('Invalid CSV quoting.');
      quoted = true;
    } else if (ch === ',') finishCell();
    else if (ch === '\r' || ch === '\n') {
      finishRow();
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else {
      if (endedQuote) throw new Error('Unexpected text after CSV quote.');
      cell += ch;
    }
  }
  if (quoted) throw new Error('Unterminated CSV field.');
  if (cell || row.length || endedQuote) finishRow();
  if (!rows.length) return [];
  const headers = rows.shift();
  if (new Set(headers).size !== headers.length) throw new Error('Duplicate CSV headers.');
  return rows.map(values => {
    if (values.length !== headers.length) throw new Error('CSV column count mismatch.');
    return Object.fromEntries(headers.map((key, i) => [key, values[i]]));
  });
}

function unescapeSpreadsheet(text = '') {
  return /^'\s*[=+\-@\t\r]/.test(text) ? text.slice(1) : text;
}
function number(value) {
  if (value === '' || value === undefined || value === null) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
export function websiteUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function instagramUrl(value) {
  if (!value) return '';
  try {
    const input = String(value).trim();
    const url = new URL(input.startsWith('@') ? 'https://www.instagram.com/' + input.slice(1) + '/' :
      /^https?:\/\//i.test(input) ? input : /^(?:www\.)?instagram\.com\//i.test(input) ? 'https://' + input : 'https://www.instagram.com/' + input + '/');
    if (!['instagram.com','www.instagram.com'].includes(url.hostname.toLowerCase()) || url.username || url.password) return '';
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 1 || !/^[a-zA-Z0-9._]{1,30}$/.test(parts[0]) ||
      ['p','reel','reels','explore','stories','accounts','tv','direct','about','developer'].includes(parts[0].toLowerCase())) return '';
    return 'https://www.instagram.com/' + parts[0].toLowerCase() + '/';
  } catch { return ''; }
}

function contactCandidates(value) {
  try {
    const parsed=JSON.parse(value||'[]');
    if(!Array.isArray(parsed))return [];
    return parsed.filter(c=>c&&['website','instagram'].includes(c.type)).map(c=>({
      type:c.type,url:c.type==='instagram'?instagramUrl(c.url):websiteUrl(c.url),
      title:String(c.title||'').slice(0,180),confidence:c.confidence==='search_match'?'search_match':'candidate',
      sourceUrl:websiteUrl(c.source_url),
    })).filter(c=>c.url).slice(0,8);
  }catch{return [];}
}

export function csvLocations(text) {
  const rows = parseCsv(text);
  if (rows.length && !['source_id', 'name', 'latitude', 'longitude', 'scraped_at_utc'].every(k => k in rows[0])) throw new Error('CSV is missing location columns.');
  const byId = new Map();
  for (const row of rows) {
    if (!/^(node|way|relation)\/\d+$/.test(row.source_id || '')) continue;
    const latitude = number(row.latitude), longitude = number(row.longitude);
    if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    const source = 'https://www.openstreetmap.org/' + row.source_id;
    const date = new Date(row.scraped_at_utc);
    if (!Number.isFinite(date.getTime())) continue;
    const tags = ['Data komunitas'];
    if (row.internet_access === 'wlan' || row.internet_access === 'yes') tags.push('Wi-Fi tercatat');
    if (row.outdoor_seating === 'yes') tags.push('Area luar tercatat');
    if (row.wheelchair === 'yes') tags.push('Akses kursi roda tercatat');
    const record = {
      id: 'osm-' + row.source_id.replace('/', '-'), osmId: row.source_id,
      name: unescapeSpreadsheet(row.name) || 'Kafe tanpa nama · ' + row.source_id,
      area: unescapeSpreadsheet(row.neighborhood) || 'Bandung',
      address: unescapeSpreadsheet(row.address) || 'Alamat rinci belum tercatat di sumber',
      lat: latitude, lng: longitude, tags, category: 'unreviewed', uncurated: true,
      menu: '', note: unescapeSpreadsheet(row.website_description) || 'Lokasi dari CSV OpenStreetMap. Belum ditinjau kurator; konfirmasi informasi sebelum berkunjung.',
      reason: 'Ditemukan dalam pengumpulan lokasi Bandung. Data komunitas belum menjadi rekomendasi rasa. ' + (row.geographic_scope || ''),
      source, sourceName: 'OpenStreetMap · CSV', rating: null, reviews: null,
      importedAt: date.toISOString(), website: websiteUrl(unescapeSpreadsheet(row.website)),
      instagramUrl: instagramUrl(row.instagram_url), instagramSourceUrl: websiteUrl(row.instagram_source_url),
      instagramConfidence: row.instagram_confidence || '', websiteSourceUrl: websiteUrl(row.website_source_url),
      websiteConfidence: row.website_confidence || '', linkLookupStatus: row.link_lookup_status || 'not_checked',
      linksCheckedAt: row.link_checked_at || '', contactNote: row.link_reference_note || '', contactCandidates: contactCandidates(row.link_candidates_json),
      phone: unescapeSpreadsheet(row.phone), openingHours: row.opening_hours || '',
      websiteTitle: unescapeSpreadsheet(row.website_title), websiteScrapeStatus: row.website_scrape_status || '',
      websiteError: row.website_error || '', geographicScope: row.geographic_scope || '',
      license: row.license || 'ODbL 1.0 — © OpenStreetMap contributors',
    };
    const previous = byId.get(record.id);
    if (!previous || record.importedAt >= previous.importedAt) byId.set(record.id, record);
  }
  return [...byId.values()];
}

function key(name) { return name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function near(a, b) {
  return Number.isFinite(a.lat) && Number.isFinite(a.lng) &&
    Math.hypot((a.lat - b.lat) * 111000, (a.lng - b.lng) * 110000) < 300;
}
export function mergeCatalog(curated, discovered) {
  const output = curated.map(s => ({ ...s, tags: [...s.tags] }));
  const seen = new Set();
  for (const record of discovered) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    const name = key(record.name);
    const match = output.find(s => !s.uncurated && near(s, record) &&
      (key(s.name) === name || name.startsWith(key(s.name)) || key(s.name).startsWith(name)));
    if (match && !match.osmId) {
      Object.assign(match, { osmId: record.osmId, csvSource: record.source,
        address: record.address === 'Alamat rinci belum tercatat di sumber' ? match.address : record.address,
        lat: record.lat, lng: record.lng, importedAt: record.importedAt,
        website: record.website, phone: record.phone, openingHours: record.openingHours,
        instagramUrl: record.instagramUrl, instagramSourceUrl: record.instagramSourceUrl, instagramConfidence: record.instagramConfidence,
        websiteSourceUrl: record.websiteSourceUrl, websiteConfidence: record.websiteConfidence, linkLookupStatus: record.linkLookupStatus,
        linksCheckedAt: record.linksCheckedAt, contactNote: record.contactNote, contactCandidates: record.contactCandidates,
        geographicScope: record.geographicScope, websiteScrapeStatus: record.websiteScrapeStatus,
      });
    } else output.push(record);
  }
  return output;
}
export function catalogFromCsv(curated, csv) {
  const locations = csvLocations(csv);
  const shops = mergeCatalog(curated, locations);
  return {
    shops, csvRowCount: locations.length, totalCount: shops.length,
    curatedCount: curated.length, sourceUrl: 'https://github.com/alvisreo-hub/coffee-radar/blob/main/data/scrapes/latest.csv',
    lastUpdated: locations.reduce((date, s) => date > s.importedAt ? date : s.importedAt, ''),
    geographicScopes: [...new Set(locations.map(s => s.geographicScope))],
  };
}
