import {readFile,writeFile,rename,appendFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCsv} from '../lib/catalog.mjs';
import {curateRows,CURATION_COLUMNS} from '../lib/curation.mjs';

function cell(value) {
  // Existing CSV text is already spreadsheet-safe. Preserve it byte-for-byte.
  const text=String(value??'');
  return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;
}
export async function curateCsv({file='data/scrapes/latest.csv',now=new Date()}={}) {
  const rows=parseCsv(await readFile(file,'utf8'));
  if(!rows.length)throw new Error('Refusing to curate an empty dataset.');
  if(!['name','source_id','latitude','longitude','scraped_at_utc'].every(k=>k in rows[0]))throw new Error('CSV is missing location columns; original files preserved.');
  const curated=curateRows(rows,{now});
  const columns=[...new Set([...Object.keys(rows[0]),...CURATION_COLUMNS])];
  const csv='\uFEFF'+[columns.join(','),...curated.map(row=>columns.map(k=>cell(row[k])).join(','))].join('\r\n')+'\r\n';
  const snapshot=join(dirname(resolve(file)),'coffee-in-bandung-curated-'+now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')+'.csv');
  // Write a complete curated snapshot first; latest never points to partial output.
  await writeFile(snapshot+'.tmp',csv);await rename(snapshot+'.tmp',snapshot);
  await writeFile(file+'.tmp',csv);await rename(file+'.tmp',file);
  return {rowCount:curated.length,listed:curated.filter(r=>r.curation_status==='listed').length,
    needsReview:curated.filter(r=>r.curation_status==='needs_review').length,snapshot,latest:resolve(file)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2);
    if(args.length&&!(args.length===2&&args[0]==='--file'))throw new Error('Usage: npm run curate:locations -- [--file data/scrapes/latest.csv]');
    const result=await curateCsv({file:args[1]});console.log(JSON.stringify(result,null,2));
    if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`\n## CSV curation\n\nAssessed all ${result.rowCount} rows: ${result.listed} listed, ${result.needsReview} need review. No rows removed. Scores measure data completeness, not coffee quality.\n`);
  } catch(error) {console.error('Curation failed: '+error.message);process.exitCode=1;}
}
