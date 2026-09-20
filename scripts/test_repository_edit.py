#!/usr/bin/env python3
from __future__ import annotations

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

    def test_cli_contract_can_round_trip_materialized_files(self) -> None:
        """Model the runtime handoff using local file artifacts."""
        source = b"header\nanchor\ntail\n"
        anchor = b"anchor\n"
        insertion = b"new-entry\n"
        expected = b"header\nanchor\nnew-entry\ntail\n"

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_path = root / "source.bin"
            result_path = root / "result.bin"
            reread_path = root / "reread.bin"
            source_path.write_bytes(source)

            prepared = insert_after_unique(source_path.read_bytes(), anchor, insertion)
            result_path.write_bytes(prepared)
            reread_path.write_bytes(expected)

            self.assertEqual(result_path.read_bytes(), expected)
            verify_exact(result_path.read_bytes(), reread_path.read_bytes())


if __name__ == "__main__":
    result = unittest.main(verbosity=2, exit=False)
    sys.exit(0 if result.result.wasSuccessful() else 1)
