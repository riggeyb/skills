#!/usr/bin/env python3
"""Validate registry structure and optionally verify GitHub resources.

Local/static validation requires only PyYAML.
Remote validation is enabled with --remote and uses unauthenticated GitHub REST
requests unless GITHUB_TOKEN is present in the environment.
"""

from __future__ import annotations

import argparse
import fnmatch
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

import yaml

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "registry.yaml"
CAPABILITIES_PATH = ROOT / "capabilities.yaml"
VALID_MODES = {"instruction", "hybrid", "reference"}
REPO_RE = re.compile(r"^[^/\s]+/[^/\s]+$")
SHA_RE = re.compile(r"^[0-9a-fA-F]{40}$")


def load_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict):
        raise ValueError(f"{path}: top level must be a mapping")
    return data


def github_json(url: str) -> Any:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "riggeyb-skills-validator",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = os.getenv("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(url, headers=headers)
    with urlopen(req, timeout=20) as resp:
        import json
        return json.load(resp)


def validate_static(registry: dict[str, Any], capabilities: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    if registry.get("version") != 2:
        errors.append("registry.yaml: version must be 2")

    meta = registry.get("registry")
    if not isinstance(meta, dict):
        errors.append("registry.yaml: registry must be a mapping")
        meta = {}

    defaults = registry.get("defaults")
    if not isinstance(defaults, dict):
        errors.append("registry.yaml: defaults must be a mapping")
        defaults = {}

    runtime = registry.get("runtime")
    if not isinstance(runtime, dict):
        errors.append("registry.yaml: runtime must be a mapping")
        runtime = {}

    for key in ("max_instruction_skills", "max_reference_skills", "max_total_skills"):
        value = runtime.get(key)
        if not isinstance(value, int) or value < 1:
            errors.append(f"runtime.{key}: must be a positive integer")

    if runtime.get("max_total_skills", 0) < max(runtime.get("max_instruction_skills", 0), runtime.get("max_reference_skills", 0)):
        errors.append("runtime.max_total_skills must be >= each per-mode budget")

    skills = registry.get("skills")
    if not isinstance(skills, list) or not skills:
        errors.append("registry.yaml: skills must be a non-empty list")
        skills = []

    ids: set[str] = set()
    aliases: set[str] = set()

    for idx, skill in enumerate(skills):
        loc = f"skills[{idx}]"
        if not isinstance(skill, dict):
            errors.append(f"{loc}: must be a mapping")
            continue

        sid = skill.get("id")
        if not isinstance(sid, str) or not sid:
            errors.append(f"{loc}.id: required string")
        elif sid in ids:
            errors.append(f"{loc}.id: duplicate id {sid!r}")
        else:
            ids.add(sid)

        repo = skill.get("repository")
        if not isinstance(repo, str) or not REPO_RE.match(repo):
            errors.append(f"{loc}.repository: must be owner/repo")

        mode = skill.get("mode")
        if mode not in VALID_MODES:
            errors.append(f"{loc}.mode: must be one of {sorted(VALID_MODES)}")

        entrypoints = skill.get("entrypoints")
        if not isinstance(entrypoints, list) or not entrypoints or not all(isinstance(x, str) and x for x in entrypoints):
            errors.append(f"{loc}.entrypoints: must be a non-empty list of strings")

        triggers = skill.get("triggers")
        if not isinstance(triggers, list) or not triggers or not all(isinstance(x, str) and x for x in triggers):
            errors.append(f"{loc}.triggers: must be a non-empty list of strings")

        trust = skill.get("trust", defaults.get("trust"))
        if trust not in {"first-party", "external"}:
            errors.append(f"{loc}.trust: must resolve to first-party or external")

        last_reviewed = skill.get("last_reviewed", defaults.get("last_reviewed"))
        if not isinstance(last_reviewed, str) or not re.match(r"^\d{4}-\d{2}-\d{2}$", last_reviewed):
            errors.append(f"{loc}.last_reviewed: must resolve to YYYY-MM-DD string")

        update_policy = skill.get("update_policy", defaults.get("update_policy"))
        if update_policy not in {"reviewed", "follow-default"}:
            errors.append(f"{loc}.update_policy: must resolve to reviewed or follow-default")

        ref = skill.get("ref")
        if mode in {"instruction", "hybrid"} and trust == "external":
            if update_policy != "reviewed":
                errors.append(f"{loc}: external {mode} skill must use update_policy: reviewed")
            if not isinstance(ref, str) or not SHA_RE.match(ref):
                errors.append(f"{loc}.ref: external {mode} skill must be pinned to a 40-char commit SHA")

        if mode == "hybrid" and not skill.get("skill_globs"):
            errors.append(f"{loc}.skill_globs: hybrid skills require explicit instructional globs")

        for field in ("skill_globs", "reference_globs", "aliases"):
            value = skill.get(field, [])
            if not isinstance(value, list) or not all(isinstance(x, str) and x for x in value):
                errors.append(f"{loc}.{field}: must be a list of strings when present")

        for alias in skill.get("aliases", []) if isinstance(skill.get("aliases", []), list) else []:
            if alias in aliases:
                errors.append(f"{loc}.aliases: duplicate alias {alias!r}")
            aliases.add(alias)

        if trust == "first-party" and repo == "riggeyb/skills":
            for entry in skill.get("entrypoints", []):
                if not (ROOT / entry).is_file():
                    errors.append(f"first-party entrypoint missing locally: {entry}")

    if capabilities.get("version") != 1:
        errors.append("capabilities.yaml: version must be 1")
    if not isinstance(capabilities.get("capabilities"), dict):
        errors.append("capabilities.yaml: capabilities must be a mapping")

    policy = meta.get("policy")
    if not isinstance(policy, str) or not (ROOT / policy).is_file():
        errors.append("registry.policy must point to an existing local file")

    cap_file = meta.get("capabilities")
    if not isinstance(cap_file, str) or not (ROOT / cap_file).is_file():
        errors.append("registry.capabilities must point to an existing local file")

    return errors


def validate_remote(registry: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    skills = registry.get("skills", [])

    for skill in skills:
        if not isinstance(skill, dict):
            continue
        repo = skill.get("repository")
        sid = skill.get("id", repo)
        if not isinstance(repo, str):
            continue
        try:
            metadata = github_json(f"https://api.github.com/repos/{repo}")
        except HTTPError as e:
            errors.append(f"{sid}: repository check failed HTTP {e.code}: {repo}")
            continue
        except URLError as e:
            errors.append(f"{sid}: repository check failed: {e}")
            continue

        default_branch = metadata.get("default_branch")
        ref = skill.get("ref") or default_branch
        if not ref:
            errors.append(f"{sid}: could not determine ref")
            continue

        if skill.get("ref"):
            try:
                github_json(f"https://api.github.com/repos/{repo}/commits/{quote(str(ref), safe='')}")
            except HTTPError as e:
                errors.append(f"{sid}: pinned ref {ref} failed HTTP {e.code}")

        needs_tree = bool(skill.get("skill_globs") or skill.get("reference_globs"))
        if needs_tree:
            try:
                tree_data = github_json(f"https://api.github.com/repos/{repo}/git/trees/{quote(str(ref), safe='')}?recursive=1")
                tree = tree_data.get("tree", []) if isinstance(tree_data, dict) else []
                paths = {item.get("path") for item in tree if isinstance(item, dict)}
                for field in ("skill_globs", "reference_globs"):
                    for pattern in skill.get(field, []):
                        if not any(isinstance(p, str) and fnmatch.fnmatchcase(p, pattern) for p in paths):
                            errors.append(f"{sid}: {field} pattern matches no path: {pattern}")
            except HTTPError as e:
                errors.append(f"{sid}: tree check failed HTTP {e.code}")

        for entry in skill.get("entrypoints", []):
            url = f"https://api.github.com/repos/{repo}/contents/{quote(entry, safe='/')}?ref={quote(str(ref), safe='')}"
            try:
                github_json(url)
            except HTTPError as e:
                errors.append(f"{sid}: entrypoint missing/inaccessible HTTP {e.code}: {entry}@{ref}")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--remote", action="store_true", help="verify repositories, refs, entrypoints and globs via GitHub")
    args = parser.parse_args()

    try:
        registry = load_yaml(REGISTRY_PATH)
        capabilities = load_yaml(CAPABILITIES_PATH)
    except (OSError, ValueError, yaml.YAMLError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    errors = validate_static(registry, capabilities)
    if args.remote:
        errors.extend(validate_remote(registry))

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"\nValidation failed with {len(errors)} error(s).")
        return 1

    scope = "static + remote" if args.remote else "static"
    print(f"Registry validation passed ({scope}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
