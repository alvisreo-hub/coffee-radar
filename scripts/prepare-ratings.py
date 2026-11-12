"""Extract conservative rating candidates from retained per-location search evidence.
Research responses remain ignored scratch; only factual ratings/provenance are exported.
"""
import csv,json,re,hashlib
from pathlib import Path
from datetime import datetime,timezone

GENERIC={'coffee','kopi','cafe','kafe','shop','coffeeshop','and','the','roastery','bandung','resto','restaurant','café','brew'}
HOSTS={'wanderlog.com','restaurantguru.com','caribisnis.id','docentpro.com','foodeist.com','tripadvisor.com','tripadvisor.co.id','tripadvisor.ca','trip.com'}

def key(value):return re.sub('[^a-z0-9]','',str(value).lower())
def count(value):
 if not value:return ''
 cleaned=re.sub(r'[.,\s]','',value)
 return int(cleaned) if cleaned.isdigit() else ''

def name_match(name,title):
 if key(name) in {'art','bean','coffee','kopi','cafe','kafe','warkop'}:return False
 tokens=[t for t in re.findall(r'[a-z0-9]+',name.lower()) if t not in GENERIC]
 return bool(tokens) and (len(''.join(tokens))>=4 or any(t.isdigit() and len(t)>=3 for t in tokens)) and all(t in key(title) for t in tokens)

def address_match(address,text):
 # Match the first sourced street, not a generic city/province or a neighboring landmark.
 street=re.split(r',',address)[0].lower()
 tokens=[t for t in re.findall(r'[a-z0-9]+',street) if t not in {'jl','jln','jalan','no','nomor','raya','rt','rw','i','ii','iii'}]
 words=[t for t in tokens if len(t)>=4 and not t.isdigit() and t not in {'bandung','jawa','barat','indonesia','kota','kabupaten'}]
 digits=re.findall(r'\b\d+[a-z]?\b',street)
 return bool(words) and all(t in key(text) for t in words) and all(re.search(r'(?<!\d)'+re.escape(n)+r'(?!\d)',text,re.I) for n in digits)

def score(block,host):
 patterns=[]
 if host=='restaurantguru.com':
  patterns=[('Google',r'Google\s*\(\s*([0-5][.,]\d)\s*/\s*5\s*\)\s*([\d,.]+)?'),('Tripadvisor',r'Trip(?:A|a)dvisor\s*\(\s*([0-5][.,]\d)\s*/\s*5\s*\)\s*([\d,.]+)?')]
 elif host=='caribisnis.id':
  m=re.search(r'([\d.]+)\s+Ulasan,\s*Rating\s*([0-5][.,]\d)\s*[★⭐]',block,re.I)
  if m:return float(m[2].replace(',','.')),count(m[1]),'CariBisnis',m[0]
 elif host=='wanderlog.com':
  m=re.search(r'(?:Review score|Skor ulasan)\s*([0-5][.,]\d)\s*(?:out of|dari)\s*5\s*(?:[^\n]*\n?){0,3}?\s*([\d,.]+)\s*(?:reviews|ulasan)\s*(?:From|Dari)\s*(Google|Tripadvisor)',block,re.I)
  if m:return float(m[1].replace(',','.')),count(m[2]),m[3],re.sub(r'\s+',' ',m[0])
 if not patterns:
  patterns=[(host,r'\b([0-5][.,]\d)\s*\(\s*([\d,.]+)\s*(?:reviews|ulasan)\s*\)'),(host,r'\b([0-5][.,]\d)\s*/\s*5\s*[·•]?\s*([\d,.]+)\s*(?:reviews|ulasan|votes)')]
 for platform,pattern in patterns:
  m=re.search(pattern,block,re.I)
  if m:return float(m[1].replace(',','.')),count(m[2]),platform,m[0]
 return None

def extract(record):
 from urllib.parse import urlparse
 candidates=[]
 for block in re.split(r'\n-{20,}\n',re.sub(r'(?m)^L\d+:\s?', '', record.get('text',''))):
  first=block.splitlines()[0] if block else ''
  m=re.match(r'(.+)\s+\((https?://[^\s]+)\)$',first)
  if not m:continue
  title,url=m.groups();host=urlparse(url).hostname.removeprefix('www.')
  if host not in HOSTS or not name_match(record['shop']['name'],title):continue
  if re.search(r'\btop\s*\d+|\bbest\b|\bterbaik\b|\bnear\b|\bnearby\b',title,re.I):continue
  if not re.search('bandung',block,re.I):continue
  result=score(block,host)
  if not result or not 0<result[0]<=5:continue
  rating,reviews,platform,evidence=result
  # Match addresses only in listing text before any individual review section.
  listing=re.split(r"Visitors' reviews|Highlighted reviews|Ulasan yang disorot|PROS CONS|Highlights from Reviews",block,flags=re.I)[0]
  freshness=re.search(r'Crawled: ([^;\n]+)',block)
  conflict=platform.lower()=='google' and any(float(m.replace(',','.'))!=rating for m in re.findall(r'Google (?:gives (?:it|this place)|rating (?:is|of))\s*([0-5][.,]\d)',block,re.I))
  candidates.append({'source_index_context':freshness[1] if freshness else '', 'source_internal_conflict':conflict,'source_reports_closed':bool(re.search('permanently closed',listing,re.I)), 'value':rating,'scale':5,'review_count':reviews,'platform':platform,'source_url':url,'source_name':host,'source_title':title,'match_status':'address_matched' if address_match(record['shop'].get('address',''),listing) else 'business_match_branch_unverified','evidence':evidence[:180]})
 # Pick an address-matched listing first; prefer explicit Google aggregate where available.
 unique={ (c['source_url'],c['platform']):c for c in candidates }
 return sorted(unique.values(),key=lambda c:(c['match_status']!='address_matched',c['platform'].lower()!='google'))

COLUMNS=['source_id','name','address','rating_value','rating_scale','rating_review_count','rating_platform','rating_source_url','rating_source_name','rating_match_status','rating_checked_at','rating_search_query','rating_candidates_json','rating_note','rating_candidate_value','rating_candidate_review_count','rating_candidate_platform','rating_candidate_source_url','rating_candidate_source_name']

def prepare():
 now=datetime.now(timezone.utc).isoformat();records=[]
 for f in sorted(Path('work/rating-search').glob('batch-*.json')):records.extend(json.loads(f.read_text()))
 for f in sorted(Path('work/rating-search').glob('retry-*.json')):
  if f.name=='retry-plan.json':continue
  records.extend(json.loads(f.read_text()))
 combined={}
 for r in records:
  sid=r['shop']['source_id']
  if sid in combined:
   combined[sid]['text']+='\n'+'-'*80+'\n'+r.get('text','')
   combined[sid]['query']=combined[sid].get('query','')+' | '+r.get('query','')
  else:combined[sid]=dict(r)
 rows=[]
 for record in combined.values():
  shop=record['shop'];candidates=extract(record);best=next((c for c in candidates if c['match_status']=='address_matched' and not c.get('source_internal_conflict')),None)
  row={k:'' for k in COLUMNS};row.update(source_id=shop['source_id'],name=shop['name'],address=shop.get('address',''),rating_checked_at=now,rating_search_query=record.get('query',''),rating_candidates_json=json.dumps(candidates,ensure_ascii=False))
  row['rating_match_status']='address_matched' if best else 'needs_branch_review' if candidates else record['status'] if record['status']!='searched' else 'not_found'
  row['rating_note']='Rating as reported by cited directory/search index; source update date unknown. Not a live Google Places fetch.' if best else 'Candidate scores are kept separate because branch identity is unverified.' if candidates else 'No reliable matching aggregate rating found in this search.'
  if candidates:
   candidate=candidates[0]
   row.update(rating_candidate_value=candidate['value'],rating_candidate_review_count=candidate['review_count'],rating_candidate_platform=candidate['platform'],rating_candidate_source_url=candidate['source_url'],rating_candidate_source_name=candidate['source_name'])
  if best:
   for field,target in [('value','rating_value'),('scale','rating_scale'),('review_count','rating_review_count'),('platform','rating_platform'),('source_url','rating_source_url'),('source_name','rating_source_name')]:row[target]=best[field]
  rows.append(row)
 Path('data/ratings/references.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
 with Path('data/ratings/catalog-ratings.csv').open('w',encoding='utf-8-sig',newline='') as f:
  writer=csv.DictWriter(f,fieldnames=COLUMNS);writer.writeheader();writer.writerows({k:("'"+str(v) if isinstance(v,str) and re.match(r'^\s*[=+\-@]',v) else v) for k,v in r.items()} for r in rows)
 statuses={s:sum(r['rating_match_status']==s for r in rows) for s in sorted(set(r['rating_match_status'] for r in rows))}
 print(json.dumps({'processed':len(rows),'status':statuses,'candidates':sum(len(json.loads(r['rating_candidates_json'])) for r in rows)},indent=2))
if __name__=='__main__':prepare()
