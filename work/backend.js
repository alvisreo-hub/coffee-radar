const SOURCES = [
 {id:'djawa',name:'Kopi Toko Djawa',url:'https://citour.id/destinations/kopi-toko-djawa-braga-kSSgbjkf'},
 {id:'sawo',name:'Sawo Coffee & Roastery',url:'https://www.archdaily.com/945628/sawo-coffee-and-roastery-oi-architect'},
 {id:'sejiwa',name:'Sejiwa Coffee',url:'https://linktr.ee/sejiwacoffee'},
 {id:'thf',name:'Two Hands Full',url:'https://thfcoffee.com/pages/about-us'}
];
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const headers={'User-Agent':'CoffeeRadar/1.0 (catalog metadata; respects robots.txt)','Accept':'text/html,application/json,text/plain;q=0.8'};
export function robotsAllows(text,path){
 const groups=[];let group=null;let hadRules=false;
 for(const raw of text.split(/\r?\n/)){const line=raw.split('#')[0].trim(),i=line.indexOf(':');if(i<0)continue;const key=line.slice(0,i).trim().toLowerCase(),v=line.slice(i+1).trim();if(key==='user-agent'){if(!group||hadRules){group={agents:[],rules:[]};groups.push(group);hadRules=false}group.agents.push(v.toLowerCase())}else if(group&&(key==='allow'||key==='disallow')){hadRules=true;if(v)group.rules.push({allow:key==='allow',pattern:v})}}
 const exact=groups.filter(g=>g.agents.some(a=>a!=='*'&&'coffeeradar'.includes(a)));const relevant=exact.length?exact:groups.filter(g=>g.agents.includes('*'));let winner=null;
 for(const g of relevant)for(const r of g.rules){let p=r.pattern;const end=p.endsWith('$');if(end)p=p.slice(0,-1);const expression='^'+p.split('*').map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+(end?'$':'');if(new RegExp(expression).test(path)&&(!winner||r.pattern.length>winner.pattern.length||r.pattern.length===winner.pattern.length&&r.allow))winner=r}
 return winner?winner.allow:true;
}
async function textLimited(response,max=600000){if(!response.body)return '';const reader=response.body.getReader();const chunks=[];let size=0;try{while(true){let {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new Error('Halaman terlalu besar untuk penelusuran metadata.')}chunks.push(value)}}finally{reader.releaseLock()}let bytes=new Uint8Array(size),offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}return new TextDecoder().decode(bytes)}
async function fetchSource(url,host){let current=new URL(url);for(let i=0;i<3;i++){if(!['https:'].includes(current.protocol)||current.hostname.replace(/^www\./,'')!==host.replace(/^www\./,''))throw new Error('Pengalihan keluar domain sumber tidak diikuti.');const r=await fetch(current,{headers,redirect:'manual',signal:AbortSignal.timeout(8500)});if([301,302,303,307,308].includes(r.status)){const location=r.headers.get('location');if(!location)throw new Error('Pengalihan tidak valid.');current=new URL(location,current);await r.body?.cancel();continue}return r}throw new Error('Terlalu banyak pengalihan sumber.')}
const decode=s=>s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>{let v=Number(n);return v<=0x10ffff?String.fromCodePoint(v):''}).replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
export function metadata(html){let title=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'';let description='';for(const match of html.matchAll(/<meta\b[^>]*>/gi)){const tag=match[0];if(/(?:name|property)\s*=\s*["'](?:description|og:description)["']/i.test(tag)){const content=tag.match(/content\s*=\s*(["'])([\s\S]*?)\1/i);if(content){description=content[2];break}}}return {title:decode(title).slice(0,180),description:decode(description).slice(0,240)}}
async function crawlOne(source){try{const u=new URL(source.url);const robots=await fetchSource(u.origin+'/robots.txt',u.hostname);if(robots.status!==404){if(!robots.ok)throw new Error('robots.txt tidak dapat diperiksa (HTTP '+robots.status+').');const text=await textLimited(robots,150000);if(!robotsAllows(text,u.pathname))throw new Error('Sumber melarang crawler melalui robots.txt.')}let r=await fetchSource(source.url,u.hostname);if(!r.ok)throw new Error('Sumber merespons HTTP '+r.status+'.');const type=r.headers.get('content-type')||'';if(!type.includes('text/html'))throw new Error('Sumber tidak mengembalikan halaman HTML.');const m=metadata(await textLimited(r));return {name:source.name,url:source.url,ok:true,...m,fetchedAt:new Date().toISOString()}}catch(e){return {name:source.name,url:source.url,ok:false,error:e.message,fetchedAt:new Date().toISOString()}}}
export function normalizeOSM(elements){return elements.filter(e=>e.tags?.name&&Number.isFinite(e.lat??e.center?.lat)&&Number.isFinite(e.lon??e.center?.lon)).map(e=>{const t=e.tags,lat=e.lat??e.center.lat,lng=e.lon??e.center.lon;return {id:'osm-'+e.type+'-'+e.id,name:t.name.slice(0,150),area:'Bandung',address:[t['addr:street'],t['addr:housenumber'],t['addr:suburb']].filter(Boolean).join(' ')||'Bandung — alamat rinci perlu dikonfirmasi',tags:['Data komunitas',...(t.outdoor_seating==='yes'?['Area luar']:[]),...(t.internet_access==='wlan'?['Wi-Fi tercatat']:[])],menu:'Menu belum tersedia',note:'Ditemukan di OpenStreetMap. Informasi berasal dari kontributor komunitas dan belum ditinjau kurator.',reason:'Belum direkomendasikan oleh kurator. Periksa nama, cabang, fasilitas, dan lokasi sebelum berkunjung.',category:'unreviewed',uncurated:true,source:'https://www.openstreetmap.org/'+e.type+'/'+e.id,sourceName:'OpenStreetMap',rating:null,reviews:null,lat,lng,importedAt:new Date().toISOString()}})}
async function cachedJSON(request,ttl,produce){const cache=globalThis.caches?.default;const key=new Request(new URL(request.url).origin+new URL(request.url).pathname,{method:'GET'});if(cache){const hit=await cache.match(key);if(hit)return hit}const data=await produce();const response=json(data);response.headers.set('Cache-Control','private, max-age=0');if(cache){const copy=json(data);copy.headers.set('Cache-Control','public, max-age='+ttl);await cache.put(key,copy)}return response}
const CATALOG_CSV_URL = 'https://raw.githubusercontent.com/alvisreo-hub/coffee-radar/main/data/scrapes/latest.csv';
let catalogMemory;
let catalogLoading;
export async function fetchCsvCatalog(fetchImpl = fetch) {
 const response = await fetchImpl(CATALOG_CSV_URL, {signal:AbortSignal.timeout(10000),headers:{Accept:'text/csv,text/plain'},cf:{cacheTtl:600,cacheEverything:true}});
 if (!response.ok) throw new Error('CSV source returned HTTP ' + response.status);
 const csv = await textLimited(response, 64000000);
 const catalog = catalogFromCsv(SEED, csv);
 if (!catalog.csvRowCount) throw new Error('CSV source has no valid locations.');
 return {...catalog,csv,sourceStatus:'live_csv',city:'Bandung',reviewedAt:'2026-10-19'};
}
async function getCsvCatalog(env = {}) {
 if (env.CATALOG_OFFLINE) return {...BUNDLED_CATALOG,csv:BUNDLED_CSV,sourceStatus:'bundled_csv',city:'Bandung',reviewedAt:'2026-10-19'};
 if (catalogMemory?.expiresAt > Date.now()) return catalogMemory.data;
 if (catalogLoading) return catalogLoading;
 catalogLoading = (async()=>{
  try {
   const data = await fetchCsvCatalog();
   catalogMemory={data,expiresAt:Date.now()+600000};return data;
  } catch {
   const data={...(catalogMemory?.data||BUNDLED_CATALOG),csv:catalogMemory?.data?.csv||BUNDLED_CSV,sourceStatus:'bundled_csv',warning:'Sumber CSV belum dapat dihubungi. Menampilkan salinan terakhir yang tersedia.',city:'Bandung',reviewedAt:'2026-10-19'};
   catalogMemory={data,expiresAt:Date.now()+60000};return data;
  } finally {catalogLoading=null;}
 })();
 return catalogLoading;
}

const SECURITY={'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self'; img-src 'self' https://images.unsplash.com data:; connect-src 'self'; frame-src https://www.openstreetmap.org; object-src 'none'; base-uri 'none'; form-action 'self'"};
export default {async fetch(request,env={}){const url=new URL(request.url),path=url.pathname;try{
 if(path.startsWith('/api/')){
  if(request.method==='OPTIONS')return new Response(null,{status:204});
  if(path==='/api/status'&&request.method==='GET')return json({google:Boolean(env.GOOGLE_PLACES_API_KEY),instagram:false,tiktok:false,osm:true,web:true});
  if(path==='/api/catalog'&&request.method==='GET'){const {csv,...catalog}=await getCsvCatalog(env);return json(catalog);}
  if(path==='/api/catalog.csv'&&request.method==='GET'){const catalog=await getCsvCatalog(env);return new Response(catalog.csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename=coffee-in-bandung.csv','Cache-Control':'no-store','X-Catalog-Source':catalog.sourceStatus}});}
  if(request.method!=='POST')return json({error:'Metode tidak didukung.'},405);
  const origin=request.headers.get('Origin');if(origin&&origin!==url.origin)return json({error:'Permintaan harus berasal dari aplikasi ini.'},403);
  if(!(request.headers.get('content-type')||'').includes('application/json'))return json({error:'Gunakan permintaan JSON.'},415);
  const bodyText=await request.text();if(bodyText.length>1000)return json({error:'Permintaan terlalu besar.'},413);let body;try{body=JSON.parse(bodyText)}catch{return json({error:'JSON tidak valid.'},400)}
  if(path==='/api/crawl')return await cachedJSON(request,21600,async()=>({results:await Promise.all(SOURCES.map(crawlOne)),provider:'public-web',checkedAt:new Date().toISOString()}));
  if(path==='/api/discover'){
   if(body.city!=='Bandung')return json({error:'Saat ini penemuan hanya tersedia untuk Bandung.'},400);
   const {csv,...catalog}=await getCsvCatalog(env);return json({...catalog,provider:'OpenStreetMap CSV'});
  }
  if(path==='/api/google'){
   if(!env.GOOGLE_PLACES_API_KEY)return json({error:'Google Places belum terhubung. Tambahkan GOOGLE_PLACES_API_KEY sebagai secret runtime hosting.'},503);
   if(body.city!=='Bandung')return json({error:'Pencarian hanya tersedia untuk Bandung.'},400);
   const r=await fetch('https://places.googleapis.com/v1/places:searchText',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':env.GOOGLE_PLACES_API_KEY,'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.googleMapsUri,places.attributions'},body:JSON.stringify({textQuery:'coffee shop in Bandung Indonesia',languageCode:'id',maxResultCount:10}),signal:AbortSignal.timeout(15000)});
   if(!r.ok)return json({error:'Google Places belum dapat diakses. Periksa status API, pembatasan key, kuota, dan billing di akun Google Cloud.'},502);
   const d=await r.json();return json({places:d.places||[],provider:'Google Maps',fetchedAt:new Date().toISOString()});
  }
  return json({error:'Endpoint tidak ditemukan.'},404);
 }
 if(ASSETS[path]&&(request.method==='GET'||request.method==='HEAD')){const a=ASSETS[path];const bytes=Uint8Array.from(atob(a.data),c=>c.charCodeAt(0));return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':a.type,'Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}})}
 if(path==='/favicon.ico')return new Response(null,{status:204});
 if(path!=='/')return new Response('Halaman tidak ditemukan',{status:404});
 if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405});
 return new Response(request.method==='HEAD'?null:HTML,{headers:SECURITY});
 }catch(e){return json({error:e.name==='TimeoutError'?'Sumber melewati batas waktu. Coba lagi nanti.':e.message||'Terjadi kendala pengambilan data.'},502)}}};
