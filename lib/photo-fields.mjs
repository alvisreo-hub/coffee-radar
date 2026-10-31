export const PHOTO_COLUMNS=['photo_url','photo_source_url','photo_credit','photo_caption','photo_scope','photo_status','photo_license','photo_checked_at','photo_lookup_error','photo_candidates_json'];
export function preservePhotoData(rows,previous) {
  const old=new Map(previous.map(r=>[r.source_id,r]));
  for(const row of rows){const p=old.get(row.source_id);if(!p||p.name!==row.name)continue;
    for(const field of PHOTO_COLUMNS)if(p[field]&&!row[field])row[field]=p[field];
  }return rows;
}
