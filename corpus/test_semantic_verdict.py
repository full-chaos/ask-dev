#!/usr/bin/env python3
"""Controls for semantic_verdict.py.

These tests are HERMETIC: every exchange fixture below is synthetic, built in
this file, never read from another lane's recorded proof data (this repo has
no dependency on out-of-tree paths). The one-time REPLAY against the real
pinned proofs of record (CHAOS-5620) is a separate, uncommitted proof
script, cited by its executed output where this change is described,
because it requires an acr checkout this repo's CI does not have.

FakeLegacyScorer is a TEST DOUBLE, not a claim about acr's real scalar
verdict table (COHERENCE/VERDICTS in acr scripts/corpus/expectations.py).
It implements just enough of the (row, bucket, status) -> (verdict, reason)
contract to exercise semantic_verdict.py's OWN new logic: branch combination,
the family/window audit, and versioning. Production wires the real acr
scorer in behind the same `legacy_score` parameter -- see semantic_verdict.py
build_verdict()'s docstring.

Run: python3 corpus/test_semantic_verdict.py
"""
import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import expect_schema as ES  # noqa: E402
import semantic_verdict as SV  # noqa: E402


class SemanticVerdictTestError(Exception):
    """Raised by `_require` -- never a bare `assert` (see test_corpus.py)."""


def _require(cond, msg):
    if not cond:
        raise SemanticVerdictTestError(msg)


_require(__debug__, "refusing to run under python -O / PYTHONOPTIMIZE=1: "
         "assert-stripping optimizations would silently weaken this guard")


def fake_legacy_score(row, bucket, status, **identity):
    """A minimal, deliberately simplified stand-in scalar scorer: agree iff
    `expect` is 'serve' and the bucket claims data; agree iff 'decline'/'refuse'
    and the bucket is unserved; disagree on error/unserved-vs-serve mismatch;
    unscored for a future/unknown terminal. Never consulted for its own
    correctness -- only used to drive semantic_verdict.py's branch/audit logic."""
    expect = row.get("expect")
    if status == "future_terminal":
        return "unscored", "unauthored_terminal"
    if status == "http_502:acr_investigation_failed":
        return "disagree", "error_terminal"
    if expect == ES.SERVE:
        return ("agree", "served") if bucket == "served_with_data" else ("disagree", "not served")
    if expect in (ES.REFUSE, ES.DECLINE):
        return ("agree", "not served") if bucket == "unserved" else ("disagree", "served instead")
    if expect is None:
        return "unscored", "no_expectation"
    return "disagree", "unhandled_fixture_case"


def declaration(*branches):
    return {"id": "synthetic", "text": "Synthetic", "expect": {"any_of": list(branches)}}


def serve(family="discovered_cohort_ranking"):
    return {"outcome": "serve", "answer": {"family": family}}


# --- synthetic two-turn window-clarification exchange -----------------------------------

def _offer(option_id="opt-90d", receipt_id="winr_90d", relative_id="trailing_90d",
           start="2026-05-01T00:00:00Z", end="2026-08-01T00:00:00Z"):
    return {"option_id": option_id, "receipt_id": receipt_id, "relative_id": relative_id,
            "start": start, "end": end}


def base_exchange(final_family="discovered_cohort_ranking", first_family="discovered_cohort_ranking"):
    offer = _offer()
    first = {
        "status": "clarification_required",
        "result_id": "result-t1",
        "answer_plan": {"family": first_family},
        "structure_needs": {"window_options": [offer]},
        "window_clarification": {"options": [offer]},
    }
    final = {
        "status": "complete",
        "answer_plan": {"family": final_family},
        "confirmed_structure": [
            {
                "member": "window",
                "prior_result_id": "result-t1",
                "receipt_id": "winr_90d",
                "source": "receipt",
                "provenance": "clarification_confirmed",
                "disposition": "applied",
                "applied_value": "trailing_90d",
            }
        ],
        "effective_evidence_window": {
            "provenance": "clarification_confirmed",
            "relative_id": "trailing_90d",
            "start": "2026-05-01T00:00:00Z",
            "end": "2026-08-01T00:00:00Z",
        },
    }
    t1 = {"status": 200, "request": {"question": "Q"}, "response": {"result": first}}
    t2 = {
        "status": 200,
        "request": {"question": "Q", "priorWindowReceipts": [{"result_id": "result-t1", "receipt_id": "winr_90d"}]},
        "response": {"result": final},
    }
    return [t1, t2]


def test_family_match_is_not_confirmation():
    attempts = base_exchange()
    final = attempts[-1]["response"]["result"]
    audit = SV.audit_window_exchange(attempts)
    _require(audit["window_binding"] == "verified", audit)
    _require(audit["family_relation"] == "same", audit)
    row = declaration(serve())
    verdict, reason, _ = SV.score(row, "served_with_data", "complete", final, audit, fake_legacy_score)
    _require((verdict, reason) == ("unscored", "family_confirmation_unavailable"),
             f"a verified window receipt + matching family must NOT manufacture confirmation, got {(verdict, reason)}")


def test_family_mismatch_is_a_failure():
    attempts = base_exchange()
    final = attempts[-1]["response"]["result"]
    audit = SV.audit_window_exchange(attempts)
    row = declaration(serve("grouped_cohort_status"))
    verdict, reason, _ = SV.score(row, "served_with_data", "complete", final, audit, fake_legacy_score)
    _require((verdict, reason) == ("disagree", "declared_family_mismatch"), (verdict, reason))


def test_window_only_drift_is_unratified_not_proven_wrong():
    attempts = base_exchange(final_family="grouped_cohort_status", first_family="discovered_cohort_ranking")
    final = attempts[-1]["response"]["result"]
    audit = SV.audit_window_exchange(attempts)
    _require(audit["family_relation"] == "changed", audit)
    row = declaration(serve("grouped_cohort_status"))
    verdict, reason, _ = SV.score(row, "served_with_data", "complete", final, audit, fake_legacy_score)
    _require((verdict, reason) == ("unscored", "unratified_family_change"),
             f"a changed family must stay unscored, never a proven failure or a pass, got {(verdict, reason)}")


def test_retry_is_not_a_third_turn():
    attempts = base_exchange()
    # A retryable failure whose request matches the immediately following
    # (successful) attempt's request is a RETRY of the same turn, not a new
    # semantic turn -- it must be discarded, collapsing this 3-attempt
    # sequence back down to the same 2 semantic turns as base_exchange().
    retryable_failure = {
        "status": 502,
        "request": attempts[1]["request"],
        "response": {"failure": {"retryable": True}},
    }
    with_retry = [attempts[0], retryable_failure, attempts[1]]
    audit = SV.audit_window_exchange(with_retry)
    _require(audit["window_binding"] == "verified", f"a retry must collapse to two semantic turns: {audit}")


_MUTATIONS = [
    ("receipt", "mismatch"),
    ("parent", "mismatch"),
    ("duplicate_offer", "mismatch"),
    ("duplicate_ack", "mismatch"),
    ("vetoed", "mismatch"),
    ("nanosecond", "mismatch"),
    ("missing_ack", "unknown"),
    ("missing_effective", "unknown"),
    ("missing_plan", "verified"),
    ("bad_timestamp", "unknown"),
    ("changed_question", "unknown"),
]


def test_receipt_controls():
    for mutation, expected in _MUTATIONS:
        attempts = copy.deepcopy(base_exchange())
        first, final = attempts[0]["response"]["result"], attempts[1]["response"]["result"]
        if mutation == "receipt":
            attempts[1]["request"]["priorWindowReceipts"][0]["receipt_id"] = "winr_unoffered"
        if mutation == "parent":
            attempts[1]["request"]["priorWindowReceipts"][0]["result_id"] = "result_wrong"
        if mutation == "duplicate_offer":
            first["window_clarification"]["options"] *= 2
        if mutation == "duplicate_ack":
            final["confirmed_structure"] *= 2
        if mutation == "vetoed":
            final["confirmed_structure"][0]["disposition"] = "vetoed_conflict"
        if mutation == "nanosecond":
            end = final["effective_evidence_window"]["end"]
            final["effective_evidence_window"]["end"] = end[:-2] + str((int(end[-2]) + 1) % 10) + "Z"
        if mutation == "missing_ack":
            final.pop("confirmed_structure")
        if mutation == "missing_effective":
            final.pop("effective_evidence_window")
        if mutation == "missing_plan":
            final.pop("answer_plan")
        if mutation == "bad_timestamp":
            final["effective_evidence_window"]["start"] = "yesterday"
        if mutation == "changed_question":
            attempts[1]["request"]["question"] = "Different question"
        audit = SV.audit_window_exchange(attempts)
        _require(audit["window_binding"] == expected, f"{mutation}: {audit}")
        row = declaration(serve())
        verdict, _, _ = SV.score(row, "served_with_data", final.get("status", "complete"), final, audit,
                                  fake_legacy_score)
        _require(verdict not in {"agree", "agree_weak"}, f"{mutation} must never pass: {verdict}")


def test_invalid_alternative_cannot_hide_behind_valid_branch():
    for expect in [[], {"any_of": []}, {"any_of": ["serve"]}, {"any_of": [{"outcome": ["serve"]}]},
                   {"any_of": [serve(), {"outcome": "bogus"}]}, {"any_of": [serve(), serve()]},
                   {"any_of": [serve("bogus_family")]}, {"any_of": [{"outcome": "serve"}]},
                   {"any_of": [{"outcome": "decline", "answer": {}}]},
                   {"any_of": [serve()], "unknown": True}]:
        row = {"id": "synthetic", "text": "Synthetic", "expect": expect}
        verdict, reason, results = SV.score(row, "served_with_data", "complete", {}, {}, fake_legacy_score)
        _require(verdict == "unscored", f"{expect!r}: {verdict}")
        _require(reason.startswith("invalid_expectation:"), f"{expect!r}: {reason}")
        _require(results == [], f"{expect!r}: an invalid declaration must yield no branch results")


def test_error_and_unknown_terminal_cannot_pass():
    row = declaration({"outcome": "decline"}, {"outcome": "refuse"})
    verdict, _, _ = SV.score(row, "error", "http_502:acr_investigation_failed", {}, {}, fake_legacy_score)
    _require(verdict == "disagree", verdict)
    verdict, _, _ = SV.score(row, "unserved", "future_terminal", {}, {}, fake_legacy_score)
    _require(verdict == "unscored", verdict)


def test_scalar_row_is_untouched_by_the_new_machinery():
    for expect in ["serve", "refuse", "decline", None]:
        row = {"id": "synthetic", "text": "Synthetic", "expect": expect}
        bucket = "served_with_data" if expect == "serve" else "unserved"
        want = fake_legacy_score(row, bucket, "complete")
        verdict, reason, branch_results = SV.score(row, bucket, "complete", {}, {}, fake_legacy_score)
        _require((verdict, reason) == want, f"scalar {expect!r} must reach legacy_score unchanged")
        _require(branch_results == [], "a scalar declaration must yield no branch results")


def test_build_verdict_carries_versions_and_unscored_flag():
    row = declaration(serve())
    attempts = base_exchange()
    final = attempts[-1]["response"]["result"]
    audit = SV.audit_window_exchange(attempts)
    record = SV.build_verdict(row, "served_with_data", "complete", final, audit, fake_legacy_score,
                              corpus_version="test-corpus-v0", legacy_scorer_version="fake-legacy-v1")
    _require(record["scorer_version"] == SV.SCORER_VERSION, record)
    _require(record["policy_version"] == SV.POLICY_VERSION, record)
    _require(record["schema_version"] == ES.SCHEMA_VERSION, record)
    _require(record["corpus_version"] == "test-corpus-v0", record)
    _require(record["legacy_scorer_version"] == "fake-legacy-v1", record)
    _require(record["unscored"] is True, record)
    _require(len(record["branch_results"]) == 1, record)


def test_two_legacy_scorers_are_distinguished_by_version():
    # Two different injected scalar scorers, wired in behind the SAME
    # legacy_score parameter, can legitimately disagree (a scorer upgrade,
    # a different acr pin, a test double). The record must never look
    # identically versioned for both -- only `legacy_scorer_version` may
    # differ; every OTHER version field is this module's own and must not
    # move just because the caller swapped its injected scorer.
    row = {"id": "synthetic", "text": "Synthetic", "expect": "serve"}

    def scorer_a(r, b, s, **kw):
        return "agree", "scorer-a-says-yes"

    def scorer_b(r, b, s, **kw):
        return "disagree", "scorer-b-says-no"

    ra = SV.build_verdict(row, "served_with_data", "complete", {}, {}, scorer_a,
                           corpus_version="c1", legacy_scorer_version="scorer-a-v1")
    rb = SV.build_verdict(row, "served_with_data", "complete", {}, {}, scorer_b,
                           corpus_version="c1", legacy_scorer_version="scorer-b-v1")
    _require(ra["verdict"] != rb["verdict"], (ra, rb))
    _require(ra["legacy_scorer_version"] != rb["legacy_scorer_version"], (ra, rb))
    for field in ("scorer_version", "policy_version", "schema_version", "corpus_version"):
        _require(ra[field] == rb[field], f"{field} must not depend on the injected scorer: {ra} vs {rb}")


def test_window_value_accepts_explicit_bounds_without_relative_id():
    # The pinned contract (RelativeWindowID in
    # src/contracts/schemas/context_fabric_common.v1.schema.json) permits a
    # window carrying explicit start+end and NO relative_id at all -- that
    # is a distinct legal shape, not a malformed one.
    explicit = {"start": "2026-05-01T00:00:00Z", "end": "2026-08-01T00:00:00Z"}
    value = SV.window_value(explicit)
    _require(value == ("explicit", SV.timestamp(explicit["start"]), SV.timestamp(explicit["end"])), value)
    # It is still distinguishable from a same-bounds relative window.
    relative = {**explicit, "relative_id": "trailing_90d"}
    _require(SV.window_value(relative) != value, "explicit and relative windows over the same bounds must differ")
    # Still rejects an unordered explicit window.
    try:
        SV.window_value({"start": explicit["end"], "end": explicit["start"]})
        _require(False, "unordered explicit window must raise")
    except ValueError:
        pass


def test_malformed_retry_evidence_fails_closed_not_crash():
    # A non-2xx attempt whose `response` is not a mapping (a raw transport
    # error string, say) must never reach `.get()` on a non-dict and crash
    # the whole audit -- it must fail closed to `unsupported_exchange`,
    # the same as any other shape this audit does not recognize.
    attempts = [
        {"status": 502, "request": {"q": 1}, "response": "plain string body, not a dict"},
        {"status": 200, "request": {"q": 1},
         "response": {"result": {"status": "clarification_required", "result_id": "r1"}}},
    ]
    audit = SV.audit_window_exchange(attempts)
    _require(audit["window_binding"] == "unknown", audit)
    # A `failure` that is present but not itself a mapping must not crash either.
    attempts2 = [
        {"status": 502, "request": {"q": 1}, "response": {"failure": "not-a-mapping"}},
        {"status": 200, "request": {"q": 1},
         "response": {"result": {"status": "clarification_required", "result_id": "r1"}}},
    ]
    audit2 = SV.audit_window_exchange(attempts2)
    _require(audit2["window_binding"] == "unknown", audit2)


def test_missing_final_result_fails_closed_not_crash():
    # A row with no successful result at all (error/no_match/exhausted
    # turns) legitimately has `final=None` -- scoring a serve branch
    # against it must return `family_unavailable`, never raise.
    row = declaration(serve())
    verdict, reason, _ = SV.score(row, "served_with_data", "complete", None, {}, fake_legacy_score)
    _require((verdict, reason) == ("unscored", "family_unavailable"), (verdict, reason))


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for test in tests:
        test()
        print(f"PASS: {test.__name__}")
    print(f"PASS: {len(tests)} semantic_verdict controls")


if __name__ == "__main__":
    main()
