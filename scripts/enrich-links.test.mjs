import test from 'node:test';import assert from 'node:assert/strict';
import { instagramUrl } from '../lib/catalog.mjs';
import { parseSearchFeed,extractInstagramLinks,selectSearchLinks,enrichContactLinks,createSearchClient,preserveContactData } from './enrich-links.mjs';
const now=new Date('2026-10-19T00:00:00Z');
const row=(id=1,extras={})=>({name:'Kopi Cerita',source_id:'node/'+id,source_url:'https://www.openstreetmap.org/node/'+id,website:'',instagram_url:'',latitude:-6.9,longitude:107.6,...extras});
const result={title:'Kopi Cerita Bandung (@kopic erita)',url:'https://www.instagram.com/kopicerita/',description:'Coffee shop Bandung, Jalan Braga'};
test('Instagram normalization accepts profiles and rejects posts, malformed links and other hosts',()=>{
 assert.equal(instagramUrl('instagram.com/kopicerita'),'https://www.instagram.com/kopicerita/');
 assert.equal(instagramUrl('@Kopi.Cerita'),'https://www.instagram.com/kopi.cerita/');
 assert.equal(instagramUrl('https://instagram.com/kopicerita/?hl=id'),'https://www.instagram.com/kopicerita/');
 for(const url of ['https://instagram.com/p/ABC/','https://instagram.com/reel/XYZ/','https://instagram.com.evil.example/shop/','https://instagram.com/accounts/login/','https://user:password@instagram.com/shop/'])assert.equal(instagramUrl(url),'');
});
test('RSS result parsing supports entity decoding and CDATA without accepting arbitrary HTML as results',()=>{
 const r=parseSearchFeed('<rss><channel><item><title><![CDATA[Kopi & Cerita]]></title><link>https://instagram.com/kopicerita/</link><description>Coffee &amp; Bandung</description></item></channel></rss>');
 assert.equal(r[0].title,'Kopi & Cerita');assert.equal(r[0].description,'Coffee & Bandung');assert.throws(()=>parseSearchFeed('<html>Captcha</html>'),/RSS/);
});
test('website extraction finds profile links and ignores Instagram posts and tracking parameters',()=>{
 const p=extractInstagramLinks('<a href="https://instagram.com/kopicerita/?hl=id">IG</a><a href="https://instagram.com/p/post">post</a>','https://kopicerita.example');assert.deepEqual(p,['https://www.instagram.com/kopicerita/']);
});
test('search matching needs business identity and Bandung evidence, and never labels directory sites official',()=>{
 let selected=selectSearchLinks(row(),[result,{...result,title:'Different cafe Bandung',url:'https://different.example/'},{title:'Kopi Cerita Bandung reviews',url:'https://restaurantguru.com/Kopi-Cerita',description:'Bandung'}]);
 assert.equal(selected.instagram.url,'https://www.instagram.com/kopicerita/');assert.equal(selected.website,undefined);assert.equal(selected.candidates[0].confidence,'search_match');
 selected=selectSearchLinks(row(),[{...result,title:'Kopi Cerita Jakarta',description:'Jakarta',url:'https://kopicerita.example/'}]);assert.equal(selected.website,undefined);assert.equal(selected.candidates[0].confidence,'candidate');
});
test('all shop rows are looked up, with query and per-row timestamps saved',async()=>{
 const rows=[row(1),row(2,{name:'Kopi Senja'})];const queries=[];
 await enrichContactLinks(rows,{now,searchWeb:async q=>{queries.push(q);return {results:q.includes('Cerita')?[result]:[]};}});
 assert.equal(queries.length,2);assert.equal(rows[0].instagram_url,result.url);assert.equal(rows[0].instagram_confidence,'search_match');assert.equal(rows[1].link_lookup_status,'not_found');assert.equal(rows[1].link_checked_at,now.toISOString());
});
test('Instagram extracted from a business website is attributed to that website',async()=>{
 const rows=[row(1,{website:'https://kopicerita.example'})];
 await enrichContactLinks(rows,{now,scrapeWebsite:async()=>({website_scrape_status:'ok',instagram_links:['https://www.instagram.com/kopicerita/']}),searchWeb:async()=>{throw Error('Should not search');}});
 assert.equal(rows[0].instagram_confidence,'website_link');assert.equal(rows[0].instagram_source_url,'https://kopicerita.example/');assert.equal(rows[0].link_lookup_status,'found');
});
test('known contact links survive upstream failures and previously saved data is not erased',async()=>{
 const previous=[row(1,{website:'https://kopicerita.example',website_source_url:'https://source.example',website_confidence:'search_match'})];
 const rows=[row()];preserveContactData(rows,previous);assert.equal(rows[0].website,previous[0].website);
 await enrichContactLinks(rows,{now,searchWeb:async()=>{throw Error('provider unavailable');}});
 assert.equal(rows[0].website,'https://kopicerita.example/');assert.equal(rows[0].link_lookup_status,'partial');assert.match(rows[0].link_lookup_error,/unavailable/);
});
test('Instagram in an OSM website field is correctly separated from the website',async()=>{
 const rows=[row(1,{website:'https://instagram.com/kopicerita'})];await enrichContactLinks(rows,{now,searchWeb:async()=>({results:[]})});
 assert.equal(rows[0].website,'');assert.equal(rows[0].instagram_url,'https://www.instagram.com/kopicerita/');assert.equal(rows[0].instagram_confidence,'mapped');
});
test('unnamed rows remain in CSV with a clear identity status; they are not assigned guessed accounts',async()=>{
 const rows=[row(1,{name:'Kafe tanpa nama · node/1'})];let calls=0;await enrichContactLinks(rows,{now,searchWeb:async()=>{calls++;return {results:[result]};}});assert.equal(calls,0);assert.equal(rows.length,1);assert.equal(rows[0].link_lookup_status,'insufficient_identity');
});
test('search client uses the public RSS feed without a key, caches identical queries and reports HTTP failures',async()=>{
 let calls=0;const search=createSearchClient({wait:async()=>{},apiKey:'',fetchImpl:async url=>{calls++;assert.ok(url.startsWith('https://www.bing.com/search?'));return new Response('<rss><channel/></rss>');}});
 await search('Kopi Cerita Bandung');await search('Kopi Cerita Bandung');assert.equal(calls,1);
 const broken=createSearchClient({wait:async()=>{},apiKey:'',fetchImpl:async()=>new Response('busy',{status:429})});await assert.rejects(broken('Kopi Cerita'),/HTTP 429/);
});

test('matching business-directory pages provide attributed profile evidence, not a guessed official account',async()=>{
 const rows=[row()];await enrichContactLinks(rows,{now,searchWeb:async()=>({results:[{title:'Kopi Cerita, Bandung',url:'https://www.semuabis.com/kopi-cerita',description:'Bandung coffee shop'}]}),scrapeWebsite:async()=>({website_scrape_status:'ok',website_title:'Kopi Cerita, Bandung',instagram_links:['https://www.instagram.com/kopicerita/'],website_links:[]})});
 assert.equal(rows[0].instagram_url,'https://www.instagram.com/kopicerita/');assert.equal(rows[0].instagram_confidence,'directory_reference');assert.equal(rows[0].instagram_source_url,'https://www.semuabis.com/kopi-cerita');
});

test('saved researched references fill missing contacts and keep branch-specific accounts as candidates',async()=>{
 const {applyContactReferences}=await import('./enrich-links.mjs');
 const rows=[row(1),row(2)];applyContactReferences(rows,[{source_id:'node/1',name:'Kopi Cerita',instagram_url:'https://instagram.com/kopicerita',source_url:'https://source.example/coffee',confidence:'web_reference',website:'https://kopicerita.example',website_confidence:'brand_reference',note:'Akun merek.'},{source_id:'node/2',name:'Kopi Cerita',instagram_url:'https://instagram.com/kopicerita_jakarta',confidence:'candidate'}],{now});
 assert.equal(rows[0].instagram_confidence,'web_reference');assert.equal(rows[0].website,'https://kopicerita.example/');assert.equal(rows[0].link_reference_note,'Akun merek.');
 assert.equal(rows[1].instagram_url,'');assert.equal(JSON.parse(rows[1].link_candidates_json)[0].confidence,'candidate');
});

test('an explicit reviewed identity correction preserves the old website as a candidate',async()=>{
 const {applyContactReferences}=await import('./enrich-links.mjs');
 const rows=[row(1,{website:'https://wrong-country.example',instagram_url:'https://instagram.com/wrong_account'})];
 applyContactReferences(rows,[{source_id:'node/1',name:'Kopi Cerita',instagram_url:'https://instagram.com/correct_account',source_url:'https://local.example/coffee',confidence:'web_reference',replace_instagram:true,rejected_website_host:'wrong-country.example'}],{now});
 assert.equal(rows[0].website,'');assert.equal(rows[0].instagram_url,'https://www.instagram.com/correct_account/');assert.equal(JSON.parse(rows[0].link_candidates_json)[0].url,'https://wrong-country.example');
});
