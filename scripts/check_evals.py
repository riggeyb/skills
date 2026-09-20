#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
CASES = ROOT / "evals" / "cases.yaml"
REGISTRY = ROOT / "registry.yaml"


def load(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def main() -> int:
    errors: list[str] = []
    cases = load(CASES)
    registry = load(REGISTRY)

    skills = registry.get("skills", []) if isinstance(registry, dict) else []
    known_ids = {s.get("id") for s in skills if isinstance(s, dict) and isinstance(s.get("id"), str)}

    if not isinstance(cases, dict) or cases.get("version") != 1:
        errors.append("evals/cases.yaml must have version: 1")
        case_list = []
    else:
        case_list = cases.get("cases", [])

    if not isinstance(case_list, list) or not case_list:
        errors.append("evals/cases.yaml must contain a non-empty cases list")
        case_list = []

    seen: set[str] = set()
    for i, case in enumerate(case_list):
        loc = f"cases[{i}]"
        if not isinstance(case, dict):
            errors.append(f"{loc} must be a mapping")
            continue
        cid = case.get("id")
        if not isinstance(cid, str) or not cid:
            errors.append(f"{loc}.id must be a non-empty string")
        elif cid in seen:
            errors.append(f"duplicate eval id: {cid}")
        else:
            seen.add(cid)

        if not isinstance(case.get("prompt"), str) or not case.get("prompt"):
            errors.append(f"{loc}.prompt must be a non-empty string")
        rb = case.get("required_behaviors")
        if not isinstance(rb, list) or not rb or not all(isinstance(x, str) and x for x in rb):
            errors.append(f"{loc}.required_behaviors must be a non-empty list of strings")

        for field in ("expected_skills", "optional_skills", "expected_reference_skills"):
            values = case.get(field, [])
            if not isinstance(values, list):
                errors.append(f"{loc}.{field} must be a list")
                continue
            for sid in values:
                if sid not in known_ids:
                    errors.append(f"{loc}.{field}: unknown skill id {sid!r}")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"\nEval definition check failed with {len(errors)} error(s).")
        return 1

    print(f"Eval definition check passed ({len(case_list)} cases).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
