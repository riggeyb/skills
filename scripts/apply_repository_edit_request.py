#!/usr/bin/env python3
"""Apply a declarative repository edit request to an exact checkout.

The request is intentionally narrow: insert exact bytes after a unique anchor.
Git provides the exact source bytes; prepare_repository_edit.py performs the
deterministic transformation. This runner never reconstructs target content
through an LLM/tool response.
"""
from __future__ import annotations
import argparse, hashlib, json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREPARE = ROOT / "scripts" / "prepare_repository_edit.py"
SHA256_RE = re.compile(r"[a-fA-F0-9]{64}")

def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()

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
    expected = require_string(req, "expected_source_sha256").lower()
    if not SHA256_RE.fullmatch(expected):
        raise SystemExit("expected_source_sha256 must be a 64-character hex SHA-256")
    source_hash = sha256(target)
    if expected != source_hash:
        raise SystemExit(f"source hash mismatch: expected={expected} actual={source_hash}")

    anchor_text = require_string(req, "anchor")
    insertion_text = require_string(req, "insertion")
    work = ROOT / ".repository-edit-work"
    work.mkdir(exist_ok=True)
    anchor = work / "anchor.bin"
    insertion = work / "insertion.bin"
    output = work / "result.bin"
    metadata = work / "metadata.json"
    anchor.write_bytes(anchor_text.encode("utf-8"))
    insertion.write_bytes(insertion_text.encode("utf-8"))

    cmd = [
        sys.executable, str(PREPARE), "insert-after",
        "--source", str(target),
        "--anchor-file", str(anchor),
        "--insert-file", str(insertion),
        "--output", str(output),
        "--expected-source-sha256", source_hash,
        "--metadata", str(metadata),
    ]
    subprocess.run(cmd, check=True)
    target.write_bytes(output.read_bytes())
    print(metadata.read_text(encoding="utf-8"), end="")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
