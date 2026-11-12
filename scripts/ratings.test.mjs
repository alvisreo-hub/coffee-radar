import test from 'node:test';import assert from 'node:assert/strict';
import {applyRatingReferences,serializeRatingCsv} from './apply-ratings.mjs';
import {parseCsv} from '../lib/catalog.mjs';
test('rating references require source ID, identity, and address; refreshed times are never fabricated',()=>{
 const ref={source_id:'node/1',name:'Kopi',address:'Jalan A',rating_value:4.5,rating_checked_at:'2026-11-12T00:00:00Z'};
 const rows=[{source_id:'node/1',name:'Kopi',address:'Jalan A'},{source_id:'node/2',name:'Kopi',address:'Jalan A'},{source_id:'node/1',name:'Kopi',address:'Jalan B'}];
 applyRatingReferences(rows,[ref]);assert.equal(rows[0].rating_value,4.5);assert.equal(rows[0].rating_checked_at,ref.rating_checked_at);assert.equal(rows[1].rating_value,undefined);assert.equal(rows[2].rating_value,undefined);
});
test('CSV preserves every original value including negative coordinates, apostrophe-safe phone and multiline text',()=>{
 const row={latitude:'-6.9',longitude:'107.6',phone:"'+6222",description:'line1\nline2, "quoted"',rating_value:4.8,rating_note:'=UNSAFE'};
 const data=parseCsv(serializeRatingCsv([row]));for(const key of ['latitude','longitude','phone','description'])assert.equal(data[0][key],row[key]);assert.equal(data[0].rating_note,"'=UNSAFE");assert.throws(()=>serializeRatingCsv([]),/empty/);
});
