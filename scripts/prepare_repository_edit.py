#!/usr/bin/env python3
"""Prepare and verify exact-content repository edits without model reconstruction.

This helper is intentionally local and deterministic. It does not perform any remote
GitHub mutation. A caller must materialize exact source bytes, invoke this script,
validate the result, and then use the repository writer with the captured source
version before independently rereading the destination.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path


class EditPreconditionError(ValueError):
    """Raised when a deterministic edit precondition is not satisfied."""


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def insert_after_unique(source: bytes, anchor: bytes, insertion: bytes) -> bytes:
    """Insert bytes immediately after an anchor that occurs exactly once."""
    if not anchor:
        raise EditPreconditionError("anchor must not be empty")

    matches = source.count(anchor)
    if matches != 1:
        raise EditPreconditionError(
            f"anchor must occur exactly once; observed {matches} matches"
        )

    offset = source.index(anchor) + len(anchor)
    return source[:offset] + insertion + source[offset:]


def verify_exact(expected: bytes, actual: bytes) -> None:
    """Require exact byte equality, raising with hashes when it is absent."""
    if expected != actual:
        raise EditPreconditionError(
            "exact verification failed: "
            f"expected_sha256={sha256_bytes(expected)} "
            f"actual_sha256={sha256_bytes(actual)}"
        )


def write_metadata(path: Path | None, payload: dict[str, object]) -> None:
    serialized = json.dumps(payload, sort_keys=True, indent=2) + "\n"
    if path is None:
        print(serialized, end="")
    else:
        path.write_text(serialized, encoding="utf-8")


def prepare_insert_after(args: argparse.Namespace) -> int:
    source = args.source.read_bytes()
    anchor = args.anchor_file.read_bytes()
    insertion = args.insert_file.read_bytes()

    source_hash = sha256_bytes(source)
    if args.expected_source_sha256 and source_hash != args.expected_source_sha256:
        raise EditPreconditionError(
            "source hash precondition failed: "
            f"expected={args.expected_source_sha256} actual={source_hash}"
        )

    matches = source.count(anchor)
    result = insert_after_unique(source, anchor, insertion)
    args.output.write_bytes(result)

    write_metadata(
        args.metadata,
        {
            "operation": "insert-after-unique",
            "source": str(args.source),
            "output": str(args.output),
            "anchor_matches": matches,
            "source_size": len(source),
            "result_size": len(result),
            "source_sha256": source_hash,
            "result_sha256": sha256_bytes(result),
        },
    )
    return 0


def verify_files(args: argparse.Namespace) -> int:
    expected = args.expected.read_bytes()
    actual = args.actual.read_bytes()
    verify_exact(expected, actual)

    write_metadata(
        args.metadata,
        {
            "operation": "verify-exact",
            "verified": True,
            "size": len(expected),
            "sha256": sha256_bytes(expected),
        },
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Prepare deterministic byte-preserving repository edits."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    insert = subparsers.add_parser(
        "insert-after", help="insert bytes after an anchor that occurs exactly once"
    )
    insert.add_argument("--source", type=Path, required=True)
    insert.add_argument("--anchor-file", type=Path, required=True)
    insert.add_argument("--insert-file", type=Path, required=True)
    insert.add_argument("--output", type=Path, required=True)
    insert.add_argument("--expected-source-sha256")
    insert.add_argument("--metadata", type=Path)
    insert.set_defaults(func=prepare_insert_after)

    verify = subparsers.add_parser(
        "verify", help="compare an expected result and reread destination byte-for-byte"
    )
    verify.add_argument("--expected", type=Path, required=True)
    verify.add_argument("--actual", type=Path, required=True)
    verify.add_argument("--metadata", type=Path)
    verify.set_defaults(func=verify_files)

    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        return args.func(args)
    except (OSError, EditPreconditionError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
