import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCsv, csvLocations, mergeCatalog, catalogFromCsv, websiteUrl } from '../lib/catalog.mjs';
import { toCsv } from './scrape-locations.mjs';
import worker, { fetchCsvCatalog } from '../worker/index.js';
const seed = JSON.parse(await readFile(new URL('../work/seed.json',import.meta.url),'utf8'));
const row = (index = 1, extras = {}) => ({ keyword:'coffee in Bandung',name:'Cafe '+index,address:'Bandung',latitude:-6.9,longitude:107.6,source_id:'node/'+index,scraped_at_utc:'2026-10-19T01:00:00Z',geographic_scope:'Bandung administrative boundary',...extras });

test('CSV parser handles BOM, quotes, multiline values, CRLF, empty fields and Unicode',()=>{
 const data=parseCsv('\uFEFFname,description,other\r\n"Kopi, Énak","Line 1\nLine ""two""",\r\n');
 assert.deepEqual(data,[{name:'Kopi, Énak',description:'Line 1\nLine "two"',other:''}]);
 for(const input of ['a,b\n"broken,1','a,b\n"a"bad,1','a,a\n1,2','a,b\n1'])assert.throws(()=>parseCsv(input));
});

test('every CSV row above 1000 appears in the catalog, with no invented curation or ratings',()=>{
 const records=Array.from({length:1205},(_,i)=>row(i+1));
 const data=catalogFromCsv(seed,toCsv(records));
 assert.equal(data.csvRowCount,1205);
 assert.equal(data.shops.length,1211);
 assert.ok(data.shops.filter(s=>s.uncurated).every(s=>s.rating===null&&s.reviews===null));
 assert.ok(data.shops.some(s=>s.id==='osm-node-1205'));
});

test('locations carry CSV address, contacts, opening hours, site metadata, and provenance',()=>{
 const places=csvLocations(toCsv([row(1,{name:'=Untrusted',website:'https://example.com',phone:'+622211',opening_hours:'Mo-Su 08:00-22:00',website_title:'Cafe website',website_description:'Fresh coffee'})]));
 assert.equal(places[0].name,'=Untrusted');
 assert.equal(places[0].phone,'+622211');
 assert.equal(places[0].openingHours,'Mo-Su 08:00-22:00');
 assert.equal(places[0].website,'https://example.com/');
 assert.equal(places[0].source,'https://www.openstreetmap.org/node/1');
 assert.equal(places[0].note,'Fresh coffee');
});

test('import validation ignores forged IDs, impossible coordinates, invalid timestamps and unsafe website schemes',()=>{
 assert.equal(csvLocations(toCsv([row(1,{source_id:'../../private'}),row(2,{latitude:91}),row(3,{scraped_at_utc:'bad'})])).length,0);
 assert.equal(websiteUrl('javascript:alert(1)'), '');
 assert.equal(websiteUrl('https://user:secret@example.com'),'');
 assert.equal(websiteUrl('www.example.com'),'https://www.example.com/');
 assert.throws(()=>csvLocations('name\nCafe\n'),/columns/);
});

test('duplicate source IDs use the newest row and nearby curated matches keep editorial identity',()=>{
 const records=csvLocations(toCsv([
  row(1,{name:'Older',scraped_at_utc:'2026-10-18T00:00:00Z'}),row(1,{name:'Newer'}),
  row(2,{name:'Kopi Toko Djawa',latitude:seed[0].lat,longitude:seed[0].lng,address:'CSV address',phone:'123'}),
 ]));
 assert.equal(records.length,2);
 assert.equal(records[0].name,'Newer');
 const merged=mergeCatalog(seed,records);
 assert.equal(merged.length,7);
 const djawa=merged.find(s=>s.id==='djawa');
 assert.equal(djawa.rating,4.6);assert.equal(djawa.phone,'123');assert.equal(djawa.address,'CSV address');
 assert.equal(djawa.csvSource,'https://www.openstreetmap.org/node/2');
 assert.equal(djawa.sourceName,'Citour');
});

test('different branches with the same name remain separate locations',()=>{
 const records=csvLocations(toCsv([row(1,{name:'Kopi Toko Djawa',latitude:-6.88,longitude:107.64})]));
 const merged=mergeCatalog(seed,records);
 assert.equal(merged.length,7);assert.ok(merged.find(s=>s.id==='osm-node-1'));
});

test('deployed runtime reads the entire latest CSV and rejects failed or empty replacements',async()=>{
 const records=Array.from({length:1100},(_,i)=>row(i+1));
 const result=await fetchCsvCatalog(async url=>{assert.match(url,/raw.githubusercontent.com.*latest.csv/);return new Response(toCsv(records));});
 assert.equal(result.csvRowCount,1100);assert.equal(result.sourceStatus,'live_csv');
 await assert.rejects(fetchCsvCatalog(async()=>new Response('bad',{status:503})),/HTTP 503/);
 await assert.rejects(fetchCsvCatalog(async()=>new Response(toCsv([]))),/no valid/);
});

test('bundled website, JSON API, and CSV download contain all saved rows and the same provenance',async()=>{
 const csv=await readFile(new URL('../data/scrapes/latest.csv',import.meta.url),'utf8');
 const expected=catalogFromCsv(seed,csv);
 const api=await worker.fetch(new Request('https://coffee.example/api/catalog'),{CATALOG_OFFLINE:true});
 const data=await api.json();assert.equal(data.csvRowCount,expected.csvRowCount);assert.equal(data.shops.length,expected.shops.length);
 const download=await worker.fetch(new Request('https://coffee.example/api/catalog.csv'),{CATALOG_OFFLINE:true});
 assert.match(download.headers.get('content-type'),/text\/csv/);assert.equal(Buffer.from(await download.arrayBuffer()).toString('utf8'),csv);
 const html=await (await worker.fetch(new Request('https://coffee.example/'))).text();
 assert.ok(html.includes('osm-node-'));assert.ok(html.includes('refreshCatalog()'));assert.ok(html.includes('/api/catalog.csv'));
});
