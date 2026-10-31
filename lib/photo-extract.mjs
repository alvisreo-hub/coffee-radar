import {photoUrl} from './catalog.mjs';
const decode=s=>String(s||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\\\//g,'/');
export function extractPhotoCandidates(html,pageUrl) {
  const found=[];
  const add=(value,caption='',kind='image')=>{
    if(typeof value!=='string'||!value.trim())return;
    let url;try{url=photoUrl(new URL(decode(value),pageUrl).href);}catch{return;}
    if(!url||found.some(p=>p.url===url))return;
    if(/logo|avatar|icon|favicon|placeholder|banner[-_]ad|tracking|pixel/i.test(value+' '+caption))return;
    found.push({url,caption:decode(caption).replace(/<[^>]*>/g,'').slice(0,250),kind});
  };
  for(const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs=Object.fromEntries([...tag[0].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1].toLowerCase(),decode(m[2])]));
    if(['og:image','og:image:url','twitter:image'].includes(attrs.property||attrs.name))add(attrs.content,'','social_preview');
  }
  for(const tag of html.matchAll(/<img\b[^>]*>/gi)) {
    const attrs=Object.fromEntries([...tag[0].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1].toLowerCase(),decode(m[2])]));
    if(attrs.width&&Number(attrs.width)<300||attrs.height&&Number(attrs.height)<180)continue;
    add(attrs['data-src']||attrs.src,attrs.alt||'','inline');
  }
  return found.slice(0,20);
}

