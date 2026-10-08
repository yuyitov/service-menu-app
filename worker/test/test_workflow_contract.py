"""Offline structural contract checks. Not a GitHub Actions integration run."""
from pathlib import Path
import unittest
import yaml
ROOT=Path(__file__).resolve().parents[2]
class WorkflowContract(unittest.TestCase):
    def test_notify_depends_on_the_exact_deployment(self):
        doc=yaml.load((ROOT/'.github/workflows/generate-hmu-page.yml').read_text(),Loader=yaml.BaseLoader)
        jobs=doc['jobs']
        self.assertEqual(jobs['deploy']['needs'],'generate')
        self.assertIn('commit_sha',jobs['deploy']['with']['build_ref'])
        self.assertIn('deploy',jobs['notify']['needs'])
        script=jobs['notify']['steps'][-1]['run']
        self.assertIn('--fail-with-body',script)
        self.assertIn('generation_attempt',script)
        self.assertIn('qr_png_base64',script)
        self.assertEqual(doc['concurrency']['queue'],'max')
        self.assertEqual(doc['concurrency']['cancel-in-progress'],'false')
        alert=jobs['alert']['steps'][0]
        self.assertIn('needs.deploy.result',alert['env']['PUBLICATION_CONFIRMED'])
        self.assertIn('failure_stage',alert['run'])
        self.assertIn('publication_confirmed',alert['run'])
    def test_pages_is_reusable_and_pins_requested_revision(self):
        doc=yaml.load((ROOT/'.github/workflows/pages.yml').read_text(),Loader=yaml.BaseLoader)
        self.assertEqual(doc['on']['workflow_call']['inputs']['build_ref']['required'],'true')
        checkout=doc['jobs']['build']['steps'][0]
        self.assertIn('inputs.build_ref',checkout['with']['ref'])
        self.assertEqual(doc['concurrency']['queue'],'max')
    def test_processing_state_does_not_claim_token_expired(self):
        html=(ROOT/'public/correct/index.html').read_text()
        self.assertIn('id="state-processing"',html)
        self.assertIn("data.state === 'processing'",html)
        self.assertIn("show('processing')",html)
        self.assertIn('You do not need to submit it again',html)
if __name__=='__main__':unittest.main()
