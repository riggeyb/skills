#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "scripts" / "apply_repository_edit_request.py"

spec = importlib.util.spec_from_file_location("repository_edit_request", HELPER)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class RepositoryEditRequestTests(unittest.TestCase):
    def test_replace_unique_preserves_unrelated_bytes(self) -> None:
        source = b'\x00header\r\nTARGET=old\r\ntail\ff'
        req = {"version": 2, "operation": "replace-unique", "old": "TARGET=old", "new": "TARGET=new"}
        result, metadata = mod.apply(req, source)
        self.assertEqual(result, b'\x00header\r\nTARGET=new\r\ntail\ff')
        self.assertEqual(metadata["operation"], "replace-unique")
        self.assertEqual(metadata["source_sha256"], hashlib.sha256(source).hexdigest())
        self.assertEqual(metadata["result_sha256"], hashlib.sha256(result).hexdigest())

    def test_replace_unique_allows_deletion_replacement(self) -> None:
        result, _ = mod.apply({"version": 2, "operation": "replace-unique", "old": "beta", "new": ""}, b"alpha-beta-gamma")
        self.assertEqual(result, b"alpha--gamma")

    def test_replace_unique_rejects_missing_target(self) -> None:
        with self.assertRaisesRegex(SystemExit, "exactly once; found 0"):
            mod.apply({"version": 2, "operation": "replace-unique", "old": "missing", "new": "x"}, b"alpha beta")

    def test_replace_unique_rejects_ambiguous_target(self) -> None:
        with self.assertRaisesRegex(SystemExit, "exactly once; found 2"):
            mod.apply({"version": 2, "operation": "replace-unique", "old": "dup", "new": "x"}, b"dup--dup")

    def test_replace_unique_rejects_no_op(self) -> None:
        with self.assertRaisesRegex(SystemExit, "no content change"):
            mod.apply({"version": 2, "operation": "replace-unique", "old": "beta", "new": "beta"}, b"alpha beta")

    def test_verify_source_rejects_stale_git_blob(self) -> None:
        with self.assertRaisesRegex(SystemExit, "source Git blob SHA mismatch"):
            mod.verify_source({"expected_source_git_blob_sha": "0" * 40}, b"fresh")

    def test_verify_source_rejects_multiple_preconditions(self) -> None:
        source = b"fresh"
        req = {
            "expected_source_git_blob_sha": mod.git_blob_sha_bytes(source),
            "expected_source_sha256": hashlib.sha256(source).hexdigest(),
        }
        with self.assertRaisesRegex(SystemExit, "provide exactly one source precondition"):
            mod.verify_source(req, source)


 if __name__ == "__main__":
    unittest.main(verbosity=2)
