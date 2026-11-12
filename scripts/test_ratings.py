import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('ratings',Path(__file__).with_name('prepare-ratings.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class RatingTests(unittest.TestCase):
 def test_platform_scores_are_not_mixed(self):
  score=r.score('Zomato (3.5/5) 43 Foursquare (7.2/10) 15 Google (4.3/5) 1692 Facebook (4.5/5) 23','restaurantguru.com')
  self.assertEqual(score[:3],(4.3,1692,'Google'))
 def test_address_requires_both_street_and_number(self):
  self.assertTrue(r.address_match('Jl. Cimanuk No.2, Bandung','Alamat Jalan Cimanuk 2, Bandung'))
  self.assertFalse(r.address_match('Jl. Cimanuk No.2','Alamat Jalan Cimanuk 20, Bandung'))
  self.assertFalse(r.address_match('Jl. Cimanuk No.2','Alamat Jalan Progo 2, Bandung'))
  self.assertFalse(r.address_match('','Jl. Cimanuk 2'))
 def test_generic_and_other_business_names_are_rejected(self):
  self.assertFalse(r.name_match('Art','Grey Art Gallery Bandung'))
  self.assertFalse(r.name_match('Bean','Red Bean Bandung'))
  self.assertFalse(r.name_match('Kuro Coffee','Sawo Coffee Bandung'))
  self.assertTrue(r.name_match('372 Kopi','372 Kopi Dago Bandung'))
 def test_candidates_do_not_become_verified_without_address(self):
  body='Kedai Bumi, Bandung (https://docentpro.com/places/kedai-bumi)\n# Kedai Bumi\n4.7 (128 reviews)\nJl. Cimanuk No.2, Bandung'
  result=r.extract({'shop':{'name':'Kedai Bumi','address':'Jl. Cimanuk No.20'},'text':body})
  self.assertEqual(result[0]['match_status'],'business_match_branch_unverified')
  self.assertEqual(result[0]['value'],4.7)
 def test_nonaggregate_articles_and_wrong_city_are_excluded(self):
  for body in ['Kedai Bumi (https://lemon8-app.com/post)\nBandung 4.7/5 128 reviews','Kedai Bumi, Tangerang (https://docentpro.com/places/bumi)\n4.7 (128 reviews)']:
   self.assertEqual(r.extract({'shop':{'name':'Kedai Bumi','address':''},'text':body}),[])
if __name__=='__main__':unittest.main()
