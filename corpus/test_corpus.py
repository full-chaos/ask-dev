#!/usr/bin/env python3
"""Minimal validation for the corpus of record.

No acr checkout is available in ask-dev CI, so this cannot literally import
acr's `scripts/corpus/validators.py`. It mirrors that module's
`validate_corpus_row` rule shape instead (acr repo path
`scripts/corpus/validators.py:129-157`, the `expect` rule specifically at
line 136: "expect must be one of {sorted(EXPECT_VALUES)} or None") and
imports `corpus.py` for real, so a malformed row or a broken module both
fail this the same way they would fail acr's own ingestion boundary.

CHAOS-5596: also validates the pinned baseline JSON's shape and sha256, and
proves both new guards (required `text`, required `id`) actually fire with
RED CONTROLs -- a row-shape check that never runs a failing case is not a
guard, it is a guess (r1 finding on the prior corpus-versioning PR, #1 and
#3). Every guard in this module uses `_require`, never a bare `assert` --
r1 on THIS PR (P1) proved `python3 -O` / `PYTHONOPTIMIZE=1` strips every
`assert` statement at compile time, silently disabling the whole baseline
guard under a valid Python runtime configuration. `_require` raises
unconditionally, so no interpreter flag can remove it, and `main()` also
refuses outright to run at all under a stripped-asserts interpreter
(`__debug__` is False under `-O`), as defense in depth on top of that.
`_validate_baseline`'s shape check is also deepened (r1 P3): it previously
accepted a baseline with `None` for `ticket`/`provenance`/`per_family` and
rows carrying only `corpus_id`, so long as the (fake) sha matched -- it now
type-checks every top-level field and requires each row to carry the real
baseline schema's `family`/`bucket` fields too, not just `corpus_id`.

Run: python3 corpus/test_corpus.py
"""
import hashlib
import json
import sys
from pathlib import Path


class CorpusValidationError(Exception):
    """Raised by `_require` -- never a bare `assert`, which `python3 -O` /
    `PYTHONOPTIMIZE=1` strips at compile time (r1 P1 on this PR)."""


def _require(cond, msg):
    if not cond:
        raise CorpusValidationError(msg)


# Refuse to run at all under an interpreter that has stripped `assert`
# statements. This module has none left (everything routes through
# `_require`), but this is a loud, first-line guard against a future
# contributor reintroducing a bare `assert` without noticing the rule
# above -- `__debug__` is False exactly when `-O`/`PYTHONOPTIMIZE` is set,
# with no other cause.
_require(__debug__, "refusing to run under python -O / PYTHONOPTIMIZE=1: "
         "assert-stripping optimizations would silently weaken this guard")

sys.path.insert(0, str(Path(__file__).parent))
import corpus as corpus_module  # noqa: E402

# Mirrors acr scripts/corpus/validators.py:15 (EXPECT_VALUES) and
# :129-157 (validate_corpus_row). Keep in sync by hand: acr's corpus
# harness (scripts/corpus/*.py) is supplied externally on sys.path at run
# time, never committed here, so there is no shared import to pin against.
EXPECT_VALUES = {"serve", "refuse", "decline", "clarify"}

# Pinned sha256 of corpus/baseline-20260905-sweep1.json. A silent edit to
# the baseline (hand or otherwise) fails CI here until this constant AND
# corpus/README.md's sha chain are both updated deliberately -- see
# corpus/README.md "## Versioning".
BASELINE_SHA256 = "ab7f8bb0ffda440240a8f60e3b1f07e8c86ed42b9ab740bedfdcdc3f5964b1dd"
BASELINE_PATH = Path(__file__).parent / "baseline-20260905-sweep1.json"


def validate_corpus_row(row):
    """(ok, reason) -- same shape and rules as acr's validators.py:129,
    plus `id`/`text` presence (acr's corpus harness reads both directly;
    a row missing either broke the evaluator downstream of the old
    validator, not inside it -- r1 finding #1 on the prior PR)."""
    if not isinstance(row, dict):
        return False, "row is not a mapping"

    row_id = row.get("id")
    if not isinstance(row_id, str) or not row_id:
        return False, f"id must be a non-empty string, got {row_id!r}"

    text = row.get("text")
    if not isinstance(text, str) or not text:
        return False, f"text must be a non-empty string, got {text!r}"

    expect = row.get("expect")
    if expect is not None and (not isinstance(expect, str) or expect not in EXPECT_VALUES):
        return False, f"expect must be one of {sorted(EXPECT_VALUES)} or None, got {expect!r}"

    basis = row.get("basis")
    if basis is not None and not isinstance(basis, str):
        return False, f"basis must be a string or None, got {type(basis).__name__}"

    anchor = row.get("anchor")
    if anchor is not None:
        if not isinstance(anchor, dict):
            return False, f"anchor must be a mapping or None, got {type(anchor).__name__}"
        for key in ("kind", "label"):
            if not isinstance(anchor.get(key), str) or not anchor.get(key):
                return False, f"anchor.{key} must be a non-empty string"

    nonexistent = row.get("nonexistent", False)
    if not isinstance(nonexistent, bool):
        return False, f"nonexistent must be a bool, got {type(nonexistent).__name__}"

    return True, None


def _self_test_guard_fires():
    """RED CONTROLs: prove validate_corpus_row actually rejects the shapes
    it claims to reject, before trusting it to validate the real corpus.
    A guard that is never exercised against a failing case is unproven."""
    cases = [
        ({"id": "x", "expect": "serve"}, "text"),
        ({"text": "hello"}, "id"),
        ({"id": "x", "text": "", "expect": "serve"}, "text"),
        ({"id": "", "text": "hello"}, "id"),
        ({"id": "x", "text": "hello", "expect": "not-a-real-value"}, "expect"),
        ({"id": "x", "text": "hello", "basis": 5}, "basis"),
        ({"id": "x", "text": "hello", "anchor": {"kind": "team"}}, "anchor"),
        ({"id": "x", "text": "hello", "nonexistent": "yes"}, "nonexistent"),
    ]
    for bad_row, must_mention in cases:
        ok, reason = validate_corpus_row(bad_row)
        _require(not ok, f"RED CONTROL FAILED: {bad_row!r} was accepted")
        _require(must_mention in (reason or ""),
                  f"RED CONTROL FAILED: {bad_row!r} rejected for the wrong reason: {reason!r}")
    # GREEN control: the smallest legal row must pass.
    ok, reason = validate_corpus_row({"id": "x", "text": "hello"})
    _require(ok, f"GREEN CONTROL FAILED: minimal legal row rejected: {reason!r}")


def _require_type(doc, key, want_type, type_name):
    val = doc.get(key)
    _require(isinstance(val, want_type),
              f"baseline.{key} must be a {type_name}, got {type(val).__name__}")
    return val


def _validate_baseline():
    """Shape + sha256 pin for corpus/baseline-20260905-sweep1.json.

    Type-checks every required top-level field (not just presence -- a
    baseline with `ticket=None`/`provenance=None`/`per_family=None`
    previously passed, r1 finding P3) and requires each row to carry the
    real schema's `corpus_id`/`family`/`bucket` fields, not just
    `corpus_id` alone.
    """
    raw = BASELINE_PATH.read_bytes()
    got_sha = hashlib.sha256(raw).hexdigest()
    _require(got_sha == BASELINE_SHA256,
              f"baseline sha256 mismatch: got {got_sha}, pinned {BASELINE_SHA256} "
              "-- update BASELINE_SHA256 here AND corpus/README.md's sha chain together, "
              "deliberately, if this edit is real")

    doc = json.loads(raw)
    _require(isinstance(doc, dict), "baseline must be a JSON object")

    ticket = _require_type(doc, "ticket", str, "string")
    _require(ticket, "baseline.ticket must be a non-empty string")
    _require_type(doc, "provenance", dict, "mapping")
    totals = _require_type(doc, "totals", dict, "mapping")
    _require_type(doc, "per_family", dict, "mapping")
    rows = _require_type(doc, "rows", list, "list")
    _require(rows, "baseline.rows must be a nonempty list")

    for i, row in enumerate(rows):
        _require(isinstance(row, dict), f"baseline.rows[{i}] is not a mapping")
        # corpus_id/bucket are always populated (a scored row always lands in
        # one outcome bucket). family mirrors corpus.py's own `family` field,
        # which is legitimately None for the deliberate I6-illegal probe row
        # (neg-illegal-i6-self-group) -- str-or-None here, not required.
        for key in ("corpus_id", "bucket"):
            val = row.get(key)
            _require(isinstance(val, str) and val,
                      f"baseline.rows[{i}].{key} must be a non-empty string, got {val!r}")
        family = row.get("family")
        _require(family is None or (isinstance(family, str) and family),
                  f"baseline.rows[{i}].family must be a non-empty string or None, got {family!r}")

    baseline_ids = {row["corpus_id"] for row in rows}
    corpus_ids = {row["id"] for row in corpus_module.CORPUS}
    only_in_baseline = baseline_ids - corpus_ids
    # Rows removed from the corpus since this baseline was measured are
    # expected (see provenance.rows_deleted_since_by_lane_corpus_cleanup)
    # and are not a validation failure -- the baseline is a historical
    # artifact, not required to track every future corpus edit.
    only_in_corpus = corpus_ids - baseline_ids
    _require(not only_in_corpus,
              f"corpus row(s) with no baseline entry at all: {sorted(only_in_corpus)}")

    _require("total" in totals, "baseline.totals.total missing")
    _require(isinstance(totals["total"], int) and not isinstance(totals["total"], bool),
              f"baseline.totals.total must be an int, got {type(totals['total']).__name__}")
    _require(totals["total"] == len(rows),
              f"baseline.totals.total ({totals['total']}) != len(rows) ({len(rows)})")

    return len(rows), len(only_in_baseline)


def main():
    _self_test_guard_fires()

    corpus = corpus_module.CORPUS
    _require(isinstance(corpus, list) and corpus, "CORPUS must be a nonempty list")

    ids = [row.get("id") for row in corpus]
    _require(len(ids) == len(set(ids)), "duplicate row id in CORPUS")

    failures = []
    for row in corpus:
        ok, reason = validate_corpus_row(row)
        if not ok:
            failures.append(f"{row.get('id', '<no id>')}: {reason}")

    if failures:
        print(f"FAIL: {len(failures)} row(s) failed validation:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        sys.exit(1)

    baseline_rows, dropped = _validate_baseline()

    print(f"PASS: {len(corpus)} corpus rows validated")
    print(f"PASS: baseline sha256 pin matched, {baseline_rows} baseline rows shape-checked "
          f"({dropped} historical-only, not in the current corpus)")


if __name__ == "__main__":
    main()
