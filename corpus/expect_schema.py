#!/usr/bin/env python3
"""CHAOS-5620: the `expect` declaration's vocabulary and shape.

Shape validation is delegated to `corpus/schemas/expect.schema.json`
through `scripts/validate_json_schema.mjs` (a small node shim around the
SAME ajv setup `src/lib/acr/validate.ts` already uses in product code --
no new dependency). The `expect` declaration accepts EXACTLY what
`corpus/schemas/expect.schema.json` accepts: a `oneOf`/`uniqueItems`/
`additionalProperties:false` schema, not a hand-written Python check, so a
branch's key types, an `"answer": null` on a non-serve outcome, and
duplicate alternatives are all rejected by the schema's own shape rather
than by separate hand-maintained logic that can miss a cell. Its
legal/illegal cases are GENERATED from the schema's own required fields
(every required field absent, `null` in each slot, every `oneOf` branch),
with the schema validator itself as the pass/fail oracle -- see
test_expect_schema.py.

FAMILIES is read directly from the pinned, synced contract schema
(`context_fabric_common.v1.schema.json`'s `QuestionFamily` enum) at import
time, not hand-copied -- there is no longer a second spelling of the
vocabulary that could drift from the first.
"""
import json
import sys
from pathlib import Path

from schema_shim import validate_via_schema

SERVE, REFUSE, DECLINE, CLARIFY = "serve", "refuse", "decline", "clarify"

# The scalar `expect` vocabulary. Single source of truth: test_corpus.py
# imports this rather than re-spelling it, so the two can never drift.
EXPECT_VALUES = frozenset({SERVE, REFUSE, DECLINE, CLARIFY})

_ROOT = Path(__file__).resolve().parent.parent
_SCHEMAS_DIR = _ROOT / "src" / "contracts" / "schemas"
_EXPECT_SCHEMA = "expect.schema.json"


def _read_question_family_vocabulary():
    """FAMILIES is DERIVED from the pinned contract schema file, not
    hand-copied -- reading the same JSON `sync-acr-contracts.mjs` already
    keeps current, so there is nothing here for a corpus.py-side edit to
    forget to update."""
    doc = json.loads((_SCHEMAS_DIR / "context_fabric_common.v1.schema.json").read_text())
    return frozenset(doc["$defs"]["QuestionFamily"]["enum"])


FAMILIES = _read_question_family_vocabulary()


def _read_semantic_reading_reasons():
    """The two closed reasons a stored result's semantic-reading disclosure
    can carry (D49, CHAOS-5672, acr
    internal/contracts/v1/context_fabric_semantic_reading.go's
    `ContextFabricSemanticReadingReason` vocabulary), read directly from the
    pinned, synced contract schema's own `semantic_reading.reason` enum --
    not hand-copied, so CHAOS-5722's persisted-state absent/unreadable
    verdict reasons can never spell these two tokens differently from the
    engine's own wire disclosure. Fails loudly at import time (never a
    silent guess) if the synced schema's vocabulary ever stops being exactly
    these two members."""
    doc = json.loads((_SCHEMAS_DIR / "context_fabric_investigation_result.v1.schema.json").read_text())
    enum = frozenset(doc["properties"]["semantic_reading"]["properties"]["reason"]["enum"])
    absent, unreadable = "semantic_state_absent", "semantic_state_unreadable"
    if enum != {absent, unreadable}:
        raise RuntimeError(
            "context_fabric_investigation_result.v1.schema.json's semantic_reading.reason "
            f"vocabulary changed to {sorted(enum)!r} -- update expect_schema.py's mirror"
        )
    return absent, unreadable


SEMANTIC_STATE_ABSENT, SEMANTIC_STATE_UNREADABLE = _read_semantic_reading_reasons()

# Bump on any change to branch shape, vocabulary, or validation rule below --
# a published semantic verdict record carries this so a rescore under a
# changed schema is never silently compared to one scored under the old
# schema (see corpus/README.md "## Versioning").
SCHEMA_VERSION = "chaos-5620-any_of-v2-schema-validated"


def parse_expect(expect):
    """(ok, reason, branches) for a row's raw `expect` field.

    `branches` is `None` for the scalar/absent form (the legacy path
    applies unchanged); otherwise it is the validated list of branch dicts
    from `any_of`, in declaration order. Validity itself is decided by
    `corpus/schemas/expect.schema.json` (see this module's docstring) --
    an invalid alternative can never hide behind a valid sibling, because
    the schema validates the WHOLE `any_of` array as one document, not one
    branch at a time.
    """
    ok, errors, _ordered = validate_via_schema(_EXPECT_SCHEMA, "", expect)
    if ok is None:
        # The validator itself is unavailable -- never silently treated as
        # "this row is fine". `validator_unavailable` is a distinct reason
        # from an ordinary invalid declaration (infrastructure, not data).
        return False, "validator_unavailable: " + "; ".join(errors), None
    if not ok:
        return False, "expect does not match corpus/schemas/expect.schema.json: " + "; ".join(errors), None
    if expect is None or isinstance(expect, str):
        return True, None, None
    return True, None, expect["any_of"]


if __name__ == "__main__":
    # Manual smoke check: `python3 corpus/expect_schema.py '"serve"'`.
    print(parse_expect(json.loads(sys.argv[1]) if len(sys.argv) > 1 else None))
