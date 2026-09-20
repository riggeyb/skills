#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import shlex
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path.cwd()
PROFILE_PATH = ROOT / '.gpt' / 'verification.yaml'
EVIDENCE = ROOT / '.verification-evidence'
SUMMARY = EVIDENCE / 'verification-summary.json'
STAGES = ['preflight', 'static', 'unit', 'contract', 'mutation', 'integration', 'build', 'browser', 'smoke', 'security', 'determinism']


def fail(msg: str) -> int:
    print(f'VERIFICATION_ERROR: {msg}', file=sys.stderr)
    return 2


def normalize_commands(value):
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError('stage value must be a list')
    result = []
    for i, item in enumerate(value):
        if isinstance(item, str):
            result.append({'name': f'command-{i+1}', 'run': item, 'timeout_seconds': 1800})
        elif isinstance(item, dict) and isinstance(item.get('run'), str):
            result.append({'name': item.get('name') or f'command-{i+1}', 'run': item['run'], 'timeout_seconds': int(item.get('timeout_seconds', 1800))})
        else:
            raise ValueError('commands must be strings or mappings containing run')
    return result


def main() -> int:
    if not PROFILE_PATH.is_file():
        return fail('.gpt/verification.yaml is missing')
    raw = PROFILE_PATH.read_bytes()
    data = yaml.safe_load(raw)
    if not isinstance(data, dict) or data.get('version') != 1:
        return fail('verification profile version must be 1')
    profiles = data.get('profiles')
    requested = os.environ.get('VERIFICATION_PROFILE', 'full')
    if not isinstance(profiles, dict) or requested not in profiles:
        return fail(f'unknown verification profile: {requested}')
    profile = profiles[requested]
    if not isinstance(profile, dict):
        return fail('selected profile must be a mapping')

    EVIDENCE.mkdir(exist_ok=True)
    started = datetime.now(timezone.utc).isoformat()
    summary = {
        'schema_version': 1,
        'verification_id': os.environ.get('VERIFICATION_ID'),
        'profile': requested,
        'profile_sha256': hashlib.sha256(raw).hexdigest(),
        'repository': os.environ.get('GITHUB_REPOSITORY'),
        'requested_sha': os.environ.get('GITHUB_SHA'),
        'runner_started_at': started,
        'result': 'PASS',
        'stages': [],
    }

    try:
        for stage in STAGES:
            commands = normalize_commands(profile.get(stage))
            if not commands:
                continue
            stage_result = {'stage': stage, 'result': 'PASS', 'commands': []}
            for index, command in enumerate(commands):
                log_name = f'{stage}-{index+1}.log'
                log_path = EVIDENCE / log_name
                before = time.monotonic()
                try:
                    completed = subprocess.run(
                        command['run'], shell=True, cwd=ROOT, text=True,
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                        timeout=command['timeout_seconds'], executable='/bin/bash'
                    )
                    output = completed.stdout or ''
                    exit_code = completed.returncode
                except subprocess.TimeoutExpired as exc:
                    output = (exc.stdout or '') + '\nTIMEOUT\n'
                    exit_code = 124
                duration = round(time.monotonic() - before, 3)
                log_path.write_text(output, encoding='utf-8', errors='replace')
                record = {
                    'name': command['name'],
                    'command': command['run'],
                    'exit_code': exit_code,
                    'duration_seconds': duration,
                    'log': log_name,
                    'result': 'PASS' if exit_code == 0 else 'FAIL',
                }
                stage_result['commands'].append(record)
                print(f"[{stage}] {command['name']}: {record['result']} ({duration}s)")
                if exit_code != 0:
                    stage_result['result'] = 'FAIL'
                    summary['result'] = 'FAIL'
                    break
            summary['stages'].append(stage_result)
            if stage_result['result'] == 'FAIL':
                break
    except (ValueError, OSError) as exc:
        summary['result'] = 'ERROR'
        summary['error'] = str(exc)

    summary['runner_completed_at'] = datetime.now(timezone.utc).isoformat()
    SUMMARY.write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    print(f"VERIFICATION_RESULT={summary['result']}")
    return 0 if summary['result'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
