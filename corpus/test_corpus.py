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
guard, it is a guess (r1 finding on CHAOS-5591's PR #56, #1 and #3).

Run: python3 corpus/test_corpus.py
"""
import hashlib
import json
import sys
from pathlib import Path

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
    a row missing either breaks the evaluator downstream of this check,
    not inside it -- see r1 finding #1 on PR #56)."""
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
        assert not ok, f"RED CONTROL FAILED: {bad_row!r} was accepted"
        assert must_mention in (reason or ""), (
            f"RED CONTROL FAILED: {bad_row!r} rejected for the wrong reason: {reason!r}"
        )
    # GREEN control: the smallest legal row must pass.
    ok, reason = validate_corpus_row({"id": "x", "text": "hello"})
    assert ok, f"GREEN CONTROL FAILED: minimal legal row rejected: {reason!r}"


def _validate_baseline():
    """Shape + sha256 pin for corpus/baseline-20260905-sweep1.json."""
    raw = BASELINE_PATH.read_bytes()
    got_sha = hashlib.sha256(raw).hexdigest()
    assert got_sha == BASELINE_SHA256, (
        f"baseline sha256 mismatch: got {got_sha}, pinned {BASELINE_SHA256} "
        "-- update BASELINE_SHA256 here AND corpus/README.md's sha chain together, "
        "deliberately, if this edit is real"
    )

    doc = json.loads(raw)
    assert isinstance(doc, dict), "baseline must be a JSON object"
    for key in ("ticket", "provenance", "totals", "per_family", "rows"):
        assert key in doc, f"baseline missing required top-level key {key!r}"

    rows = doc["rows"]
    assert isinstance(rows, list) and rows, "baseline.rows must be a nonempty list"
    for i, row in enumerate(rows):
        assert isinstance(row, dict), f"baseline.rows[{i}] is not a mapping"
        assert isinstance(row.get("corpus_id"), str) and row["corpus_id"], (
            f"baseline.rows[{i}].corpus_id must be a non-empty string"
        )

    baseline_ids = {row["corpus_id"] for row in rows}
    corpus_ids = {row["id"] for row in corpus_module.CORPUS}
    only_in_baseline = baseline_ids - corpus_ids
    # Rows removed from the corpus since this baseline was measured are
    # expected (see provenance.rows_deleted_since_by_lane_corpus_cleanup)
    # and are not a validation failure -- the baseline is a historical
    # artifact, not required to track every future corpus edit.
    only_in_corpus = corpus_ids - baseline_ids
    assert not only_in_corpus, (
        f"corpus row(s) with no baseline entry at all: {sorted(only_in_corpus)}"
    )

    totals = doc["totals"]
    assert isinstance(totals, dict) and "total" in totals, "baseline.totals.total missing"
    assert totals["total"] == len(rows), (
        f"baseline.totals.total ({totals['total']}) != len(rows) ({len(rows)})"
    )

    return len(rows), len(only_in_baseline)


def main():
    _self_test_guard_fires()

    corpus = corpus_module.CORPUS
    assert isinstance(corpus, list) and corpus, "CORPUS must be a nonempty list"

    ids = [row.get("id") for row in corpus]
    assert len(ids) == len(set(ids)), "duplicate row id in CORPUS"

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
