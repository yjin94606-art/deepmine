"""Release gates use deliberately tiny archives and never contact GitHub."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import release
import windows_bundle


class ReleaseAssetsTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.root = self.base / "repo"
        self.out = self.base / "bundles"
        (self.root / "scripts").mkdir(parents=True)
        self.out.mkdir()
        for modification in (patch.object(release, "ROOT", self.root),
                             patch.object(windows_bundle, "RUNTIME_HASHES",
                                          {n: hashlib.sha256(b"fixture").hexdigest() for n in ("node.exe", "LICENSE")})):
            modification.start()
            self.addCleanup(modification.stop)
        self.manifest = self.root / "scripts/release-files.txt"
        self.manifest.write_text("package.json\n", encoding="utf8")
        self.package = self.root / "package.json"
        self.package.write_text(json.dumps({"version":release.VERSION}), encoding="utf8")
        release.pack(self.out / release.asset_name("source"))

    def windows(self, package=None, runtime=b"fixture"):
        with zipfile.ZipFile(self.out / release.asset_name("windows-x64"), "w") as archive:
            archive.writestr("Deepmine/package.json", self.package.read_bytes() if package is None else package)
            archive.writestr("Open Deepmine.cmd", windows_bundle.LAUNCHER)
            for name in ("Deepmine/runtime/node.exe", "Deepmine/runtime/LICENSE"):
                archive.writestr(name, runtime)

    def test_personal_files_in_an_application_directory_stay_out_of_the_archive(self):
        (self.root / "scripts/private-note.json").write_text("{}", encoding="utf8")
        candidate = self.out / "other.zip"
        release.pack(candidate)
        with zipfile.ZipFile(candidate) as archive:
            self.assertEqual(archive.namelist(), ["package.json"])
        self.manifest.write_text("../outside.txt\n", encoding="utf8")
        with self.assertRaisesRegex(ValueError, "entry"):
            release.sources()

    def test_checksums_cover_exactly_the_two_matching_packages(self):
        self.windows()
        release.write_checksums(self.out)
        release.write_checksums(self.out)
        expected = "".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n"
                           for p in sorted(self.out.glob("*.zip")))
        self.assertEqual((self.out / "SHA256SUMS.txt").read_bytes(), expected.encode())
        self.windows(b'{"version":"other"}')
        with self.assertRaisesRegex(ValueError, "different copies"):
            release.write_checksums(self.out)
        self.assertEqual((self.out / "SHA256SUMS.txt").read_bytes(), expected.encode())

    def test_wrong_version_fails_even_if_the_two_packages_agree(self):
        self.package.write_text('{"version":"other"}', encoding="utf8")
        release.pack(self.out / release.asset_name("source"))
        self.windows()
        with self.assertRaisesRegex(ValueError, "Incorrect package version"):
            release.write_checksums(self.out)
        self.assertFalse((self.out / "SHA256SUMS.txt").exists())

    def test_tampered_runtime_and_packages_from_another_checkout_are_rejected(self):
        self.windows(runtime=b"unexpected")
        with self.assertRaisesRegex(ValueError, "Incorrect Node runtime"):
            release.write_checksums(self.out)
        self.windows()
        self.package.write_text(json.dumps({"version": release.VERSION, "different": True}), encoding="utf8")
        with self.assertRaisesRegex(ValueError, "differs from checkout"):
            release.write_checksums(self.out)
