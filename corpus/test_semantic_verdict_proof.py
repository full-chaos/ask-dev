#!/usr/bin/env python3
"""CHAOS-5620: replay the vendored REAL nine-rep proof data
(corpus/testdata/cv-discovered-team-series-nine-reps/) through
semantic_verdict.audit_window_exchange() and assert the exact columns this
ticket's design of record measured. This is the CI-executed half of the
"publish the semantic verdict against the pinned proofs of record" ask: it
needs no acr checkout, because audit_window_exchange has none -- it reads
only the recorded exchange, never a scalar verdict table.

The OTHER half (a byte-exact legacy-verdict comparison over the full
36-row baseline) genuinely requires acr's real scorer, which this
repository's CI does not have -- see semantic_verdict.py's module
docstring. That half stays a cited, uncommitted, manual replay (CHAOS-5620
TEST-EVIDENCE); reproducing acr's COHERENCE/VERDICTS table here would be
exactly the drift risk corpus/test_corpus.py already avoids for
validate_corpus_row.

Run: python3 corpus/test_semantic_verdict_proof.py
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import semantic_verdict as SV  # noqa: E402

FIXTURES = Path(__file__).parent / "testdata" / "cv-discovered-team-series-nine-reps"
_NAME_RE = re.compile(r"cv-discovered-team-series-rep(\d+)-t(\d+)-a(\d+)\.json$")


class SemanticVerdictProofError(Exception):
    """Raised by `_require` -- never a bare `assert` (see test_corpus.py)."""


def _require(cond, msg):
    if not cond:
        raise SemanticVerdictProofError(msg)


_require(__debug__, "refusing to run under python -O / PYTHONOPTIMIZE=1: "
         "assert-stripping optimizations would silently weaken this guard")


def no_op_legacy_score(row, bucket, status, **identity):
    """Documented no-op: always unscored. This proof exercises the audit
    and versioning machinery against real data; it makes no claim about
    real scalar scoring -- see this module's own docstring and
    semantic_verdict.py's."""
    return "unscored", "no_op_proof_scorer"


def _attempts_for_rep(rep):
    """Every recorded attempt for one rep, in the harness's own numeric
    attempt order (turn, then attempt-within-turn) -- a retry is ordered
    before the attempt that followed it, never re-sorted by filename text
    (rep5's t2-a1/t2-a2 would sort correctly either way here, but the
    numeric key is what the real ordering means, not a coincidence of
    zero-padding)."""
    matches = []
    for path in FIXTURES.glob(f"cv-discovered-team-series-rep{rep}-t*-a*.json"):
        m = _NAME_RE.match(path.name)
        _require(m and int(m.group(1)) == rep, f"unexpected fixture filename: {path.name}")
        matches.append((int(m.group(2)), int(m.group(3)), path))
    _require(matches, f"no fixture attempts found for rep {rep} under {FIXTURES}")
    matches.sort(key=lambda triple: triple[:2])
    return [json.loads(path.read_text()) for _turn, _attempt, path in matches]


def test_nine_reps_reproduce_the_design_of_records_published_figures():
    rows = []
    for rep in range(1, 10):
        attempts = _attempts_for_rep(rep)
        audit = SV.audit_window_exchange(attempts)
        final = attempts[-1]["response"]["result"]
        row = {"id": "cv-discovered-team-series", "text": "How has each team's health trended "
               "over the last two quarters?", "family": "discovered_cohort_ranking"}
        record = SV.build_verdict(row, "served_with_data", final["status"], final, audit,
                                   no_op_legacy_score, corpus_version="fixture-760014f7",
                                   legacy_scorer_version="no-op-v1")
        rows.append({"rep": rep, **audit, "unscored": record["unscored"]})
        print("PROOF_REP", json.dumps(rows[-1], sort_keys=True))

    totals = {
        "family_relation": dict(Counter(r["family_relation"] for r in rows)),
        "window_binding": dict(Counter(r["window_binding"] for r in rows)),
        "family_confirmation": dict(Counter(r["family_confirmation"] for r in rows)),
        "unscored": dict(Counter(r["unscored"] for r in rows)),
    }
    print("PROOF_TOTALS", json.dumps(totals, sort_keys=True))

    _require(totals["family_relation"] == {"changed": 3, "same": 6}, totals)
    _require(totals["window_binding"] == {"verified": 9}, totals)
    _require(totals["family_confirmation"] == {"unavailable": 9}, totals)
    _require(totals["unscored"] == {True: 9}, totals)


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for test in tests:
        test()
        print(f"PASS: {test.__name__}")
    print(f"PASS: {len(tests)} semantic_verdict proof controls over real vendored proof data")


if __name__ == "__main__":
    main()
