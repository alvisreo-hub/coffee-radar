import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('tiktok_trial', Path(__file__).with_name('tiktok-trial.py'))
trial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trial)


class TrialTests(unittest.TestCase):
    def test_real_metrics_preserve_zero_and_missing_stays_unknown(self):
        row = trial.normalize_video({'id': '123', 'author': {'uniqueId': 'reviewer.bdg'}, 'desc': 'Kopi', 'createTime': 1600000000, 'stats': {'playCount': 0, 'diggCount': 12}}, 'kopibandung', 'now')
        self.assertEqual(row['views'], 0)
        self.assertEqual(row['likes'], 12)
        self.assertEqual(row['shares'], '')
        self.assertTrue(row['published_at'].startswith('2020-09-13'))
        self.assertEqual(row['video_url'], 'https://www.tiktok.com/@reviewer.bdg/video/123')
        self.assertIn('needs_shop_and_address_review', row['status'])

    def test_no_guessed_links_dates_or_counts(self):
        self.assertIsNone(trial.normalize_video({'id': 'bad'}, 'tag', 'now'))
        row = trial.normalize_video({'id': '1', 'author': {'uniqueId': 'user'}, 'createTime': 'bad', 'stats': {'playCount': -1, 'diggCount': True}}, 'tag', 'now')
        self.assertEqual(row['published_at'], '')
        self.assertEqual(row['views'], '')
        self.assertEqual(row['likes'], '')

    def test_spreadsheet_safe_captions(self):
        self.assertEqual(trial.safe_cell('=IMPORTXML("x")'), '\'=IMPORTXML("x")')
        self.assertEqual(trial.safe_cell('@reviewer'), "'@reviewer")
        self.assertEqual(trial.safe_cell(0), 0)
        self.assertEqual(trial.safe_cell('Kopi Bandung'), 'Kopi Bandung')


if __name__ == '__main__':
    unittest.main()
