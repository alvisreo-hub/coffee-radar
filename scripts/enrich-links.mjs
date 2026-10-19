import { instagramUrl, websiteUrl } from '../lib/catalog.mjs';

export const CONTACT_COLUMNS = [
  'instagram_url','instagram_source_url','instagram_confidence',
  'website_source_url','website_confidence','link_lookup_status','link_lookup_error',
  'link_checked_at','link_search_query','link_candidates_json',
];
const IGNORE_HOSTS = /(^|\.)(facebook\.com|tiktok\.com|youtube\.com|tripadvisor\.[a-z.]+|restaurantguru\.com|pergikuliner\.com|google\.[a-z.]+|bing\.com|waze\.com|openstreetmap\.org|wanderlog\.com|foodierate\.com|gofood\.co\.id|grab\.com|pinterest\.[a-z.]+|caribisnis\.id|bdgcafe\.com|idntimes\.com|kompas\.com|detik\.com|traveloka\.com|linktr\.ee)$/i;
const waitDefault = ms => new Promise(r=>setTimeout(r,ms));
const strip = text => String(text||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
function decode(text) {
  return String(text||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}
const key = text => String(text||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const generic = new Set(['coffee','kopi','cafe','coffeeshop','shop','and','the','roastery','coffeenery','bandung','café']);
export function nameMatches(name, text) {
  const tokens = name.toLowerCase().normalize('NFKD').replace(/\p{M}/gu,'').split(/[^a-z0-9]+/).filter(t=>t.length>1&&!generic.has(t));
  if (!tokens.length) return false;
  const haystack=key(text);
  return tokens.every(t=>haystack.includes(t)) && tokens.join('').length>=4;
}

export function parseSearchFeed(xml) {
  if (!/<rss\b|<feed\b/i.test(xml)) throw new Error('Search provider did not return an RSS feed.');
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(m=>{
    const field=name=>decode(m[1].match(new RegExp('<'+name+'[^>]*>([\\s\\S]*?)<\\/'+name+'>','i'))?.[1]||'').trim();
    return {title:strip(field('title')),url:field('link'),description:strip(field('description'))};
  }).filter(x=>/^https?:\/\//i.test(x.url));
}

export function extractInstagramLinks(html, pageUrl) {
  html=html.replace(/\\\//g,'/');
  const found = new Set();
  for (const match of html.matchAll(/(?:href\s*=\s*["']([^"']+)["']|https?:\/\/(?:www\.)?instagram\.com\/[^\s"'<>\\]+)/gi)) {
    let value=decode(match[1]||match[0]).replace(/\\\//g,'/');
    try { value=new URL(value,pageUrl).href; } catch { continue; }
    const profile=instagramUrl(value);if(profile)found.add(profile);
  }
  return [...found];
}

export function extractWebsiteLinks(html, pageUrl) {
  const links=[];
  for(const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;try{url=new URL(decode(m[1]),pageUrl);}catch{continue;}
    if(!['http:','https:'].includes(url.protocol)||instagramUrl(url.href)||IGNORE_HOSTS.test(url.hostname))continue;
    if(url.hostname===new URL(pageUrl).hostname)continue;
    if(/website|official|visit|situs|homepage|https?:|www\./i.test(strip(m[2])))links.push(url.href);
  }
  return [...new Set(links)];
}

export function selectSearchLinks(row, results) {
  const candidates=[];let instagram,website;
  for (const result of results) {
    let url;
    try {url=new URL(result.url);}catch{continue;}
    if (!['http:','https:'].includes(url.protocol)||url.username||url.password)continue;
    const profile=instagramUrl(url.href);
    if(!profile&&IGNORE_HOSTS.test(url.hostname))continue;
    const kind=profile?'instagram':'website';
    // A search hit alone is a candidate, not proof that it is the shop's official account.
    if(!nameMatches(row.name,result.title+' '+url.hostname+' '+(profile||'')))continue;
    const local=/\bbandung\b/i.test(result.title+' '+result.description+' '+url.pathname);
    const candidate={type:kind,url:profile||url.href,title:result.title,source_url:result.url,confidence:local?'search_match':'candidate'};
    if(!candidates.some(c=>c.url===candidate.url))candidates.push(candidate);
    if(local&&profile&&!instagram)instagram=candidate;
    if(local&&!profile&&!website)website=candidate;
  }
  return {instagram,website,candidates:candidates.slice(0,8)};
}

export function createSearchClient({fetchImpl=fetch,wait=waitDefault,apiKey=process.env.BRAVE_SEARCH_API_KEY||'',interval=1200}={}) {
  let next=0;let pausedError;const cache=new Map();
  return async query=>{
    if(pausedError)throw new Error(pausedError);
    if(cache.has(query))return cache.get(query);
    const task=(async()=>{
      const delay=Math.max(0,next-Date.now());next=Math.max(next,Date.now())+interval;await wait(delay);
      const provider=apiKey?'brave_search':'bing_rss';
      const url=apiKey?'https://api.search.brave.com/res/v1/web/search?'+new URLSearchParams({q:query,count:'10',country:'ID'}):
        'https://www.bing.com/search?'+new URLSearchParams({q:query,format:'rss',mkt:'id-ID'});
      const response=await fetchImpl(url,{headers:{'User-Agent':'CoffeeRadar/1.0 (+https://github.com/alvisreo-hub/coffee-radar)',Accept:apiKey?'application/json':'application/rss+xml,application/xml',...(apiKey?{'X-Subscription-Token':apiKey}:{})},signal:AbortSignal.timeout(15000)});
      if(!response.ok){await response.body?.cancel();const message=provider+' returned HTTP '+response.status+'.';if([403,429].includes(response.status))pausedError=message+' Search is paused for this run; retry next schedule or configure BRAVE_SEARCH_API_KEY.';throw new Error(message);}
      const text=await response.text();if(text.length>2000000)throw new Error('Search response exceeded the size limit.');
      const results=apiKey?(JSON.parse(text).web?.results||[]).map(r=>({title:r.title,url:r.url,description:r.description||''})):parseSearchFeed(text);
      return {provider,query,results};
    })();cache.set(query,task);return task;
  };
}

export function preserveContactData(rows, previous=[]) {
  const old=new Map(previous.map(r=>[r.source_id,r]));
  for(const row of rows){const p=old.get(row.source_id);if(!p)continue;
    for(const field of [...CONTACT_COLUMNS,'website','website_title','website_description'])if(!row[field]&&p[field])row[field]=p[field];
  }return rows;
}

export async function enrichContactLinks(rows, {
  searchWeb=createSearchClient(),scrapeWebsite,previousRows=[],now=new Date(),onProgress=()=>{},
  concurrency=3,referenceRows=[],
}={}) {
  preserveContactData(rows,previousRows);
  const siteCache=new Map();let index=0,done=0;
  const stats={total:rows.length,instagram:0,website:0,unresolved:0,failed:0};
  async function inspectSite(row){
    if(!row.website||!scrapeWebsite)return;
    if(!siteCache.has(row.website))siteCache.set(row.website,Promise.resolve(scrapeWebsite(row.website)));
    const details=await siteCache.get(row.website);
    for(const f of ['website_title','website_description','website_scrape_status','website_error'])if(details[f]!==undefined)row[f]=details[f];
    const profiles=(details.instagram_links||[]).filter(p=>nameMatches(row.name,p));
    if(!row.instagram_url&&profiles.length===1){row.instagram_url=profiles[0];row.instagram_source_url=row.website;row.instagram_confidence='website_link';}
  }
  async function enrich(row){
    row.link_lookup_error='';
    row.instagram_url=instagramUrl(row.instagram_url);
    // Some map records put their Instagram profile in the website field.
    const websiteProfile=instagramUrl(row.website);
    if(websiteProfile){if(!row.instagram_url){row.instagram_url=websiteProfile;row.instagram_source_url=row.source_url;row.instagram_confidence='mapped';}row.website='';}
    row.website=websiteUrl(row.website);
    if(row.website&&!row.website_source_url){row.website_source_url=row.source_url;row.website_confidence='mapped';}
    const reference=referenceRows.find(s=>nameMatches(s.name,row.name)&&Math.hypot((Number(s.lat)-row.latitude)*111000,(Number(s.lng)-row.longitude)*110000)<300);
    if(reference?.social&&!row.instagram_url){row.instagram_url=instagramUrl('@'+reference.social);row.instagram_source_url=reference.source;row.instagram_confidence='editorial_reference';}
    if(row.name.startsWith('Kafe tanpa nama')){row.link_lookup_status='insufficient_identity';row.link_checked_at=now.toISOString();return;}
    try{
      await inspectSite(row);
      const recent=row.link_checked_at&&now-new Date(row.link_checked_at)<6*86400000;
      if(!(recent&&(row.website||row.instagram_url))&&(!row.website||!row.instagram_url)){
        const query='"'+row.name.replaceAll('"','')+'" Bandung';
        row.link_search_query=query;
        const result=await searchWeb(query);
        const selected=selectSearchLinks(row,result.results);
        row.link_candidates_json=JSON.stringify(selected.candidates);
        if(!row.instagram_url&&scrapeWebsite){
          const directories=result.results.filter(r=>{try{return /(^|\.)(semuabis\.com|wanderlog\.com|caribisnis\.id|bdgcafe\.com|foodierate\.com|pergikuliner\.com|linktr\.ee)$/.test(new URL(r.url).hostname)&&nameMatches(row.name,r.title)&&/bandung/i.test(r.title+' '+r.description)}catch{return false}}).slice(0,2);
          for(const listing of directories){
            if(!siteCache.has(listing.url))siteCache.set(listing.url,Promise.resolve(scrapeWebsite(listing.url)));
            const page=await siteCache.get(listing.url);
            if(page.website_scrape_status!=='ok'||!nameMatches(row.name,page.website_title))continue;
            const brandName=row.name.split(/\s+x\s+|\s+-\s+/i)[0];
            const profiles=(page.instagram_links||[]).filter(url=>nameMatches(brandName,url));
            if(profiles.length===1){row.instagram_url=profiles[0];row.instagram_source_url=listing.url;row.instagram_confidence='directory_reference';}
            if(!row.website){const sites=(page.website_links||[]).filter(url=>nameMatches(brandName,new URL(url).hostname));if(sites.length===1){row.website=sites[0];row.website_source_url=listing.url;row.website_confidence='directory_reference';await inspectSite(row);}}
            if(row.instagram_url&&row.website)break;
          }
        }
        if(!row.instagram_url&&selected.instagram){row.instagram_url=selected.instagram.url;row.instagram_source_url=selected.instagram.source_url;row.instagram_confidence='search_match';}
        if(!row.website&&selected.website){row.website=selected.website.url;row.website_source_url=selected.website.source_url;row.website_confidence='search_match';await inspectSite(row);}
      }
      row.link_lookup_status=row.website||row.instagram_url?'found':'not_found';
    }catch(error){row.link_lookup_error=error.message;row.link_lookup_status=row.website||row.instagram_url?'partial':'failed';stats.failed++;}
    row.link_checked_at=now.toISOString();
  }
  async function worker(){while(index<rows.length){const row=rows[index++];await enrich(row);done++;
    if(row.instagram_url)stats.instagram++;if(row.website)stats.website++;if(!row.instagram_url&&!row.website)stats.unresolved++;
    if(done%25===0||done===rows.length)onProgress('Contact discovery '+done+'/'+rows.length+': '+stats.instagram+' Instagram, '+stats.website+' websites, '+stats.unresolved+' unresolved.');
  }}
  await Promise.all(Array.from({length:Math.min(concurrency,rows.length)},worker));return stats;
}
