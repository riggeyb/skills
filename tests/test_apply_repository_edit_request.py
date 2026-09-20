from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "scripts" / "apply_repository_edit_request.py"
SENTINEL = ROOT / ".repository-edit-tests"

def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def git_blob_sha(path: Path) -> str:
    data = path.read_bytes()
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def write_request(path: Path, *, target: Path, anchor: str, insertion: str, expected: str | None = None, git_sha: str | None = None) -> None:
    payload = {"version": 1, "operation": "insert-after-unique", "path": str(target.relative_to(ROOT)), "anchor": anchor, "insertion": insertion}
    if git_sha is not None:
        payload["expected_source_git_blob_sha"] = git_sha
    else:
        payload["expected_source_sha256"] = expected or sha256(target)
    path.write_text(json.dumps(payload), encoding="utf-8")

def run(request: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, str(RUNNER), str(request)], cwd=ROOT, text=True, capture_output=True)

def setup(data: bytes) -> tuple[Path, Path]:
    SENTINEL.mkdir(exist_ok=True)
    target = SENTINEL / "target.txt"
    request = SENTINEL / "request.json"
    target.write_bytes(data)
    return target, request

def cleanup() -> None:
    shutil.rmtree(SENTINEL, ignore_errors=True)
    shutil.rmtree(ROOT / ".repository-edit-work", ignore_errors=True)

def test_applies_unique_insertion_and_preserves_crlf():
    target, request = setup(b"a\r\nanchor\r\nz\r\n")
    try:
        write_request(request, target=target, anchor="anchor\r\n", insertion="inserted\r\n")
        result = run(request)
        assert result.returncode == 0, result.stderr
        assert target.read_bytes() == b"a\r\nanchor\r\ninserted\r\nz\r\n"
    finally:
        cleanup()

def test_applies_with_git_blob_sha_precondition():
    target, request = setup(b"anchor\n")
    try:
        write_request(request, target=target, anchor="anchor\n", insertion="x\n", git_sha=git_blob_sha(target))
        result = run(request)
        assert result.returncode == 0, result.stderr
        assert target.read_bytes() == b"anchor\nx\n"
    finally:
        cleanup()

def test_rejects_stale_source_hash():
    target, request = setup(b"anchor\n")
    try:
        write_request(request, target=target, anchor="anchor\n", insertion="x\n", expected="0" * 64)
        result = run(request)
        assert result.returncode != 0
        assert "source hash mismatch" in result.stderr + result.stdout
        assert target.read_bytes() == b"anchor\n"
    finally:
        cleanup()

def test_rejects_stale_git_blob_sha():
    target, request = setup(b"anchor\n")
    try:
        write_request(request, target=target, anchor="anchor\n", insertion="x\n", git_sha="0" * 40)
        result = run(request)
        assert result.returncode != 0
        assert "source Git blob SHA mismatch" in result.stderr + result.stdout
        assert target.read_bytes() == b"anchor\n"
    finally:
        cleanup()

def test_rejects_ambiguous_anchor():
    target, request = setup(b"anchor\nanchor\n")
    try:
        write_request(request, target=target, anchor="anchor\n", insertion="x\n")
        result = run(request)
        assert result.returncode != 0
        assert "anchor must occur exactly once" in result.stderr + result.stdout
    finally:
        cleanup()

def test_rejects_path_escape():
    SENTINEL.mkdir(exist_ok=True)
    request = SENTINEL / "request.json"
    payload = {"version": 1, "operation": "insert-after-unique", "path": "../outside.txt", "expected_source_sha256": "0" * 64, "anchor": "a", "insertion": "b"}
    request.write_text(json.dumps(payload), encoding="utf-8")
    try:
        result = run(request)
        assert result.returncode != 0
        assert "path must stay within the repository" in result.stderr + result.stdout
    finally:
        cleanup()
