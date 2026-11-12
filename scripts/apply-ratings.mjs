import {readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCsv} from '../lib/catalog.mjs';
export function applyRatingReferences(rows,references){
 const byId=new Map(references.map(r=>[r.source_id,r]));
 for(const row of rows){const ref=byId.get(row.source_id);if(!ref||ref.name!==row.name||ref.address!==(row.address||'')){for(const key of Object.keys(row))if(key.startsWith('rating_'))delete row[key];row.rating_match_status='not_checked';row.rating_note='New or changed identity/address; rating lookup required.';continue;}
  for(const [key,value] of Object.entries(ref))if(key.startsWith('rating_'))row[key]=value;
 }return rows;
}
export function serializeRatingCsv(rows){
 if(!rows.length)throw Error('Refusing empty catalog');
 const columns=[...new Set(rows.flatMap(Object.keys))];
 const cell=(value,key)=>{let s=String(value??'');if(key.startsWith('rating_')&&/^\s*[=+\-@\t\r]/.test(s))s="'"+s;return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
 return '\uFEFF'+[columns.join(','),...rows.map(r=>columns.map(k=>cell(r[k],k)).join(','))].join('\r\n')+'\r\n';
}
export async function applyRatings(file='data/scrapes/latest.csv'){
 const rows=parseCsv(await readFile(file,'utf8'));
 const refs=JSON.parse(await readFile('data/ratings/references.json','utf8'));
 applyRatingReferences(rows,refs);
 const csv=serializeRatingCsv(rows);await writeFile(file+'.tmp',csv);await rename(file+'.tmp',file);
 const counts={};for(const r of rows){const status=r.rating_match_status||'not_checked';counts[status]=(counts[status]||0)+1;}
 return {rows:rows.length,statuses:counts};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(await applyRatings());
