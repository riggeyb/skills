from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "scripts" / "apply_repository_edit_request.py"

def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write_request(path: Path, *, target: Path, anchor: str, insertion: str, expected: str | None = None) -> None:
    payload = {
        "version": 1,
        "operation": "insert-after-unique",
        "path": str(target.relative_to(ROOT)),
        "expected_source_sha256": expected or sha256(target),
        "anchor": anchor,
        "insertion": insertion,
    }
    path.write_text(json.dumps(payload), encoding="utf-8")

def run(request: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, str(RUNNER), str(request)], cwd=ROOT, text=True, capture_output=True)

def test_applies_unique_insertion_and_preserves_crlf():
    target = ROOT / "tests" / "_repository_edit_target.txt"
    request = ROOT / "tests" / "_repository_edit_request.json"
    target.write_bytes(b"a\r\nanchor\r\nz\r\n")
    try:
        write_request(request, target=target, anchor="anchor\r\n", insertion="inserted\r\n")
        result = run(request)
        assert result.returncode == 0, result.stderr
        assert target.read_bytes() == b"a\q…\nanchor\r\ninserted\r\nz\r\n"
    finally:
        target.unlink(missing_ok=True)
        request.unlink(missing_ok=True)
        'ork = ROOT / ".repository-edit-work"
        if work.exists():
            import shutil; shutil.rmtree(work)

def test_rejects_stale_source_hash():
    target = ROOT / "tests" / "_repository_edit_target.txt"
    request = ROOT / "tests" / "_repository_edit_request.json"
    target.write_text("anchor\n", encoding="utf-8")
    try:
        write_request(request, target=target, anchor="anchor\n", insertion="x\n", expected="0" * 64)
        result = run(request)
        assert result.returncode != 0
        assert "source hash mismatch" in result.stderr + result.stdout
        assert target.read_text() == "anchor\n"
    finally:
        target.unlink(missing_ok=True)
        request.unlink(missing_ok=True)

def test_rejects_ambiguous_anchor():
    target = ROOT / "tests" / "_repository_edit_target.txt"
    request = ROOT / "tests" / "_repository_edit_request.json"
    target.write_text("anchor\nanchor\n", encoding="utf-8")
    try:
        write_request(request, target=target, anchor="anchor\n", insertion="x\n")
        result = run(request)
        assert result.returncode != 0
        assert "anchor must occur exactly once" in result.stderr + result.stdout
    finally:
        target.unlink(missing_ok=True)
        request.unlink(missing_ok=True)

def test_rejects_path_escape():
    request = ROOT / "tests" / "_repository_edit_request.json"
    payload = {"version": 1, "operation": "insert-after-unique", "path": "../outside.txt", "expected_source_sha256": "0" * 64, "anchor": "a", "insertion": "b"}
    request.write_text(json.dumps(payload), encoding="utf-8")
    try:
        result = run(request)
        assert result.returncode != 0
        assert "path must stay within the repository" in result.stderr + result.stdout
    finally:
        request.unlink(missing_ok=True)
