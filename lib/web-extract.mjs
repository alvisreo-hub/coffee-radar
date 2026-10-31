import {websiteUrl} from './catalog.mjs';
export function structuredPlaces(html,url){
 const output=[];function visit(v){if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(visit);return;}
 if([].concat(v['@type']||[]).some(t=>['CafeOrCoffeeShop','CoffeeShop'].includes(t))&&v.name&&v.address&&/bandung/i.test(JSON.stringify(v.address))){const a=v.address;output.push({name:String(v.name),address:typeof a==='string'?a:[a.streetAddress,a.addressLocality,a.postalCode].filter(Boolean).join(', '),source_url:url,website:websiteUrl(v.url||''),latitude:v.geo?.latitude??'',longitude:v.geo?.longitude??'',published_at:''});}
 Object.values(v).forEach(x=>{if(typeof x==='object')visit(x)});}
 for(const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try{visit(JSON.parse(m[1]));}catch{}
 return output;
}
