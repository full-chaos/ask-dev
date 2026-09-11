#!/usr/bin/env python3
"""Minimal validation for the corpus of record.

No acr checkout is available in ask-dev CI, so this cannot literally import
acr's `scripts/corpus/validators.py`. It mirrors that module's
`validate_corpus_row` rule shape instead (acr repo path
`scripts/corpus/validators.py:129-157`, the `expect` rule specifically at
line 136: "expect must be one of {sorted(EXPECT_VALUES)} or None") and
imports `corpus.py` for real, so a malformed row or a broken module both
fail this the same way they would fail acr's own ingestion boundary.

Run: python3 corpus/test_corpus.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import corpus as corpus_module  # noqa: E402

# Mirrors acr scripts/corpus/validators.py:15 (EXPECT_VALUES) and
# :129-157 (validate_corpus_row). Keep in sync by hand: acr's corpus
# harness (scripts/corpus/*.py) is supplied externally on sys.path at run
# time, never committed here, so there is no shared import to pin against.
EXPECT_VALUES = {"serve", "refuse", "decline", "clarify"}


def validate_corpus_row(row):
    """(ok, reason) -- same shape and rules as acr's validators.py:129."""
    if not isinstance(row, dict):
        return False, "row is not a mapping"

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


def main():
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

    print(f"PASS: {len(corpus)} corpus rows validated")


if __name__ == "__main__":
    main()
