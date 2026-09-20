#!/usr/bin/env python3
"""Apply a declarative repository edit request to an exact checkout.

The request is intentionally narrow: insert exact bytes after a unique anchor.
Git provides the exact source bytes; prepare_repository_edit.py performs the
deterministic transformation. The runner never reconstructs target content
through an LLM/tool response.
"""
from __future__ import annotations
import argparse, hashlib, json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREPARE = ROOT / "scripts" / "prepare_repository_edit.py"
SHA256_RE = re.compile(r"[a-fA-F0-9]{64}")
GIT_SHA_RE = re.compile(r"[a-fA-F0-9]{40}")

def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()

def git_blob_sha(p: Path) -> str:
    data = p.read_bytes()
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

def require_string(req: dict, key: str) -> str:
    value = req.get(key)
    if not isinstance(value, str) or not value:
        raise SystemExit(f"{key} must be a non-empty string")
    return value

def verify_source(req: dict, target: Path) -> str:
    expected_sha256 = req.get("expected_source_sha256")
    expected_git = req.get("expected_source_git_blob_sha")
    if bool(expected_sha256) == bool(expected_git):
        raise SystemExit("provide exactly one source precondition: expected_source_sha256 or expected_source_git_blob_sha")
    if expected_sha256:
        if not isinstance(expected_sha256, str) or not SHA256_RE.fullmatch(expected_sha256):
            raise SystemExit("expected_source_sha256 must be a 64-character hex SHA-256")
        actual = sha256(target)
        if expected_sha256.lower() != actual:
            raise SystemExit(f"source hash mismatch: expected={expected_sha256.lower()} actual={actual}")
        return actual
    if not isinstance(expected_git, str) or not GIT_SHA_RE.fullmatch(expected_git):
        raise SystemExit("expected_source_git_blob_sha must be a 40-character hex Git blob SHA")
    actual_git = git_blob_sha(target)
    if expected_git.lower() != actual_git:
        raise SystemExit(f"source Git blob SHA mismatch: expected={expected_git.lower()} actual={actual_git}")
    return sha256(target)

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("request", type=Path)
    args = ap.parse_args()
    req = json.loads(args.request.read_text(encoding="utf-8"))
    if not isinstance(req, dict):
        raise SystemExit("request must be a JSON object")
    if req.get("version") != 1 or req.get("operation") != "insert-after-unique":
        raise SystemExit("unsupported request version/operation")

    target = resolve_target(req.get("path"))
    source_hash = verify_source(req, target)
    anchor_text = require_string(req, "anchor")
    insertion_text = require_string(req, "insertion")

    work = ROOT / ".repository-edit-work"
    work.mkdir(exist_ok=True)
    anchor, insertion = work / "anchor.bin", work / "insertion.bin"
    output, metadata = work / "result.bin", work / "metadata.json"
    anchor.write_bytes(anchor_text.encode("utf-8"))
    insertion.write_bytes(insertion_text.encode("utf-8"))

    cmd = [
        sys.executable, str(PREPARE), "insert-after",
        "--source", str(target), "--anchor-file", str(anchor),
        "--insert-file", str(insertion), "--output", str(output),
        "--expected-source-sha256", source_hash, "--metadata", str(metadata),
    ]
    subprocess.run(cmd, check=True)
    target.write_bytes(output.read_bytes())
    print(metadata.read_text(encoding="utf-8"), end="")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
