"""Local-only checks for interrupted wheel cache writes; no package install."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("reuse_packages", ROOT / "scripts" / "reuse-python-packages.py")
reuse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reuse)


def wheel(path):
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("fixture.dist-info/WHEEL", "Wheel-Version: 1.0\n")
        archive.writestr("fixture.dist-info/METADATA", "Name: fixture\nVersion: 1\n")
        archive.writestr("fixture.dist-info/RECORD", "fixture.dist-info/WHEEL,,\nfixture.dist-info/METADATA,,\nfixture.dist-info/RECORD,,\n")


class CacheIntegrity(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="wheel-integrity-test-", dir=ROOT / "cache")
        self.addCleanup(self.folder.cleanup)
        self.target = Path(self.folder.name) / "fixture.whl"

    def test_truncated_existing_wheel_is_not_reused(self):
        wheel(self.target)
        self.assertTrue(reuse.valid_wheel(self.target))
        self.target.write_bytes(self.target.read_bytes()[:20])
        self.assertFalse(reuse.valid_wheel(self.target))

    def test_failed_write_keeps_previous_cache_and_removes_temporary(self):
        wheel(self.target)
        before = self.target.read_bytes()
        with self.assertRaises(RuntimeError):
            reuse.write_atomic(self.target, ROOT, lambda temporary: temporary.write_bytes(b"incomplete"))
        self.assertEqual(self.target.read_bytes(), before)
        self.assertEqual(list(self.target.parent.glob("*.tmp-*")), [])

    def test_valid_write_replaces_invalid_cache(self):
        self.target.write_bytes(b"incomplete")
        reuse.write_atomic(self.target, ROOT, wheel)
        self.assertTrue(reuse.valid_wheel(self.target))
        self.assertEqual(list(self.target.parent.glob("*.tmp-*")), [])


if __name__ == "__main__":
    unittest.main()
