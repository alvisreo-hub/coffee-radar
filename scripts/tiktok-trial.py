"""Small, bounded public-hashtag trial. No login, proxy rotation or CAPTCHA solving."""
import argparse
import asyncio
import csv
import importlib.metadata
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

FIELDS = ['video_id', 'video_url', 'author', 'caption', 'published_at', 'views', 'likes', 'comments', 'shares', 'hashtag', 'observed_at', 'status']


def normalize_video(data, hashtag, observed_at):
    video_id = str(data.get('id', ''))
    author = (data.get('author') or {}).get('uniqueId', '')
    if not re.fullmatch(r'\d+', video_id) or not re.fullmatch(r'[\w.]+', author):
        return None
    published = ''
    try:
        if data.get('createTime'):
            published = datetime.fromtimestamp(int(data['createTime']), timezone.utc).isoformat()
    except (ValueError, TypeError, OverflowError, OSError):
        pass
    stats = data.get('stats') or {}
    metric = lambda key: stats[key] if isinstance(stats.get(key), int) and not isinstance(stats[key], bool) and stats[key] >= 0 else ''
    return dict(zip(FIELDS, [video_id, f'https://www.tiktok.com/@{author}/video/{video_id}', author,
        data.get('desc', ''), published, metric('playCount'), metric('diggCount'), metric('commentCount'),
        metric('shareCount'), hashtag, observed_at, 'discovery_lead_needs_shop_and_address_review']))


def safe_cell(value):
    if isinstance(value, str) and re.match(r'^\s*[=+\-@\t\r]', value):
        return "'" + value
    return value


async def trial(args):
    from TikTokApi import TikTokApi
    logging.disable(logging.CRITICAL)  # Third-party debug logs may contain session material.
    now = datetime.now(timezone.utc)
    report = {'library': 'TikTokApi', 'version': importlib.metadata.version('TikTokApi'),
        'started_at': now.isoformat(), 'hashtags': args.hashtag, 'max_per_hashtag': args.count,
        'status': 'started', 'phase': 'session', 'video_count': 0, 'tag_results': []}
    rows = {}
    policy_file = Path('/etc/codex/network-policy.json')
    allowed = None
    if policy_file.exists():
        policy = json.loads(policy_file.read_text()).get('http_network_policy', {})
        if policy.get('type') == 'restricted':
            hosts = {r.get('host') for r in policy.get('egress_rules', [])}
            allowed = 'www.tiktok.com' in hosts
    report['environment_allows_tiktok'] = allowed
    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
    proxies = None
    if proxy:
        p = urlsplit(proxy)
        config = {'server': f'{p.scheme}://{p.hostname}:{p.port or 8080}'}
        if p.username:
            config.update(username=p.username, password=p.password or '')
        proxies = [config]  # Preserve environment egress; never rotate or bypass it.

    async def page_factory(context):
        report['phase'] = 'browser_page'
        page = await context.new_page()
        report['phase'] = 'landing_page'
        response = await page.goto('https://www.tiktok.com', timeout=20000, wait_until='domcontentloaded')
        if response and response.status >= 400:
            report['navigation_http_status'] = response.status
            raise RuntimeError('TikTok landing page unavailable')
        return page

    try:
        async with asyncio.timeout(100):
            async with TikTokApi() as api:
                await api.create_sessions(num_sessions=1, browser='chromium', executable_path=args.browser,
                    headless=True, proxies=proxies, page_factory=page_factory, sleep_after=3,
                    enable_session_recovery=False, timeout=20000)
                if allowed is False:
                    report['status'] = 'environment_network_blocked'
                else:
                    report['phase'] = 'hashtag_videos'
                    for tag in args.hashtag:
                        found = 0
                        try:
                            async with asyncio.timeout(30):
                                async for video in api.hashtag(name=tag).videos(count=args.count):
                                    row = normalize_video(video.as_dict, tag, now.isoformat())
                                    if row:
                                        rows[row['video_id']] = row
                                        found += 1
                                    if found >= args.count:
                                        break
                            report['tag_results'].append({'hashtag': tag, 'status': 'ok' if found else 'empty', 'videos': found})
                        except Exception as error:
                            report['tag_results'].append({'hashtag': tag, 'status': 'failed', 'error_type': type(error).__name__, 'videos': found})
                    report['status'] = 'success' if rows else 'no_videos_returned'
    except Exception as error:
        report['status'] = 'environment_network_blocked' if allowed is False else 'session_or_provider_failed'
        report['error_type'] = type(error).__name__
        code = re.search(r'net::[A-Z_]+', str(error))
        if code:
            report['network_error_code'] = code.group(0)
    report['video_count'] = len(rows)
    report['finished_at'] = datetime.now(timezone.utc).isoformat()
    report['note'] = ('Environment policy does not allow www.tiktok.com; this result cannot assess TikTok anti-bot behavior.'
                      if allowed is False else 'No account login or access-block bypass attempted. A hashtag mention does not prove a shop address or viral ranking.')
    directory = Path(args.output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    stamp = now.strftime('%Y%m%dT%H%M%SZ')
    csv_path = directory / f'tiktok-trial-{stamp}.csv'
    with csv_path.open('w', encoding='utf-8-sig', newline='') as file:
        writer = csv.DictWriter(file, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows({k: safe_cell(v) for k, v in row.items()} for row in rows.values())
    report['csv_file'] = csv_path.name
    report_path = directory / f'tiktok-trial-{stamp}.json'
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--hashtag', action='append', default=None)
    parser.add_argument('--count', type=int, default=5)
    parser.add_argument('--browser', default=None, help='Optional installed Chromium path')
    parser.add_argument('--output-dir', default='data/tiktok-trial')
    args = parser.parse_args()
    args.hashtag = args.hashtag or ['coffeeshopbandung', 'cafebandung', 'kopibandung']
    if not 1 <= args.count <= 30 or any(not re.fullmatch(r'[A-Za-z0-9_]+', t) for t in args.hashtag):
        parser.error('Use plain hashtag names and count 1..30 for this trial')
    asyncio.run(trial(args))
