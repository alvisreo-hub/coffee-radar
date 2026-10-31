import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {curateRows} from '../lib/curation.mjs';
import {curateCsv} from './curate-locations.mjs';
import {parseCsv,catalogFromCsv} from '../lib/catalog.mjs';
const now=new Date('2026-10-19T08:00:00Z');
const row=(id,extras={})=>({name:'Kopi '+id,source_id:'node/'+id,source_url:'https://www.openstreetmap.org/node/'+id,latitude:-6.9,longitude:107.6,geographic_scope:'Bandung administrative boundary',scraped_at_utc:now.toISOString(),...extras});

test('all records receive source-backed curation without taste or popularity scores',()=>{
 const input=Array.from({length:1501},(_,i)=>row(i));
 input[0].internet_access='wlan';input[0].outdoor_seating='no';
 const result=curateRows(input,{now});assert.equal(result.length,1501);
 assert.ok(result.every(r=>r.curation_version&&r.curated_at_utc===now.toISOString()));
 assert.ok(JSON.parse(result[0].curation_categories_json).includes('Wi-Fi tercatat'));
 assert.ok(!JSON.parse(result[0].curation_categories_json).includes('Area luar tercatat'));
 assert.equal(JSON.parse(result[0].curation_evidence_json)[0].source_url,input[0].source_url);
 assert.ok(result.every(r=>r.rating===undefined&&r.reviews===undefined));
 assert.equal(input[0].curation_status,undefined);
 assert.deepEqual(curateRows(result,{now}),result);
});

test('missing identity, coordinates, fallback scope and uncertain contacts are flagged without removing rows',()=>{
 const result=curateRows([row(1,{name:'Kafe tanpa nama · node/1'}),row(2,{latitude:''}),row(3,{geographic_scope:'Bandung bounding box; may include neighboring areas'}),row(4,{instagram_confidence:'search_match'})],{now});
 assert.ok(result.every(r=>r.curation_status==='needs_review'));
 assert.ok(JSON.parse(result[0].curation_flags_json).includes('missing_name'));
 assert.ok(JSON.parse(result[1].curation_flags_json).includes('invalid_coordinates'));
});

test('possible duplicate nodes are flagged; distant same-name branches stay separate',()=>{
 const result=curateRows([row(1,{name:'Same'}),row(2,{name:'Same',latitude:-6.9001}),row(3,{name:'Same',latitude:-6.93})],{now});
 assert.deepEqual(JSON.parse(result[0].curation_duplicate_ids_json),['node/2']);
 assert.equal(result[0].curation_status,'needs_review');assert.equal(result[2].curation_status,'listed');
 assert.equal(result.length,3);
});

test('completeness measures six factual fields, not unavailable facilities',()=>{
 const [full]=curateRows([row(1,{address:'Jalan Kopi',opening_hours:'Mo-Su 08:00-20:00',phone:'+6222',website:'https://example.com'})],{now});
 assert.equal(full.curation_completeness_pct,100);assert.equal(full.curation_status,'listed');
 assert.deepEqual(JSON.parse(full.curation_flags_json),[]);
});

test('CSV curation preserves every row, coordinate, safe text, unknown field, contact evidence and original scrape time',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'coffee-curation-'));
 try {
  const file=join(dir,'latest.csv');
  const input='\uFEFFname,source_id,source_url,latitude,longitude,geographic_scope,scraped_at_utc,phone,custom,instagram_url,instagram_source_url\r\nKopi,node/1,https://www.openstreetmap.org/node/1,-6.9,107.6,Bandung administrative boundary,2026-10-18T00:00:00Z,\'+6222,"quoted, text",https://instagram.com/kopi/,https://example.com/source\r\n';
  await writeFile(file,input);const original=parseCsv(input)[0];
  const result=await curateCsv({file,now});assert.equal(result.rowCount,1);
  const output=await readFile(file,'utf8'),saved=parseCsv(output)[0];
  for(const [key,value] of Object.entries(original))assert.equal(saved[key],value,key);
  assert.equal(await readFile(result.snapshot,'utf8'),output);
  const catalog=catalogFromCsv([],output);assert.equal(catalog.assessedCount,1);
  assert.equal(catalog.shops[0].lat,-6.9);assert.equal(catalog.shops[0].phone,'+6222');
  assert.equal(catalog.shops[0].curation.status,'listed');assert.equal(catalog.shops[0].rating,null);
  const again=await curateCsv({file,now});assert.equal(await readFile(again.latest,'utf8'),output);
  await writeFile(file,'name\n');await assert.rejects(curateCsv({file,now}),/empty/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('weekly workflow curates immediately after all scraping and before upload or commit',async()=>{
 const workflow=await readFile(new URL('../.github/workflows/scrape-locations.yml',import.meta.url),'utf8');
 assert.match(workflow,/cron: '0 1 \* \* 1'/);
 assert.match(workflow,/run: node scripts\/scrape-locations\.mjs[\s\S]*run: npm run photos:locations\n      - name: Curate every CSV location after scraping and contact enrichment\n        run: npm run curate:locations\n      - name: Upload CSV/);
});
