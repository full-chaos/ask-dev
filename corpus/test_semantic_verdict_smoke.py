#!/usr/bin/env python3
"""Smoke test: semantic_verdict.build_verdict() actually runs, without
exception and with the correct shape, over every REAL row in
corpus/corpus.py -- not only the synthetic fixtures in
test_semantic_verdict.py.

This is not a production wiring and not a claim about real scoring: the
`legacy_score` here is a documented no-op (always `unscored`), because this
repo has no acr checkout and therefore no real scalar scorer to call (see
semantic_verdict.py's module docstring). What this proves is narrower and
still real: the new machinery is exercised against every actual corpus row
shape that ships in this repository, not only against synthetic fixtures,
so a shape assumption that holds for a hand-built fixture but not for a
real row fails here instead of going unnoticed.

Run: python3 corpus/test_semantic_verdict_smoke.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import corpus  # noqa: E402
import semantic_verdict as SV  # noqa: E402


class SemanticVerdictSmokeError(Exception):
    """Raised by `_require` -- never a bare `assert` (see test_corpus.py)."""


def _require(cond, msg):
    if not cond:
        raise SemanticVerdictSmokeError(msg)


_require(__debug__, "refusing to run under python -O / PYTHONOPTIMIZE=1: "
         "assert-stripping optimizations would silently weaken this guard")


def no_op_legacy_score(row, bucket, status, **identity):
    """Documented no-op: always unscored. Not a claim about real scoring --
    see this module's docstring."""
    return "unscored", "no_op_smoke_scorer"


def test_build_verdict_runs_over_every_real_corpus_row():
    for row in corpus.CORPUS:
        record = SV.build_verdict(row, "served_with_data", "complete", {}, {}, no_op_legacy_score,
                                   corpus_version="smoke-test", legacy_scorer_version="no-op-v1")
        _require(record["corpus_id"] == row["id"], record)
        _require(record["verdict"] in {"agree", "agree_weak", "disagree", "unscored"}, record)
        _require(record["branch_results"] == [], f"{row['id']}: every real row is scalar today, "
                 f"an any_of declaration must not appear here silently: {record}")


def test_build_verdict_runs_over_a_synthetic_any_of_variant_of_every_real_row():
    # Real rows are all scalar today (no any_of applied -- see
    # docs/chaos-5620-semantic-verdict.md). Exercise the any_of/branch-
    # combination path against every real row's actual family label, not
    # only a hand-built fixture, by wrapping each row's declared family in
    # a synthetic any_of alternative.
    for row in corpus.CORPUS:
        family = row.get("family")
        if family is None:
            continue  # neg-illegal-i6-self-group: no family, stays scalar decline (chris D20 = A).
        variant = {**row, "expect": {"any_of": [{"outcome": "serve", "answer": {"family": family}}]}}
        record = SV.build_verdict(variant, "served_with_data", "complete", {}, {}, no_op_legacy_score,
                                   corpus_version="smoke-test", legacy_scorer_version="no-op-v1")
        _require(len(record["branch_results"]) == 1, f"{row['id']}: {record}")
        _require(record["branch_results"][0]["verdict"] == "unscored", f"{row['id']}: {record}")


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for test in tests:
        test()
        print(f"PASS: {test.__name__}")
    print(f"PASS: {len(tests)} semantic_verdict smoke controls over {len(corpus.CORPUS)} real corpus rows")


if __name__ == "__main__":
    main()
