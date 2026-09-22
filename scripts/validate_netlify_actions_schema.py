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


def resolve_local_ref(doc: dict, node: object) -> object:
    seen: set[str] = set()
    current = node
    while isinstance(current, dict) and "$ref" in current:
        ref = current.get("$ref")
        if not isinstance(ref, str) or not ref.startswith("#/"):
            return {}
        if ref in seen:
            return {}
        seen.add(ref)
        target: object = doc
        for raw_part in ref[2:].split("/"):
            part = raw_part.replace("~1", "/").replace("~0", "~")
            if not isinstance(target, dict) or part not in target:
                return {}
            target = target[part]
        current = target
    return current


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
    operations_by_id: dict[str, dict] = {}
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
            operations_by_id[op_id] = operation

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

    sites_op = operations_by_id.get("listNetlifySites", {})
    sites_schema = (
        sites_op.get("responses", {})
        .get("200", {})
        .get("content", {})
        .get("application/json", {})
        .get("schema", {})
    )
    site_items = sites_schema.get("items", {}) if isinstance(sites_schema, dict) else {}
    site_items = resolve_local_ref(doc, site_items)
    site_props = site_items.get("properties", {}) if isinstance(site_items, dict) else {}
    build_settings = site_props.get("build_settings", {}) if isinstance(site_props, dict) else {}
    build_settings = resolve_local_ref(doc, build_settings)
    build_settings_props = build_settings.get("properties", {}) if isinstance(build_settings, dict) else {}
    for required_prop in ("repo_path", "repo_url"):
        if required_prop not in build_settings_props:
            errors.append(f"{SCHEMA}: listNetlifySites response must include build_settings.{required_prop}")

    deploy_schema = (
        doc.get("components", {})
        .get("schemas", {})
        .get("Deploy", {})
    )
    deploy_schema = resolve_local_ref(doc, deploy_schema)
    deploy_props = deploy_schema.get("properties", {}) if isinstance(deploy_schema, dict) else {}
    for required_prop in ("id", "site_id", "build_id", "state", "commit_ref", "error_message"):
        if required_prop not in deploy_props:
            errors.append(f"{SCHEMA}: Deploy schema must include {required_prop}")
    deploy_required = deploy_schema.get("required", []) if isinstance(deploy_schema, dict) else []
    for required_prop in ("id", "site_id", "state"):
        if required_prop not in deploy_required:
            errors.append(f"{SCHEMA}: Deploy schema must require {required_prop}")

    build_op = operations_by_id.get("getNetlifySiteBuild", {})
    build_schema = (
        build_op.get("responses", {})
        .get("200", {})
        .get("content", {})
        .get("application/json", {})
        .get("schema", {})
    )
    build_schema = resolve_local_ref(doc, build_schema)
    build_props = build_schema.get("properties", {}) if isinstance(build_schema, dict) else {}
    for required_prop in ("id", "deploy_id", "sha", "done", "error", "created_at"):
        if required_prop not in build_props:
            errors.append(f"{SCHEMA}: getNetlifySiteBuild response must include {required_prop}")
    build_required = build_schema.get("required", []) if isinstance(build_schema, dict) else []
    for required_prop in ("id", "deploy_id", "sha", "done"):
        if required_prop not in build_required:
            errors.append(f"{SCHEMA}: getNetlifySiteBuild response must require {required_prop}")

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
