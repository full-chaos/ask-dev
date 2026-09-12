#!/usr/bin/env python3
"""CHAOS-5620: schema-GENERATED shape tables. Each table's legal/illegal
cells are generated from the pinned contract schema itself, never
hand-enumerated.

The only hand-authored part is one SEED per legal top-level branch of each
$def (there is no generic JSON-Schema instance generator in this repo, and
building one is out of proportion to this ticket) -- e.g. WindowOption's
`relative_id` branch and its `start`+`end`-only branch. Everything after
that is mechanical and driven by the schema file itself, never a
hand-typed expectation:

  * every REQUIRED field of the $def, read from the schema's own
    `required` array, is mutated to absent and to `null` on every seed;
  * the PASS/FAIL verdict for every generated cell comes from ajv (via
    schema_shim -- the same validator this module's production code
    calls), never a hand-declared expectation. A cell this file does not
    predict correctly is impossible by construction: there is nothing
    here TO predict, only something to observe and print.

Run: python3 corpus/test_schema_driven_shapes.py
"""
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from schema_shim import validate_via_schema  # noqa: E402
import semantic_verdict as SV  # noqa: E402

_ROOT = Path(__file__).resolve().parent.parent
_SCHEMA_PATH = _ROOT / "src" / "contracts" / "schemas" / "context_fabric_common.v1.schema.json"
_SCHEMA_DOC = json.loads(_SCHEMA_PATH.read_text())


class SchemaDrivenShapeError(Exception):
    """Raised by `_require` -- never a bare `assert` (see test_corpus.py)."""


def _require(cond, msg):
    if not cond:
        raise SchemaDrivenShapeError(msg)


_require(__debug__, "refusing to run under python -O / PYTHONOPTIMIZE=1: "
         "assert-stripping optimizations would silently weaken this guard")


def _required_fields(def_name):
    """The $def's own `required` array, read from the schema file --
    never hand-copied. Missing entirely (not every $def has one) reads as
    empty, not an error."""
    return list(_SCHEMA_DOC["$defs"][def_name].get("required", []))


def _validate(def_name, payload):
    ok, errors, _ordered = validate_via_schema("context_fabric_common.v1.schema.json", f"#/$defs/{def_name}", payload)
    _require(ok is not None, f"validator_unavailable while validating {def_name}: {errors}")
    return ok, errors


def _generated_cells(def_name, seed_name, seed):
    """Yield (cell_name, payload) for the seed itself plus an absent- and
    a null-variant of EVERY FIELD THE SEED CARRIES -- not only the def's
    unconditional `required` array. A field required only on one branch
    (e.g. WindowOption's `start`/`end`, required by an `allOf`/`if`/`then`
    only when `relative_id` is not `all_time`) never appears in the def's
    own top-level `required` list, so limiting mutation to that list
    misses exactly the conditional cells a real exchange can still send.
    Mutating every field the seed itself carries, and letting ajv (not
    this function) decide whether each mutation is still valid, covers
    both kinds without this file having to parse the schema's own
    conditional logic by hand."""
    yield f"{seed_name}/seed", seed
    for field in seed:
        absent = dict(seed)
        del absent[field]
        yield f"{seed_name}/{field}_absent", absent
        null = dict(seed)
        null[field] = None
        yield f"{seed_name}/{field}_null", null


# One seed per legal top-level branch -- the only hand-authored part (see
# module docstring). Each is asserted valid on its own below, so a wrong
# seed fails loudly rather than silently seeding every generated cell from
# a shape the schema never actually accepts.
_WINDOW_OPTION_SEEDS = {
    "relative": {"receipt_id": "winr_90d000000", "option_id": "opt-90d", "label": "the last 90 days",
                 "relative_id": "trailing_90d", "start": "2026-05-01T00:00:00Z", "end": "2026-08-01T00:00:00Z"},
    "all_time": {"receipt_id": "winr_alltime00", "option_id": "opt-all", "label": "all time",
                 "relative_id": "all_time"},
    "explicit": {"receipt_id": "winr_explicit0", "option_id": "opt-exp", "label": "a custom range",
                 "start": "2026-05-01T00:00:00Z", "end": "2026-08-01T00:00:00Z"},
}

_EFFECTIVE_WINDOW_SEEDS = {
    "relative": {"provenance": "clarification_confirmed", "relative_id": "trailing_90d",
                 "start": "2026-05-01T00:00:00Z", "end": "2026-08-01T00:00:00Z"},
    "all_time": {"provenance": "inferred_default", "relative_id": "all_time"},
    "explicit": {"provenance": "question_stated", "start": "2026-05-01T00:00:00Z", "end": "2026-08-01T00:00:00Z"},
}

_CONFIRMED_STRUCTURE_ENTRY_SEEDS = {
    "receipt_sourced": {"member": "window", "applied_value": "trailing_90d", "source": "receipt",
                         "provenance": "clarification_confirmed", "disposition": "applied",
                         "prior_result_id": "result_0000001", "receipt_id": "winr_90d000000"},
}


def _run_table(def_name, seeds, extra_check=None):
    executed = []
    unconditional = _required_fields(def_name)
    for seed_name, seed in seeds.items():
        seed_ok, seed_errors = _validate(def_name, seed)
        _require(seed_ok, f"{def_name}/{seed_name} seed itself is not schema-valid: {seed_errors}")
        for cell_name, payload in _generated_cells(def_name, seed_name, seed):
            ok, errors = _validate(def_name, payload)
            executed.append((cell_name, ok, errors))
            print(f"SCHEMA_TABLE {def_name}/{cell_name}: valid={ok}" + (f" errors={errors}" if errors else ""))
            if extra_check is not None:
                extra_check(def_name, cell_name, payload, ok)
    # Removing or nulling one of the def's UNCONDITIONALLY required fields
    # must never leave the schema accepting the mutated payload, on ANY
    # seed -- a basic completeness sanity check that `required` is doing
    # anything at all. A field that is only conditionally required for ONE
    # branch (e.g. WindowOption's `start`, required only when `relative_id`
    # is not `all_time`) can legitimately still validate after removal, if
    # the seed also satisfies a DIFFERENT branch once that field is gone
    # (e.g. a `relative` seed carrying both `relative_id` and `start`/`end`
    # still matches the explicit-bounds branch with `relative_id` removed)
    # -- ajv's verdict there is observed, never asserted in one direction.
    for cell_name, ok, _errors in executed:
        field = cell_name.rsplit("/", 1)[-1].rsplit("_", 1)[0]
        if (cell_name.endswith("_absent") or cell_name.endswith("_null")) and field in unconditional:
            _require(not ok, f"{def_name}/{cell_name} was ACCEPTED despite removing/nulling an unconditionally "
                     f"required field")
    print(f"{def_name}: {len(executed)} generated cells executed")
    return executed


def _window_value_matches_ajv(def_name, cell_name, payload, ajv_valid):
    """window_value() must never diverge from ajv's own verdict: it must
    raise on exactly the payloads ajv rejects, and must not raise on the
    ones ajv accepts (ordering aside -- ajv does not check start<end,
    window_value additionally does)."""
    try:
        SV.window_value(payload, def_name)
        raised = False
    except ValueError:
        raised = True
    _require(raised == (not ajv_valid), f"{def_name}/{cell_name}: window_value raised={raised} but ajv valid={ajv_valid}")


def test_window_option_generated_table():
    _run_table("WindowOption", _WINDOW_OPTION_SEEDS, extra_check=_window_value_matches_ajv)


def test_effective_evidence_window_generated_table():
    _run_table("EffectiveEvidenceWindow", _EFFECTIVE_WINDOW_SEEDS, extra_check=_window_value_matches_ajv)


def test_confirmed_structure_entry_generated_table():
    _run_table("ConfirmedStructureEntry", _CONFIRMED_STRUCTURE_ENTRY_SEEDS)


def test_window_value_accepts_every_legal_seed_and_rejects_unordered_bounds():
    for name, seed in {**_WINDOW_OPTION_SEEDS}.items():
        value = SV.window_value(seed, "WindowOption")
        print(f"window_value(WindowOption/{name}) -> {value}")
    unordered = copy.deepcopy(_WINDOW_OPTION_SEEDS["explicit"])
    unordered["start"], unordered["end"] = unordered["end"], unordered["start"]
    try:
        SV.window_value(unordered, "WindowOption")
        _require(False, "unordered explicit bounds must raise even though ajv itself does not check ordering")
    except ValueError:
        pass


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for test in tests:
        test()
        print(f"PASS: {test.__name__}")
    print(f"PASS: {len(tests)} schema-driven shape controls")


if __name__ == "__main__":
    main()
