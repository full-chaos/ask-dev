#!/usr/bin/env python3
"""CHAOS-5620: schema_shim.validate_via_schema must NEVER RAISE -- every
way the validator itself can break (node missing, ajv/node_modules
missing, a timeout, empty or malformed stdout) returns `(None, [...], None)`
instead, so a caller can score it as `validator_unavailable` (an
infrastructure fact) rather than crash or silently read it as "the
payload is fine".

Run: python3 corpus/test_schema_shim.py
"""
import os
import sys
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import schema_shim as SS  # noqa: E402


class SchemaShimTestError(Exception):
    """Raised by `_require` -- never a bare `assert` (see test_corpus.py)."""


def _require(cond, msg):
    if not cond:
        raise SchemaShimTestError(msg)


_require(__debug__, "refusing to run under python -O / PYTHONOPTIMIZE=1: "
         "assert-stripping optimizations would silently weaken this guard")

_TABLE = []


def _record(name, valid, errors, ordered):
    _TABLE.append((name, valid, errors, ordered))
    print(f"SHIM_FAILURE_TABLE {name}: valid={valid!r} ordered={ordered!r}")


def test_missing_node_binary_fails_closed():
    old_path = os.environ.get("PATH")
    try:
        os.environ["PATH"] = "/nonexistent"
        valid, errors, ordered = SS.validate_via_schema(
            "context_fabric_common.v1.schema.json", "#/$defs/QuestionFamily", "trend"
        )
        _record("node_missing", valid, errors, ordered)
    finally:
        if old_path is not None:
            os.environ["PATH"] = old_path
    _require(valid is None, f"node missing must return valid=None, got {valid!r}")
    _require(any("validator_unavailable" in e for e in errors), errors)
    _require(ordered is None, ordered)


def _fake_run_returning(stdout, returncode=0):
    def _run(*args, **kwargs):
        return mock.Mock(returncode=returncode, stdout=stdout, stderr="")
    return _run


def test_empty_stdout_fails_closed():
    with mock.patch("schema_shim.subprocess.run", _fake_run_returning("")):
        valid, errors, ordered = SS.validate_via_schema(
            "context_fabric_common.v1.schema.json", "#/$defs/QuestionFamily", "trend"
        )
    _record("empty_stdout", valid, errors, ordered)
    _require(valid is None, valid)
    _require(any("validator_unavailable" in e for e in errors), errors)


def test_malformed_stdout_fails_closed():
    with mock.patch("schema_shim.subprocess.run", _fake_run_returning("not json")):
        valid, errors, ordered = SS.validate_via_schema(
            "context_fabric_common.v1.schema.json", "#/$defs/QuestionFamily", "trend"
        )
    _record("malformed_json_stdout", valid, errors, ordered)
    _require(valid is None, valid)


def test_stdout_missing_expected_keys_fails_closed():
    with mock.patch("schema_shim.subprocess.run", _fake_run_returning('{"unexpected": true}')):
        valid, errors, ordered = SS.validate_via_schema(
            "context_fabric_common.v1.schema.json", "#/$defs/QuestionFamily", "trend"
        )
    _record("missing_keys_stdout", valid, errors, ordered)
    _require(valid is None, valid)


def test_unexpected_exit_code_fails_closed():
    with mock.patch("schema_shim.subprocess.run", _fake_run_returning('{}', returncode=127)):
        valid, errors, ordered = SS.validate_via_schema(
            "context_fabric_common.v1.schema.json", "#/$defs/QuestionFamily", "trend"
        )
    _record("exit_127", valid, errors, ordered)
    _require(valid is None, valid)


def test_timeout_fails_closed():
    import subprocess as sp

    def _timeout(*args, **kwargs):
        raise sp.TimeoutExpired(cmd="node", timeout=30)

    with mock.patch("schema_shim.subprocess.run", _timeout):
        valid, errors, ordered = SS.validate_via_schema(
            "context_fabric_common.v1.schema.json", "#/$defs/QuestionFamily", "trend"
        )
    _record("timeout", valid, errors, ordered)
    _require(valid is None, valid)


def test_real_validation_still_works():
    # The mocked-failure controls above must not have broken the real,
    # working path.
    valid, errors, ordered = SS.validate_via_schema(
        "context_fabric_common.v1.schema.json", "#/$defs/QuestionFamily", "trend"
    )
    _require(valid is True and errors == [], (valid, errors))
    valid, errors, _ = SS.validate_via_schema(
        "context_fabric_common.v1.schema.json", "#/$defs/QuestionFamily", "bogus"
    )
    _require(valid is False and errors, (valid, errors))


def test_ordered_ascending_computed_by_the_shim():
    valid, errors, ordered = SS.validate_via_schema(
        "context_fabric_common.v1.schema.json", "#/$defs/EffectiveEvidenceWindow",
        {"provenance": "question_stated", "start": "2026-05-01T00:00:00Z", "end": "2026-08-01T00:00:00Z"},
    )
    _require(valid is True, (valid, errors))
    _require(ordered is True, ordered)
    valid, errors, ordered = SS.validate_via_schema(
        "context_fabric_common.v1.schema.json", "#/$defs/EffectiveEvidenceWindow",
        {"provenance": "question_stated", "start": "2026-08-01T00:00:00Z", "end": "2026-05-01T00:00:00Z"},
    )
    _require(valid is True, (valid, errors))  # the schema has no ordering keyword; ajv accepts it
    _require(ordered is False, ordered)


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for test in tests:
        test()
        print(f"PASS: {test.__name__}")
    print(f"PASS: {len(tests)} schema_shim controls, {len(_TABLE)} failure-mode cells executed")


if __name__ == "__main__":
    main()
