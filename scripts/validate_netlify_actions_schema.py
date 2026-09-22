#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "openapi" / "netlify-evidence-action.json"
EXPECTED_SERVER = "https://api.netlify.com/api/v1"
HTTP_METHODS = {"get", "put", "post", "delete", "patch", "options", "head", "trace"}
REQUIRED_OPERATION_IDS = {
    "listNetlifySites",
    "listNetlifySiteDeploys",
    "getNetlifySiteDeploy",
    "getNetlifySiteBuild",
}


def has_bearer_requirement(security: object) -> bool:
    if not isinstance(security, list):
        return False
    for requirement in security:
        if isinstance(requirement, dict) and "bearerAuth" in requirement:
            scopes = requirement.get("bearerAuth")
            if isinstance(scopes, list):
                return True
    return False


def validate() -> list[str]:
    errors: list[str] = []
    try:
        doc = json.loads(SCHEMA.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"{SCHEMA}: {exc}"]

    if not isinstance(doc.get("openapi"), str) or not str(doc["openapi"]).startswith("3."):
        errors.append(f"{SCHEMA}: openapi must be a 3.x version string")

    if doc.get("servers") != [{"url": EXPECTED_SERVER}]:
        errors.append(f"{SCHEMA}: server must be exactly {EXPECTED_SERVER}")

    components = doc.get("components")
    schemes = components.get("securitySchemes") if isinstance(components, dict) else None
    bearer = schemes.get("bearerAuth") if isinstance(schemes, dict) else None
    if bearer != {"type": "http", "scheme": "bearer"}:
        errors.append(f"{SCHEMA}: components.securitySchemes.bearerAuth must be http bearer")

    global_security = doc.get("security")
    if not has_bearer_requirement(global_security):
        errors.append(f"{SCHEMA}: top-level security must include bearerAuth")

    paths = doc.get("paths")
    if not isinstance(paths, dict):
        return [f"{SCHEMA}: paths must be an object"]

    seen: set[str] = set()
    for route, path_item in paths.items():
        if not isinstance(path_item, dict):
            errors.append(f"{route}: path item must be an object")
            continue
        for method, operation in path_item.items():
            if method.lower() not in HTTP_METHODS:
                continue
            if method.lower() != "get":
                errors.append(f"{route} {method}: only GET operations are allowed")
            if not isinstance(operation, dict):
                errors.append(f"{route} {method}: operation must be an object")
                continue

            op_id = operation.get("operationId")
            if not isinstance(op_id, str) or not op_id:
                errors.append(f"{route} {method}: operationId is required")
                continue
            if op_id in seen:
                errors.append(f"{route} {method}: duplicate operationId {op_id!r}")
            seen.add(op_id)

            if operation.get("x-openai-isConsequential") is not False:
                errors.append(f"{route} {method} {op_id}: x-openai-isConsequential must be false")

            effective_security = operation.get("security", global_security)
            if not has_bearer_requirement(effective_security):
                errors.append(f"{route} {method} {op_id}: bearerAuth security is required")

    missing = REQUIRED_OPERATION_IDS - seen
    unexpected = seen - REQUIRED_OPERATION_IDS
    for op_id in sorted(missing):
        errors.append(f"{SCHEMA}: required operation {op_id!r} is missing")
    for op_id in sorted(unexpected):
        errors.append(f"{SCHEMA}: unexpected operation {op_id!r}; only the four bounded read operations are allowed")

    return errors


def main() -> int:
    errors = validate()
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
            print(f"::error title=Netlify Actions schema compatibility::{error}")
        print(f"\nNetlify Actions schema compatibility check failed with {len(errors)} error(s).")
        return 1
    print("Netlify Actions schema compatibility check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
