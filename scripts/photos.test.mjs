import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {extractPhotoCandidates,selectPagePhoto,enrichPhotos,enrichPhotoCsv,validatePhoto,applyPhotoReferences} from './enrich-photos.mjs';
import {photoFromRow,photoUrl,parseCsv,catalogFromCsv} from '../lib/catalog.mjs';
import {preservePhotoData} from '../lib/photo-fields.mjs';
import worker,{photoSecurity} from '../worker/index.js';
const now=new Date('2026-10-31T04:00:00Z');
const row=i=>({source_id:'node/'+i,name:'Kedai Bumi '+i,latitude:-6.9,longitude:107.6,scraped_at_utc:'2026-10-26T01:00:00Z'});
const ref=i=>({...row(i),photo_url:'https://images.example.com/bumi'+i+'.jpg',photo_source_url:'https://review.example.com/kedai-bumi-'+i+'-bandung',photo_credit:'Review publisher',photo_caption:'Area kedai',photo_scope:'branch',photo_status:'found',photo_checked_at:now.toISOString()});
const page={website_scrape_status:'ok',website_title:'Kedai Bumi 1 Bandung',website_description:'Coffee in Bandung',photo_candidates:[{url:'https://images.example.com/bumi.jpg',kind:'social_preview'}]};

test('photo extraction supports metadata order, relative paths, lazy images and excludes logos and thumbnails',()=>{
 const images=extractPhotoCandidates('<meta content="/venue.jpg?x=1&amp;y=2" property="og:image"><img src="/logo.jpg"><img width="80" src="/tiny.jpg"><img data-src="/room.jpg" alt="Kedai Bumi"><img src="data:image/png,abc">','https://cafe.example.com/page');
 assert.equal(images.length,2);assert.equal(images[0].url,'https://cafe.example.com/venue.jpg?x=1&y=2');assert.equal(images[1].caption,'Kedai Bumi');
});

test('image URLs reject unsafe schemes, local networks, credentials, avatars and arbitrary ports',()=>{
 for(const url of ['javascript:alert(1)','http://example.com/a.jpg','https://localhost/a.jpg','https://127.0.0.1/a.jpg','https://10.0.0.2/a.jpg','https://172.16.0.1/a.jpg','https://user:pw@example.com/a.jpg','https://example.com:8080/a.jpg','https://example.com/logo.png'])assert.equal(photoUrl(url),'',url);
 assert.equal(photoFromRow({...ref(1),photo_source_url:''}),null);assert.equal(photoFromRow({...ref(1),photo_status:'candidate'}),null);
});

test('dedicated business photo selection requires shop identity and locality, never listicles or failed pages',()=>{
 assert.equal(selectPagePhoto(row(1),page,'https://review.example.com/bumi-bandung').url,page.photo_candidates[0].url);
 assert.equal(selectPagePhoto(row(2),page,'https://review.example.com/bumi-bandung'),null);
 assert.equal(selectPagePhoto(row(1),{...page,website_title:'10 cafe terbaik: Kedai Bumi 1 Bandung'},'https://example.com'),null);
 assert.equal(selectPagePhoto(row(1),{...page,website_scrape_status:'robots_disallowed'},'https://example.com'),null);
});

test('references are matched by source ID AND identity; no cross-branch name copying',()=>{
 const rows=[row(1),row(2),{...row(3),name:'Different'}];applyPhotoReferences(rows,[ref(1),{...ref(3),name:'Old name'}],{now});
 assert.ok(photoFromRow(rows[0]));assert.equal(rows[1].photo_url,undefined);assert.equal(rows[2].photo_url,undefined);
 const refreshed=[row(1),{...row(2),name:'Different'}];preservePhotoData(refreshed,[ref(1),ref(2)]);
 assert.equal(refreshed[0].photo_url,ref(1).photo_url);assert.equal(refreshed[1].photo_url,undefined);
});

test('all locations are assessed with no result cap; unidentified rows stay in dataset',async()=>{
 const rows=Array.from({length:1105},(_,i)=>row(i+1));rows[0].name='Kafe tanpa nama · node/1';let searches=0;
 const stats=await enrichPhotos(rows,{now,scrapePage:async()=>page,searchWeb:async()=>{searches++;return {results:[]};},checkPhoto:async()=>true});
 assert.equal(stats.total,1105);assert.equal(searches,1104);assert.equal(rows[0].photo_status,'insufficient_identity');
 assert.ok(rows.every(r=>r.photo_checked_at===now.toISOString()));
});

test('a matched review image is attributed, while transient failures preserve saved photos',async()=>{
 const rows=[row(1),{...ref(2),photo_checked_at:'2026-09-01T00:00:00Z'}];
 await enrichPhotos(rows,{now,scrapePage:async()=>page,searchWeb:async query=>{if(query.includes('Bumi 1'))return {results:[{title:'Kedai Bumi 1 Bandung',url:'https://review.example.com/bumi-bandung',description:'Bandung coffee'}]};throw Error('HTTP 429');},checkPhoto:async()=>true});
 assert.equal(rows[0].photo_status,'found');assert.equal(rows[0].photo_scope,'business');assert.equal(rows[0].photo_credit,'review.example.com');
 assert.equal(rows[1].photo_url,ref(2).photo_url);assert.match(rows[1].photo_lookup_error,/429/);
});

test('image fetch validation rejects private DNS, redirects, non-images, and oversized files',async()=>{
 const options={lookupImpl:async()=>[{address:'93.184.216.34',family:4}]};
 await assert.rejects(validatePhoto('https://example.com/a.jpg',{...options,lookupImpl:async()=>[{address:'127.0.0.1',family:4}],fetchImpl:()=>{throw Error('must not fetch');}}),/private|public/i);
 await assert.rejects(validatePhoto('https://example.com/a.jpg',{...options,fetchImpl:async()=>new Response('',{status:302,headers:{Location:'http://127.0.0.1'}})}),/302/);
 await assert.rejects(validatePhoto('https://example.com/a.jpg',{...options,fetchImpl:async()=>new Response('<html>',{headers:{'content-type':'text/html'}})}),/photograph/);
 await assert.rejects(validatePhoto('https://example.com/a.jpg',{...options,fetchImpl:async()=>new Response(new Uint8Array(8_000_001),{headers:{'content-type':'image/jpeg'}})}),/size limit/);
});

test('photo CSV preserves every existing field and reaches catalog without losing curation or contact evidence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'coffee-photos-'));try{
  const file=join(dir,'latest.csv');await writeFile(file,'\uFEFFsource_id,name,latitude,longitude,scraped_at_utc,phone,custom\r\nnode/1,Kedai Bumi 1,-6.9,107.6,2026-10-26T01:00:00Z,\'+6222,"text, with comma"\r\n');
  const before=parseCsv(await readFile(file,'utf8'))[0];const result=await enrichPhotoCsv({file,references:[ref(1)],referenceOnly:true,now});
  const csv=await readFile(file,'utf8'),after=parseCsv(csv)[0];for(const [k,v] of Object.entries(before))assert.equal(after[k],v);
  assert.equal(await readFile(result.snapshot,'utf8'),csv);assert.equal(catalogFromCsv([],csv).photoCount,1);
  assert.equal(catalogFromCsv([],csv).shops[0].photo.sourceUrl,ref(1).photo_source_url);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('page image CSP permits specific catalog photo hosts and rejects unrestricted image origins',async()=>{
 const headers=photoSecurity({shops:[{photo:{url:'https://venue.example.com/room.jpg'}},{photo:{url:'javascript:alert(1)'}}]});
 const directive=headers['Content-Security-Policy'].split(';').find(s=>s.trim().startsWith('img-src'));
 assert.ok(directive.includes('https://venue.example.com'));assert.ok(!directive.split(/\s+/).includes('https:'));assert.ok(!directive.includes('*'));
 const page=await worker.fetch(new Request('https://coffee.example/'),{CATALOG_OFFLINE:true});
 assert.match(page.headers.get('content-security-policy'),/https:\/\/www\.mldspot\.com/);
 const html=await page.text();assert.ok(!html.includes('coffee-sheet.jpg'));assert.ok(html.includes('referrerpolicy="no-referrer"'));
});
