#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = [ROOT / "openapi" / "github-skills-action.json"]
MAX_OPERATION_DESCRIPTION = 300
HTTP_METHODS = {"get", "put", "post", "delete", "patch", "options", "head", "trace"}


def walk_schema(node: Any, path: tuple[str, ...], errors: list[str]) -> None:
    if isinstance(node, dict):
        if node.get("type") == "object" and "properties" not in node:
            errors.append(f"{'/'.join(path)}: object schema missing properties")
        if "oneOf" in node:
            errors.append(f"{'/'.join(path)}: oneOf is not allowed in GPT Actions response schemas")
        for key, value in node.items():
            walk_schema(value, path + (str(key),), errors)
    elif isinstance(node, list):
        for i, value in enumerate(node):
            walk_schema(value, path + (str(i),), errors)


def validate(path: Path) -> list[str]:
    errors: list[str] = []
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"{path}: {exc}"]

    paths = doc.get("paths")
    if not isinstance(paths, dict):
        return [f"{path}: paths must be an object"]

    seen_ids: set[str] = set()
    for route, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method.lower() not in HTTP_METHODS or not isinstance(operation, dict):
                continue
            op_id = operation.get("operationId")
            if not isinstance(op_id, str) or not op_id:
                errors.append(f"{route} {method}: operationId is required")
            elif op_id in seen_ids:
                errors.append(f"{route} {method}: duplicate operationId {op_id!r}")
            else:
                seen_ids.add(op_id)

            description = operation.get("description", "")
            if not isinstance(description, str):
                errors.append(f"{route} {method}: description must be a string")
            elif len(description) > MAX_OPERATION_DESCRIPTION:
                errors.append(
                    f"{route} {method} {op_id}: description length {len(description)} exceeds {MAX_OPERATION_DESCRIPTION}"
                )

            responses = operation.get("responses", {})
            walk_schema(responses, (route, method, "responses"), errors)

    return errors


def main() -> int:
    errors: list[str] = []
    for schema in SCHEMAS:
        errors.extend(validate(schema))
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"\nGPT Actions schema compatibility check failed with {len(errors)} error(s).")
        return 1
    print("GPT Actions schema compatibility check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
