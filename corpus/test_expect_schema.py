#!/usr/bin/env python3
"""RED/GREEN controls for expect_schema.parse_expect.

Run: python3 corpus/test_expect_schema.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import expect_schema as S  # noqa: E402

# The pinned contract schema this repo already syncs (scripts/sync-acr-contracts.mjs),
# not a fresh acr checkout: `QuestionFamily` there is the same closed
# vocabulary expect_schema.FAMILIES mirrors by hand. Comparing FAMILIES only
# against ITSELF (iterating `for family in S.FAMILIES`) cannot detect a
# family silently dropped from FAMILIES -- this pins it against an
# independent, in-repo source of truth instead.
_SCHEMA_PATH = Path(__file__).parent.parent / "src/contracts/schemas/context_fabric_common.v1.schema.json"


class ExpectSchemaTestError(Exception):
    """Raised by `_require` -- never a bare `assert`. A bare `assert` is
    stripped at compile time under `python3 -O` / `PYTHONOPTIMIZE=1`, which
    would silently disable this guard under a valid Python runtime
    configuration; `_require` raises unconditionally, so no interpreter
    flag can remove it (see corpus/test_corpus.py for the same rule)."""


def _require(cond, msg):
    if not cond:
        raise ExpectSchemaTestError(msg)


_require(__debug__, "refusing to run under python -O / PYTHONOPTIMIZE=1: "
         "assert-stripping optimizations would silently weaken this guard")


def _serve(family="discovered_cohort_ranking"):
    return {"outcome": "serve", "answer": {"family": family}}


def test_scalar_forms_unchanged():
    for expect in [None, "serve", "refuse", "decline", "clarify"]:
        ok, reason, branches = S.parse_expect(expect)
        _require(ok, f"scalar {expect!r} must parse")
        _require(branches is None, f"scalar {expect!r} must not yield branches")
    ok, reason, branches = S.parse_expect("bogus")
    _require(not ok and branches is None, "unknown scalar must be rejected")
    _require("expect must be one of" in reason, f"wrong reason: {reason!r}")


def test_minimal_legal_any_of():
    ok, reason, branches = S.parse_expect({"any_of": [_serve(), {"outcome": "decline"}]})
    _require(ok, f"minimal legal any_of rejected: {reason!r}")
    _require(branches == [_serve(), {"outcome": "decline"}], "branches must be returned verbatim, in order")


def test_family_vocabulary_is_closed():
    ok, reason, _ = S.parse_expect({"any_of": [_serve("bogus_family")]})
    _require(not ok, "unknown family must be rejected")
    _require("answer.family" in reason, f"wrong reason: {reason!r}")
    for family in S.FAMILIES:
        ok, reason, _ = S.parse_expect({"any_of": [_serve(family)]})
        _require(ok, f"{family!r} is in FAMILIES but rejected: {reason!r}")


def test_family_vocabulary_matches_the_pinned_contract_schema():
    # Independent of S.FAMILIES: reads the synced schema file directly, so
    # a FAMILIES that silently lost (or gained) a member relative to the
    # pinned contract fails here, not only against its own membership.
    schema = json.loads(_SCHEMA_PATH.read_text())
    pinned = set(schema["$defs"]["QuestionFamily"]["enum"])
    _require(pinned, f"no QuestionFamily enum found at {_SCHEMA_PATH}")
    _require(S.FAMILIES == pinned,
              f"expect_schema.FAMILIES {sorted(S.FAMILIES)} != pinned contract QuestionFamily {sorted(pinned)}")


_RED_CASES = [
    ([], "any_of"),
    ({"any_of": []}, "any_of"),
    ({"any_of": ["serve"]}, "not a mapping"),
    ({"any_of": [{"outcome": ["serve"]}]}, "outcome"),
    ({"any_of": [{"outcome": "bogus"}]}, "outcome"),
    ({"any_of": [_serve(), _serve()]}, "duplicates"),
    ({"any_of": [{"outcome": "serve"}]}, "requires answer"),
    ({"any_of": [{"outcome": "decline", "answer": {}}]}, "only applies to outcome=serve"),
    ({"any_of": [_serve()], "unknown": True}, "exactly one key"),
    ({"any_of": [{"outcome": "decline", "basis": 3}]}, "basis"),
    ({"any_of": [{"outcome": "decline", "extra": 1}]}, "unsupported keys"),
]


def test_invalid_alternative_cannot_hide_behind_valid_branch():
    for expect, must_mention in _RED_CASES:
        ok, reason, branches = S.parse_expect(expect)
        _require(not ok, f"RED CONTROL FAILED: {expect!r} was accepted")
        _require(branches is None, f"RED CONTROL FAILED: {expect!r} returned branches on rejection")
        _require(must_mention in (reason or ""),
                 f"RED CONTROL FAILED: {expect!r} rejected for the wrong reason: {reason!r}")
    # Two DIFFERENT valid branches must not collide with the duplicate check.
    ok, reason, branches = S.parse_expect({"any_of": [_serve(), {"outcome": "decline"}]})
    _require(ok and len(branches) == 2, "two distinct branches must both survive")


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for test in tests:
        test()
        print(f"PASS: {test.__name__}")
    print(f"PASS: {len(tests)} expect_schema controls")


if __name__ == "__main__":
    main()
