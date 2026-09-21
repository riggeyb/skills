#!/usr/bin/env python3
"""Apply a declarative repository edit request to an exact checkout.

Version 1 requests support byte-preserving insertion after a unique anchor.
Version 2 adds exact unique replacement while retaining the same source
precondition and repository-owned execution model.
Version 3 adds exact file deletion with the same source preconditions.
"""
from __future__ import annotations
import argparse, hashlib, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHA256_RE = re.compile(r"[a-fA-F0-9]{64}")
GIT_SHA_RE = re.compile(r"[a-fA-F0-9]{40}")
SUPPORTED = {
    1: {"insert-after-unique"},
    2: {"insert-after-unique", "replace-unique"},
    3: {"insert-after-unique", "replace-unique", "delete-file"},
}

def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def git_blob_sha_bytes(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()

def resolve_target(raw: object) -> Path:
    if not isinstance(raw, str) or not raw:
        raise SystemExit("path must be a non-empty relative path")
    candidate = (ROOT / raw).resolve()
    try:
        candidate.relative_to(ROOT)
    except ValueError:
        raise SystemExit("path must stay within the repository") from None
    if candidate == ROOT or not candidate.is_file():
        raise SystemExit(f"target is not a file: {raw}")
    return candidate

def require_string(req: dict, key: str, *, allow_empty: bool = False) -> str:
    value = req.get(key)
    if not isinstance(value, str) or (not allow_empty and not value):
        qualifier = "a string" if allow_empty else "a non-empty string"
        raise SystemExit(f"{key} must be {qualifier}")
    return value

def verify_source(req: dict, source: bytes) -> None:
    expected_sha256 = req.get("expected_source_sha256")
    expected_git = req.get("expected_source_git_blob_sha")
    if bool(expected_sha256) == bool(expected_git):
        raise SystemExit("provide exactly one source precondition: expected_source_sha256 or expected_source_git_blob_sha")
    if expected_sha256:
        if not isinstance(expected_sha256, str) or not SHA256_RE.fullmatch(expected_sha256):
            raise SystemExit("expected_source_sha256 must be a 64-character hex SHA-256")
        actual = sha256_bytes(source)
        if expected_sha256.lower() != actual:
            raise SystemExit(f"source hash mismatch: expected={expected_sha256.lower()} actual={actual}")
        return
    if not isinstance(expected_git, str) or not GIT_SHA_RE.fullmatch(expected_git):
        raise SystemExit("expected_source_git_blob_sha must be a 40-character hex Git blob SHA")
    actual_git = git_blob_sha_bytes(source)
    if expected_git.lower() != actual_git:
        raise SystemExit(f"source Git blob SHA mismatch: expected={expected_git.lower()} actual={actual_git}")

def require_unique(source: bytes, needle: bytes, label: str) -> int:
    count = source.count(needle)
    if count != 1:
        raise SystemExit(f"{label} must occur exactly once; found {count}")
    return source.index(needle)

def apply(req: dict, source: bytes) -> tuple[bytes | None, dict[str, object]]:
    version, operation = req.get("version"), req.get("operation")
    if version not in SUPPORTED or operation not in SUPPORTED[version]:
        raise SystemExit(f"unsupported request version/operation: {version!r}/{operation!r}")
    if operation == "delete-file":
        metadata = {
            "version": version, "operation": operation,
            "source_sha256": sha256_bytes(source), "result_sha256": None,
            "source_bytes": len(source), "result_bytes": 0,
        }
        return None, metadata
    if operation == "insert-after-unique":
        anchor = require_string(req, "anchor").encode()
        insertion = require_string(req, "insertion").encode()
        offset = require_unique(source, anchor, "anchor") + len(anchor)
        result = source[:offset] + insertion + source[offset:]
        detail = {"anchor_bytes": len(anchor), "insertion_bytes": len(insertion)}
    else:
        old = require_string(req, "old").encode()
        new = require_string(req, "new", allow_empty=True).encode()
        offset = require_unique(source, old, "old")
        result = source[:offset] + new + source[offset + len(old):]
        detail = {"old_bytes": len(old), "new_bytes": len(new)}
    if result == source:
        raise SystemExit("request produced no content change")
    metadata = {
        "version": version, "operation": operation,
        "source_sha256": sha256_bytes(source), "result_sha256": sha256_bytes(result),
        "source_bytes": len(source), "result_bytes": len(result), **detail,
    }
    return result, metadata

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("request", type=Path)
    req = json.loads(ap.parse_args().request.read_text(encoding="utf-8"))
    if not isinstance(req, dict):
        raise SystemExit("request must be a JSON object")
    target = resolve_target(req.get("path"))
    source = target.read_bytes()
    verify_source(req, source)
    result, metadata = apply(req, source)
    if result is None:
        target.unlink()
    else:
        target.write_bytes(result)
    print(json.dumps(metadata, indent=2, sort_keys=True))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
