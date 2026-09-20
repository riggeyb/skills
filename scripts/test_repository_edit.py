#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

from prepare_repository_edit import (
    EditPreconditionError,
    insert_after_unique,
    sha256_bytes,
    verify_exact,
)

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "registry.yaml"
HELPER = ROOT / "scripts" / "prepare_repository_edit.py"


class RepositoryEditTests(unittest.TestCase):
    def test_registry_unique_anchor_acceptance(self) -> None:
        """Exercise byte-preserving preparation against the real registry file."""
        source = REGISTRY.read_bytes()
        anchor = b"version: 2"
        insertion = b"\n# repository-edit-acceptance-probe"

        self.assertEqual(source.count(anchor), 1)
        result = insert_after_unique(source, anchor, insertion)

        offset = source.index(anchor) + len(anchor)
        self.assertEqual(result[:offset], source[:offset])
        self.assertEqual(result[offset : offset + len(insertion)], insertion)
        self.assertEqual(result[offset + len(insertion) :], source[offset:])
        self.assertNotEqual(sha256_bytes(source), sha256_bytes(result))

        parsed = yaml.safe_load(result.decode("utf-8"))
        self.assertIsInstance(parsed, dict)
        self.assertEqual(parsed.get("version"), 2)

    def test_zero_anchor_rejected(self) -> None:
        with self.assertRaisesRegex(EditPreconditionError, "observed 0 matches"):
            insert_after_unique(b"alpha\nbeta\n", b"gamma", b"insert")

    def test_ambiguous_anchor_rejected(self) -> None:
        with self.assertRaisesRegex(EditPreconditionError, "observed 2 matches"):
            insert_after_unique(b"anchor\none\nanchor\ntwo\n", b"anchor", b"insert")

    def test_empty_anchor_rejected(self) -> None:
        with self.assertRaisesRegex(EditPreconditionError, "must not be empty"):
            insert_after_unique(b"source", b"", b"insert")

    def test_crlf_and_unrelated_bytes_are_preserved(self) -> None:
        source = b"first\r\nANCHOR\r\nlast\r\n"
        insertion = b"inserted\r\n"
        result = insert_after_unique(source, b"ANCHOR\r\n", insertion)
        self.assertEqual(result, b"first\r\nANCHOR\r\ninserted\r\nlast\r\n")
        self.assertNotIn(b"\nlast\n", result)

    def test_exact_verification_accepts_identical_bytes(self) -> None:
        expected = b"exact\x00bytes\r\n"
        verify_exact(expected, expected)

    def test_exact_verification_rejects_mismatch(self) -> None:
        with self.assertRaisesRegex(EditPreconditionError, "exact verification failed"):
            verify_exact(b"expected", b"actual")

    def test_cli_contract_round_trips_materialized_files(self) -> None:
        """Exercise the actual CLI handoff and exact reread verification contract."""
        source = b"header\nanchor\ntail\n"
        anchor = b"anchor\n"
        insertion = b"new-entry\n"
        expected = b"header\nanchor\nnew-entry\ntail\n"

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_path = root / "source.bin"
            anchor_path = root / "anchor.bin"
            insert_path = root / "insert.bin"
            result_path = root / "result.bin"
            metadata_path = root / "prepare.json"
            reread_path = root / "reread.bin"
            verify_metadata_path = root / "verify.json"

            source_path.write_bytes(source)
            anchor_path.write_bytes(anchor)
            insert_path.write_bytes(insertion)

            prepared = subprocess.run(
                [
                    sys.executable,
                    str(HELPER),
                    "insert-after",
                    "--source",
                    str(source_path),
                    "--anchor-file",
                    str(anchor_path),
                    "--insert-file",
                    str(insert_path),
                    "--output",
                    str(result_path),
                    "--expected-source-sha256",
                    sha256_bytes(source),
                    "--metadata",
                    str(metadata_path),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(prepared.returncode, 0, prepared.stderr)
            self.assertEqual(result_path.read_bytes(), expected)

            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            self.assertEqual(metadata["anchor_matches"], 1)
            self.assertEqual(metadata["source_sha256"], sha256_bytes(source))
            self.assertEqual(metadata["result_sha256"], sha256_bytes(expected))

            reread_path.write_bytes(expected)
            verified = subprocess.run(
                [
                    sys.executable,
                    str(HELPER),
                    "verify",
                    "--expected",
                    str(result_path),
                    "--actual",
                    str(reread_path),
                    "--metadata",
                    str(verify_metadata_path),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(verified.returncode, 0, verified.stderr)
            verify_metadata = json.loads(
                verify_metadata_path.read_text(encoding="utf-8")
            )
            self.assertTrue(verify_metadata["verified"])
            self.assertEqual(verify_metadata["sha256"], sha256_bytes(expected))

    def test_cli_rejects_stale_source_hash(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_path = root / "source.bin"
            anchor_path = root / "anchor.bin"
            insert_path = root / "insert.bin"
            result_path = root / "result.bin"

            source_path.write_bytes(b"anchor\ntail\n")
            anchor_path.write_bytes(b"anchor\n")
            insert_path.write_bytes(b"entry\n")

            result = subprocess.run(
                [
                    sys.executable,
                    str(HELPER),
                    "insert-after",
                    "--source",
                    str(source_path),
                    "--anchor-file",
                    str(anchor_path),
                    "--insert-file",
                    str(insert_path),
                    "--output",
                    str(result_path),
                    "--expected-source-sha256",
                    "0" * 64,
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("source hash precondition failed", result.stderr)
            self.assertFalse(result_path.exists())


if __name__ == "__main__":
    result = unittest.main(verbosity=2, exit=False)
    sys.exit(0 if result.result.wasSuccessful() else 1)
