#!/usr/bin/env python3
"""CHAOS-5620: shared node-shim plumbing for validating a Python payload
against a real JSON Schema (the pinned contract's, or ask-dev's own
`corpus/schemas/`) via `scripts/validate_json_schema.mjs` -- the same ajv
setup `src/lib/acr/validate.ts` already uses in product code, no new
dependency. Used by both expect_schema.py (the `any_of` declaration shape)
and semantic_verdict.py (window/confirmation shapes actually recorded on
the wire), so there is exactly one subprocess-invocation implementation to
get right, not two.

This is the ONLY acceptance oracle: neither caller re-implements any part
of a shape rule (a required field, a type, a format, a numeric bound) in
Python. A payload's validity, and any ordering fact about its own fields
(the shim computes `start`/`end` ordering via JS `Date.parse`, since JSON
Schema has no "field A before field B" keyword), come from here alone.
"""
import json
import subprocess
from pathlib import Path

_SHIM = Path(__file__).resolve().parent.parent / "scripts" / "validate_json_schema.mjs"


def validate_via_schema(schema_file, json_pointer, payload):
    """(valid, errors, ordered_ascending) for `payload` against
    `<schema_file><json_pointer>`.

    NEVER RAISES. Every way the validator itself can break -- `node`
    missing, a timeout, a non-zero exit outside 0/1, unreadable or
    malformed stdout -- returns `(None, ["validator_unavailable: ..."], None)`
    instead: `valid is None` is the caller's signal that the validator
    itself is unavailable, distinct from `valid is False` (the payload was
    read and is invalid) so a caller can score/report the two differently
    (an infrastructure failure is not the same fact as a malformed
    exchange). `ordered_ascending` is `None` when the payload carries no
    `start`/`end` pair to order, or when the shim itself is unavailable.
    """
    try:
        proc = subprocess.run(
            ["node", str(_SHIM), schema_file, json_pointer],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, [f"validator_unavailable: could not run node for validate_json_schema.mjs: {exc}"], None
    if proc.returncode not in (0, 1):
        return None, [f"validator_unavailable: validate_json_schema.mjs exited {proc.returncode}: "
                       f"{proc.stderr.strip()}"], None
    try:
        result = json.loads(proc.stdout)
        return result["valid"], result["errors"], result.get("orderedAscending")
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        return None, [f"validator_unavailable: validate_json_schema.mjs produced unreadable output "
                       f"(stdout={proc.stdout!r}, stderr={proc.stderr!r}): {exc}"], None
