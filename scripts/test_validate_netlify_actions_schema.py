#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts" / "validate_netlify_actions_schema.py"

spec = importlib.util.spec_from_file_location("validate_netlify_actions_schema", VALIDATOR)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class NetlifyActionsSchemaValidationTests(unittest.TestCase):
    def mutate_and_validate(self, schema: dict) -> list[str]:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "schema.json"
            path.write_text(json.dumps(schema), encoding="utf-8")
            return mod.validate(path)

    def test_current_schema_passes(self) -> None:
        errors = mod.validate()
        self.assertEqual(errors, [])

    def test_missing_required_build_sha_is_rejected(self) -> None:
        schema = json.loads((ROOT / "openapi" / "netlify-evidence-action.json").read_text(encoding="utf-8"))
        build_schema = (
            schema["paths"]["/builds/{build_id}"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
        )
        build_schema = mod.resolve_local_ref(schema, build_schema)
        self.assertIsInstance(build_schema, dict)
        self.assertIn("required", build_schema)
        build_schema["required"] = [x for x in build_schema["required"] if x != "sha"]

        errors = self.mutate_and_validate(schema)
        self.assertTrue(any("must require sha" in error for error in errors), errors)

    def test_resolve_local_ref_follows_component_paths(self) -> None:
        doc = {"components": {"schemas": {"Value": {"type": "object", "properties": {"x": {"type": "string"}}}}}}
        resolved = mod.resolve_local_ref(doc, {"$ref": "#/components/schemas/Value"})
        self.assertEqual(resolved, doc["components"]["schemas"]["Value"])

    def test_non_get_operation_is_rejected(self) -> None:
        schema = json.loads((ROOT / "openapi" / "netlify-evidence-action.json").read_text(encoding="utf-8"))
        schema["paths"]["/sites"]["post"] = dict(schema["paths"]["/sites"]["get"])
        errors = self.mutate_and_validate(schema)
        self.assertTrue(any("only GET operations are allowed" in error for error in errors), errors)

    def test_missing_required_operation_is_rejected(self) -> None:
        schema = json.loads((ROOT / "openapi" / "netlify-evidence-action.json").read_text(encoding="utf-8"))
        del schema["paths"]["/builds/{build_id}"]
        errors = self.mutate_and_validate(schema)
        self.assertTrue(any("required operation 'getNetlifySiteBuild' is missing" in error for error in errors), errors)

    def test_missing_bearer_security_is_rejected(self) -> None:
        schema = json.loads((ROOT / "openapi" / "netlify-evidence-action.json").read_text(encoding="utf-8"))
        schema["security"] = []
        errors = self.mutate_and_validate(schema)
        self.assertTrue(any("top-level security must include bearerAuth" in error for error in errors), errors)


if __name__ == "__main__":
    unittest.main(verbosity=2)
