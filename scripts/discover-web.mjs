import {createHash} from 'node:crypto';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCsv,websiteUrl} from '../lib/catalog.mjs';
import {createSearchClient} from './enrich-links.mjs';
import {scrapeWebsite} from './scrape-locations.mjs';
const key=s=>String(s||'').toLowerCase().replace(/\bjalan\b/g,'jl').replace(/[^a-z0-9]/g,'');
export const QUERIES=['Braga','Dago','Ciumbuleuit','Cigadung','Antapani','Buah Batu','Ujungberung','Arcamanik','Kopo','Sukajadi','Cibiru','Gedebage','Lengkong','Cihapit'].flatMap(area=>['coffee shop '+area+' Bandung','site:tiktok.com coffee cafe '+area+' Bandung']);
export function serialize(rows){const columns=[...new Set(rows.flatMap(Object.keys))];const cell=v=>{let s=String(v??'');if(/^\s*[=+\-@]/.test(s)&&!/^\-?\d+(\.\d+)?$/.test(s))s="'"+s;return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};return '\uFEFF'+[columns.join(','),...rows.map(r=>columns.map(c=>cell(r[c])).join(','))].join('\r\n')+'\r\n';}
export {structuredPlaces} from '../lib/web-extract.mjs';

export function mergeDiscovered(rows,refs,now=new Date()){
 const output=[...rows];for(const ref of refs){if(!ref.name||!ref.address||!websiteUrl(ref.source_url))continue;
 const existing=output.find(r=>key(r.name)===key(ref.name)&&key(r.address)===key(ref.address));if(existing)continue;
 const source_id='web/'+createHash('sha256').update(key(ref.name)+'|'+key(ref.address)).digest('hex').slice(0,16);
 if(output.some(r=>r.source_id===source_id))continue;
 output.push({keyword:'coffee in Bandung',name:ref.name,address:ref.address,latitude:ref.latitude??'',longitude:ref.longitude??'',city:'Bandung',neighborhood:ref.neighborhood||'Bandung',source:'Public web recommendation',source_id,source_url:ref.source_url,geographic_scope:'Bandung city · address from public source; coordinates may be unverified',scraped_at_utc:now.toISOString(),published_at:ref.published_at||'',instagram_url:ref.instagram_url||'',instagram_source_url:ref.instagram_url?ref.source_url:'',instagram_confidence:ref.instagram_url?'web_reference':'',license:'Source facts; see original publisher',discovery_status:'address_sourced',recommendation_note:'Rekomendasi sumber publik; tanggal artikel bukan tanggal pembukaan. Belum membuktikan viral.'});}
 return output;
}
export async function discover({referenceOnly=false,searchWeb=createSearchClient(),scrapePage=scrapeWebsite,now=new Date()}={}){
 const file='data/scrapes/latest.csv';const rows=parseCsv(await readFile(file,'utf8'));if(!rows.length)throw Error('Empty base CSV');
 const refs=JSON.parse(await readFile('data/discovery-references.json','utf8'));try{refs.push(...parseCsv(await readFile('data/scrapes/web-locations.csv','utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}let previous=[];try{previous=parseCsv(await readFile('data/scrapes/discovery-candidates.csv','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const seeds=JSON.parse(await readFile('data/social-discovery-references.json','utf8'));
 const candidates=new Map([...seeds,...previous].map(r=>[r.source_url,r]));const report=[];
 if(!referenceOnly)for(const query of QUERIES){try{const result=await searchWeb(query);report.push({query,status:'ok',results:result.results.length,checked_at:now.toISOString()});for(const hit of result.results){if(!websiteUrl(hit.url)||!/bandung/i.test(hit.title+' '+hit.description+' '+hit.url))continue;
 const host=new URL(hit.url).hostname;const platform=host==='tiktok.com'||host==='www.tiktok.com'?'TikTok':host==='notes.tiktok.com'?'TikTok Notes / Lemon8':'Public web';
 candidates.set(hit.url,{source_url:hit.url,title:hit.title,platform,description:hit.description||'',checked_at:now.toISOString(),status:'candidate_needs_identity_address_and_date_review'});
 if(platform==='Public web'){const page=await scrapePage(hit.url);if(page.website_scrape_status==='ok')refs.push(...(page.structured_places||[]));}
 }}catch(error){report.push({query,status:'unavailable',error:error.message,checked_at:now.toISOString()});}}
 const merged=mergeDiscovered(rows,refs,now);await writeFile(file+'.tmp',serialize(merged));await rename(file+'.tmp',file);
 await writeFile('data/scrapes/web-locations.csv',serialize(merged.filter(r=>r.source==='Public web recommendation')));
 await writeFile('data/scrapes/discovery-candidates.csv',serialize([...candidates.values()]));await writeFile('data/scrapes/discovery-status.json',JSON.stringify({checked_at:now.toISOString(),queries:report,direct_tiktok:'Not bypassed when robots/login blocks access',added:merged.length-rows.length},null,2)+'\n');
 return {total:merged.length,added:merged.length-rows.length,candidates:candidates.size};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(await discover({referenceOnly:process.argv.includes('--references-only')}));}catch(e){console.error(e);process.exitCode=1;}}
