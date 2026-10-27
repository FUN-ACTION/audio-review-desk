"""Integrity checks for the pinned, offline Three.js runtime."""

import hashlib
import json
import unittest
from pathlib import Path


class SceneBundleTests(unittest.TestCase):
    def setUp(self):
        self.repo = Path(__file__).resolve().parents[1]
        self.build = self.repo / "scripts/scene-build"
        self.static = self.repo / "src/audio_review_desk/static/tour"
        self.record = json.loads((self.build / "bundle.json").read_text(encoding="utf-8"))

    def test_runtime_bytes_match_the_recorded_bundle(self):
        self.assertEqual(self.record["file"], "scene-vendor.js")
        data = (self.static / self.record["file"]).read_bytes()
        self.assertEqual(len(data), self.record["bytes"])
        self.assertEqual(hashlib.sha256(data).hexdigest(), self.record["sha256"])

    def test_runtime_version_and_license_match_the_exact_dependency_lock(self):
        package = json.loads((self.build / "package.json").read_text(encoding="utf-8"))
        lock = json.loads((self.build / "package-lock.json").read_text(encoding="utf-8"))
        pinned = lock["packages"]["node_modules/three"]
        version = "0.180.0"
        self.assertEqual(self.record["name"], "three")
        self.assertEqual(package["dependencies"]["three"], version)
        self.assertEqual(lock["packages"][""]["dependencies"]["three"], version)
        self.assertEqual(pinned["version"], version)
        self.assertEqual(self.record["version"], version)
        self.assertEqual(pinned["resolved"], f"https://registry.npmjs.org/three/-/three-{version}.tgz")
        self.assertTrue(pinned["integrity"].startswith("sha512-"))
        self.assertEqual(pinned["license"], "MIT")
        self.assertEqual(self.record["license"], pinned["license"])

    def test_bundled_license_is_the_complete_upstream_0180_license(self):
        # Digest of the LICENSE supplied by the pinned three@0.180.0 package.
        # CI need not install Node dependencies to verify the shipped licence.
        data = (self.static / "three-LICENSE.txt").read_bytes()
        self.assertEqual(
            hashlib.sha256(data).hexdigest(),
            "bfe119ea4fd413f5f7ca3fcd63adb0c4a073ed39daa2fe7d3e6b769e21272601",
        )

