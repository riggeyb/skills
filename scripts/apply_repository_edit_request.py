#!/usr/bin/env python3
"""Apply a declarative repository edit request to an exact checkout.

The request is intentionally narrow: insert exact bytes after a unique anchor.
Git provides the exact source bytes; prepare_repository_edit.py performs the
deterministic transformation. This runner never reconstructs target content
through an LLM/tool response.
"""
from __future__ import annotations
import argparse, hashlib, json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREPARE = ROOT / "scripts" / "prepare_repository_edit.py"

def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("request", type=Path)
    args = ap.parse_args()
    req = json.loads(args.request.read_text(encoding="utf-8"))
    if req.get("version") != 1 or req.get("operation") != "insert-after-unique":
        raise SystemExit("unsupported request version/operation")
    target = ROOT / req["path"]
    if not target.is_file():
        raise SystemExit(f"target is not a file: {req['path']}")
    source_hash = sha256(target)
    expected = req.get("expected_source_sha256")
    if expected and expected != source_hash:
        raise SystemExit(f"source hash mismatch: expected={expected} actual={source_hash}")

    work = ROOT / ".repository-edit-work"
    work.mkdir(exist_ok=True)
    anchor = work / "anchor.bin"
    insertion = work / "insertion.bin"
    output = work / "result.bin"
    metadata = work / "metadata.json"
    anchor.write_text(req["anchor"], encoding="utf-8", newline="")
    insertion.write_text(req["insertion"], encoding="utf-8", newline="")

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
