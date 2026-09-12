#!/usr/bin/env python3
"""CHAOS-5620: shared node-shim plumbing for validating a Python payload
against a real JSON Schema (the pinned contract's, or ask-dev's own
`corpus/schemas/`) via `scripts/validate_json_schema.mjs` -- the same ajv
setup `src/lib/acr/validate.ts` already uses in product code, no new
dependency. Used by both expect_schema.py (the `any_of` declaration shape)
and semantic_verdict.py (window/confirmation shapes actually recorded on
the wire), so there is exactly one subprocess-invocation implementation to
get right, not two.
"""
import json
import subprocess
from pathlib import Path

_SHIM = Path(__file__).resolve().parent.parent / "scripts" / "validate_json_schema.mjs"


class SchemaShimError(Exception):
    """The node shim itself failed (node missing, schema file missing,
    malformed shim output) -- never conflated with an ordinary invalid
    payload, which is a normal `(False, [...])` return."""


def validate_via_schema(schema_file, json_pointer, payload):
    """(valid, errors) for `payload` against `<schema_file><json_pointer>`.

    Raises SchemaShimError only when the validator itself could not run;
    an invalid payload is `(False, [error strings])`, never an exception,
    so a malformed row or a malformed exchange fails closed at its own
    call site's existing rules, not by an uncaught crash here.
    """
    proc = subprocess.run(
        ["node", str(_SHIM), schema_file, json_pointer],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=30,
    )
    if proc.returncode not in (0, 1):
        raise SchemaShimError(f"validate_json_schema.mjs exited {proc.returncode}: {proc.stderr.strip()}")
    result = json.loads(proc.stdout)
    return result["valid"], result["errors"]
