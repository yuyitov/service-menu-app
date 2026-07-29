import tempfile
import unittest
from pathlib import Path

from generate_service_menu import make_qr_png
from verify_qr_assets import QrVerificationError, verify_qr_png


class VerifyQrAssetsTests(unittest.TestCase):
    URL = "https://www.hmulink.com/links/test-qr/"

    def test_accepts_a_png_for_its_exact_url(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "qr.png"
            path.write_bytes(make_qr_png(self.URL))
            verify_qr_png(path, self.URL)

    def test_rejects_a_qr_for_another_url(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "qr.png"
            path.write_bytes(make_qr_png(self.URL))
            with self.assertRaises(QrVerificationError):
                verify_qr_png(path, "https://www.hmulink.com/links/other-url/")
