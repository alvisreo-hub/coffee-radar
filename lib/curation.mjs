// Deterministic data curation, separate from human taste recommendations.
export const CURATION_VERSION = '1.0';
export const CURATION_COLUMNS = ['curation_status','curation_categories_json','curation_summary','curation_flags_json','curation_completeness_pct','curation_evidence_json','curation_duplicate_ids_json','curated_at_utc','curation_version'];
const present = value => String(value ?? '').trim();
const named = row => present(row.name) && !/^Kafe tanpa nama\s*·/i.test(row.name);
const key = value => String(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const coordinate = (value,max) => present(value) !== '' && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= max;
const validPoint = row => coordinate(row.latitude,90) && coordinate(row.longitude,180);
const validUrl = value => {try {const u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password;} catch{return false;}};

export function curateRows(rows, {now = new Date()} = {}) {
  const timestamp = now.toISOString();
  const groups = new Map();
  for (const row of rows) if(named(row)&&validPoint(row)) {
    const name=key(row.name); if(!groups.has(name))groups.set(name,[]);groups.get(name).push(row);
  }
  return rows.map(row => {
    const flags=[], categories=['Kopi & kafe'], evidence=[];
    const source=validUrl(row.source_url)?row.source_url:'';
    const add=(label,field)=>{categories.push(label);evidence.push({category:label,field,value:row[field],source_url:source});};
    if(!named(row))flags.push('missing_name');
    if(!validPoint(row))flags.push('invalid_coordinates');
    if(!/^(node|way|relation)\/\d+$/.test(row.source_id||''))flags.push('invalid_source_id');
    if(!validUrl(row.source_url))flags.push('missing_source');
    if(!present(row.address))flags.push('missing_address');
    if(!present(row.opening_hours))flags.push('missing_hours');
    if(!present(row.phone)&&!validUrl(row.website)&&!validUrl(row.instagram_url))flags.push('missing_contact');
    if(!/^Bandung administrative boundary$/.test(row.geographic_scope||''))flags.push('check_geographic_scope');
    if(['failed','partial'].includes(row.link_lookup_status))flags.push('contact_lookup_incomplete');
    if(['candidate','search_match'].includes(row.instagram_confidence)||['candidate','search_match'].includes(row.website_confidence)||row.link_lookup_status==='candidates_only')flags.push('contact_match_needs_review');
    if(row.instagram_confidence==='brand_reference'||row.website_confidence==='brand_reference')flags.push('shared_brand_contact');
    if(['failed','error','blocked'].includes(row.website_scrape_status))flags.push('website_unavailable');
    if(['yes','wlan'].includes(row.internet_access))add('Wi-Fi tercatat','internet_access');
    if(row.outdoor_seating==='yes')add('Area luar tercatat','outdoor_seating');
    if(row.wheelchair==='yes')add('Akses kursi roda tercatat','wheelchair');
    if(present(row.opening_hours))add('Jam buka tersedia','opening_hours');
    if(validUrl(row.website))add('Website tersedia','website');
    if(validUrl(row.instagram_url))add('Instagram tersedia','instagram_url');
    const duplicates=named(row)&&validPoint(row)?(groups.get(key(row.name))||[]).filter(other=>other!==row&&
      (other.source_id===row.source_id||Math.hypot((Number(row.latitude)-Number(other.latitude))*111000,(Number(row.longitude)-Number(other.longitude))*110000)<50)).map(other=>other.source_id):[];
    if(duplicates.length)flags.push('possible_duplicate');
    const review=flags.some(f=>['missing_name','invalid_coordinates','invalid_source_id','missing_source','check_geographic_scope','possible_duplicate','contact_match_needs_review'].includes(f));
    // Completeness measures availability of six factual fields, never taste or popularity.
    const facts=[named(row),validPoint(row),present(row.address),present(row.opening_hours),present(row.phone),validUrl(row.website)||validUrl(row.instagram_url)];
    const pct=Math.round(facts.filter(Boolean).length/facts.length*100);
    const useful=categories.slice(1).map(s=>s.toLocaleLowerCase('id-ID'));
    const summary=(named(row)?row.name:'Kafe dengan nama belum tercatat')+' · '+(row.neighborhood||row.city||'Bandung')+'. '+
      (useful.length?useful.join('; ')+'. ':'Lokasi tercatat di sumber komunitas. ')+
      (review?'Perlu peninjauan identitas, kecocokan kontak, atau cakupan lokasi. ':'Dikelompokkan berdasarkan fakta yang tercatat. ')+
      'Rasa, menu terlaris, dan kondisi terkini belum dinilai.';
    return {...row,curation_status:review?'needs_review':'listed',curation_categories_json:JSON.stringify(categories),
      curation_summary:summary,curation_flags_json:JSON.stringify(flags),curation_completeness_pct:pct,
      curation_evidence_json:JSON.stringify(evidence),curation_duplicate_ids_json:JSON.stringify([...new Set(duplicates)]),
      curated_at_utc:timestamp,curation_version:CURATION_VERSION};
  });
}
