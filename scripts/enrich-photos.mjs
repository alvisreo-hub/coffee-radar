import {readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCsv,photoUrl,photoFromRow} from '../lib/catalog.mjs';
import {nameMatches,createSearchClient} from './enrich-links.mjs';
import {scrapeWebsite,publicUrl,readBounded} from './scrape-locations.mjs';
import {PHOTO_COLUMNS} from '../lib/photo-fields.mjs';

export {PHOTO_COLUMNS};
const normalized=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const cell=(v,key)=>{let s=String(v??'');if(PHOTO_COLUMNS.includes(key)&&/^\s*[=+\-@\t\r]/.test(s))s="'"+s;return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};

export {extractPhotoCandidates} from '../lib/photo-extract.mjs';

export function selectPagePhoto(row,page,pageUrl) {
  if(page.website_scrape_status!=='ok'||!nameMatches(row.name,page.website_title))return null;
  if((row.name.match(/\b\d+\b/g)||[]).some(n=>!new RegExp('\\b'+n+'\\b').test(page.website_title)))return null;
  // Listicles' first images can depict a different shop. Require a dedicated business page.
  if(/\b(?:\d+\s+(?:best|cafe|coffee|kedai|tempat)|rekomendasi|daftar|terbaik|top\s+\d+)\b/i.test(page.website_title))return null;
  const local=/bandung/i.test(page.website_title+' '+page.website_description+' '+pageUrl);
  const official=row.website&&new URL(row.website).hostname===new URL(pageUrl).hostname&&!['candidate','search_match','brand_reference'].includes(row.website_confidence);
  if(!local&&!official)return null;
  const candidates=page.photo_candidates||[];
  // Dedicated preview image or a photo explicitly labelled with the shop's name.
  return candidates.find(p=>photoUrl(p.url)&&(p.kind==='social_preview'||nameMatches(row.name,p.caption)))||null;
}

export function applyPhotoReferences(rows,references,{now=new Date()}={}) {
  const refs=new Map(references.filter(r=>r.source_id).map(r=>[r.source_id,r]));
  for(const row of rows){const ref=refs.get(row.source_id);
    if(!ref||normalized(ref.name)!==normalized(row.name))continue;
    const data={...ref,photo_status:'found',photo_checked_at:ref.photo_checked_at||now.toISOString()};
    if(!photoFromRow(data))continue;
    for(const field of PHOTO_COLUMNS)row[field]=data[field]||'';
  }return rows;
}

export async function validatePhoto(value,{fetchImpl=fetch,lookupImpl,timeout=10000}={}) {
  const url=await publicUrl(value,lookupImpl);
  // No redirects to unvalidated destinations; sites that block embedding get a visible fallback.
  const response=await fetchImpl(url.href,{headers:{Accept:'image/avif,image/webp,image/*'},redirect:'manual',signal:AbortSignal.timeout(timeout)});
  if(!response.ok){await response.body?.cancel();throw Error('Photo returned HTTP '+response.status);}
  const type=(response.headers.get('content-type')||'').toLowerCase();
  if(!/^image\/(jpeg|png|webp|avif)/.test(type)){await response.body?.cancel();throw Error('Not a supported photograph image');}
  const content=await readBounded(response,8_000_000);
  if(!content.length)throw Error('Empty image');
  return true;
}

export async function enrichPhotos(rows,{references=[],previousRows=[],now=new Date(),scrapePage=scrapeWebsite,searchWeb=createSearchClient(),checkPhoto=validatePhoto,concurrency=3,onProgress=()=>{}}={}) {
  const previous=new Map(previousRows.map(r=>[r.source_id,r]));
  for(const row of rows){const old=previous.get(row.source_id);if(old&&normalized(old.name)===normalized(row.name)&&photoFromRow(old))for(const field of PHOTO_COLUMNS)if(!row[field])row[field]=old[field]||'';}
  applyPhotoReferences(rows,references,{now});
  const cache=new Map();let next=0,done=0;
  const inspect=url=>{if(!cache.has(url))cache.set(url,Promise.resolve(scrapePage(url)));return cache.get(url);};
  async function processRow(row){
    const saved=photoFromRow(row);
    // Human-matched references are refreshed through review; ordinary photos expire from cache after 21 days.
    if(saved&&now-new Date(row.photo_checked_at)<21*86400000)return;
    row.photo_lookup_error='';row.photo_checked_at=now.toISOString();
    if(!row.name||/^Kafe tanpa nama/i.test(row.name)){row.photo_status='insufficient_identity';return;}
    const errors=[],candidates=[];
    const sources=[row.website,row.instagram_source_url,row.website_source_url].filter(u=>{try{return photoUrl(u)&&!/(^|\.)(instagram|facebook|openstreetmap|google)\.com$|openstreetmap\.org$/.test(new URL(u).hostname);}catch{return false;}});
    const consider=async url=>{
      const page=await inspect(url);if(page.website_scrape_status!=='ok'){errors.push(page.website_error||page.website_scrape_status);return false;}
      const selected=selectPagePhoto(row,page,url);
      if(!selected)return false;
      candidates.push({url:selected.url,source_url:url,caption:selected.caption||page.website_title});
      try{await checkPhoto(selected.url);}catch(error){errors.push(error.message);return false;}
      row.photo_url=selected.url;row.photo_source_url=url;row.photo_credit=new URL(url).hostname.replace(/^www\./,'');
      row.photo_caption=selected.caption||'Foto '+row.name+' dari halaman bisnis / ulasan';
      row.photo_scope='business';row.photo_status='found';row.photo_license='Hak cipta sumber; lihat halaman asal';return true;
    };
    let found=false;
    for(const url of [...new Set(sources)]){try{if(await consider(url)){found=true;break;}}catch(error){errors.push(error.message);}}
    if(!found)try{
      const result=await searchWeb('"'+row.name.replaceAll('"','')+'" Bandung foto coffee shop');
      const pages=result.results.filter(p=>nameMatches(row.name,p.title)&&/bandung/i.test(p.title+' '+p.description+' '+p.url));
      for(const page of pages.slice(0,3)){if(await consider(page.url)){found=true;break;}}
    }catch(error){errors.push(error.message);}
    if(!found)row.photo_status=saved?'found':errors.length?'unavailable':'not_found';
    row.photo_candidates_json=JSON.stringify(candidates);row.photo_lookup_error=errors.join(' | ').slice(0,1200);
  }
  await Promise.all(Array.from({length:Math.min(concurrency,rows.length)},async()=>{while(next<rows.length){const row=rows[next++];try{await processRow(row);}catch(error){row.photo_status=photoFromRow(row)?'found':'unavailable';row.photo_lookup_error=error.message;row.photo_checked_at=now.toISOString();}done++;if(done%25===0)onProgress('Photo lookup '+done+'/'+rows.length);}}));
  return {total:rows.length,found:rows.filter(r=>photoFromRow(r)).length,missing:rows.filter(r=>!photoFromRow(r)).length};
}

export async function enrichPhotoCsv({file='data/scrapes/latest.csv',references,referenceOnly=false,...options}={}) {
  const rows=parseCsv(await readFile(file,'utf8'));if(!rows.length)throw Error('Cannot enrich an empty CSV');
  if(!['source_id','name','latitude','longitude'].every(k=>k in rows[0]))throw Error('CSV is missing location columns');
  references??=JSON.parse(await readFile(new URL('../data/photo-references.json',import.meta.url),'utf8'));
  const now=options.now||new Date();
  const stats=referenceOnly?(applyPhotoReferences(rows,references,{now}),{total:rows.length,found:rows.filter(r=>photoFromRow(r)).length}):await enrichPhotos(rows,{...options,references,now});
  const cols=[...new Set([...Object.keys(rows[0]),...PHOTO_COLUMNS])];
  const csv='\uFEFF'+[cols.join(','),...rows.map(r=>cols.map(k=>cell(r[k],k)).join(','))].join('\r\n')+'\r\n';
  const snapshot=join(dirname(resolve(file)),'coffee-in-bandung-photos-'+now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')+'.csv');
  await writeFile(snapshot+'.tmp',csv);await rename(snapshot+'.tmp',snapshot);
  await writeFile(file+'.tmp',csv);await rename(file+'.tmp',file);
  return {...stats,snapshot,latest:resolve(file)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const args=process.argv.slice(2);if(args.some(a=>a!=='--references-only'))throw Error('Usage: npm run photos:locations -- [--references-only]');console.log(JSON.stringify(await enrichPhotoCsv({referenceOnly:args.includes('--references-only'),onProgress:console.log}),null,2));}
  catch(error){console.error('Photo enrichment failed: '+error.message);process.exitCode=1;}
}
