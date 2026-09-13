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
import inspect
import re
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
           start="2026-05-01T00:00:00Z", end="2026-08-01T00:00:00Z", label="the last 90 days"):
    return {"option_id": option_id, "receipt_id": receipt_id, "relative_id": relative_id,
            "start": start, "end": end, "label": label}


def base_exchange(final_family="discovered_cohort_ranking", first_family="discovered_cohort_ranking"):
    offer = _offer()
    first = {
        "status": "clarification_required",
        "result_id": "result-t1",
        "answer_plan": {"family": first_family},
        "structure_needs": {"missing": ["window"], "window_options": [offer]},
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


def test_family_match_is_not_confirmation_without_a_persisted_link():
    # CHAOS-5722: matching family + a verified window receipt still does
    # NOT manufacture confirmation on their own -- only a caller-supplied
    # `persisted_semantic_state` adapter can promote past `unscored`. No
    # adapter is passed here (every call site that predates this ticket),
    # so this must read exactly as if the adapter found no persisted row.
    attempts = base_exchange()
    final = attempts[-1]["response"]["result"]
    audit = SV.audit_window_exchange(attempts)
    _require(audit["window_binding"] == "verified", audit)
    _require(audit["family_relation"] == "same", audit)
    row = declaration(serve())
    verdict, reason, _ = SV.score(row, "served_with_data", "complete", final, audit, fake_legacy_score)
    _require((verdict, reason) == ("unscored", ES.SEMANTIC_STATE_ABSENT),
             f"a verified window receipt + matching family must NOT manufacture confirmation "
             f"without a persisted link, got {(verdict, reason)}")


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


# --- CHAOS-5722: persisted semantic-state family-confirmation link ----------

def _verified_exchange_with_result_id(result_id="result-final"):
    """A clean base_exchange() (verified window binding, same family) whose
    `final` carries a `result_id` -- base_exchange()'s own `final` has none
    (only the first turn's clarification does), so every test below that
    needs the persisted-state adapter to actually run adds one."""
    attempts = base_exchange()
    final = {**attempts[-1]["response"]["result"], "result_id": result_id}
    attempts[-1] = {**attempts[-1], "response": {"result": final}}
    audit = SV.audit_window_exchange(attempts)
    _require(audit["window_binding"] == "verified", audit)
    _require(audit["family_relation"] == "same", audit)
    return final, audit


def _persisted_state(family="discovered_cohort_ranking", gate_outcome="passed",
                      format_version="semantic-state.v1"):
    return {"format_version": format_version, "family": family,
            "validation": {"gate_outcome": gate_outcome}}


class _CountingAdapter:
    """A `persisted_semantic_state` test double that records every
    `result_id` it was called with, so a test can assert it was NEVER
    called for a scalar row or a refuse/decline/clarify branch (score_branch
    must short-circuit before reaching it in both cases)."""

    def __init__(self, response):
        self.response = response
        self.calls = []

    def __call__(self, result_id):
        self.calls.append(result_id)
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def test_persisted_link_promotes_serve_to_agree_and_outranks_a_wrongly_certified_refuse():
    # The exact defect this ticket fixes: a refuse branch on the same
    # any_of row can score agree_weak (acr's real table matches it on a
    # disclosed basis, independent of the actual served bucket) while a
    # correct, persisted-confirmed serve is capped below it by _RANK. A
    # complete persisted link must let the serve branch win.
    def legacy_score_refuse_agrees_on_a_served_bucket(row, bucket, status, **identity):
        if row.get("expect") == ES.SERVE:
            return ("agree", "served") if bucket == "served_with_data" else ("disagree", "not served")
        return "agree_weak", "matched_basis_on_served_bucket"

    final, audit = _verified_exchange_with_result_id()
    row = declaration(serve(), {"outcome": "refuse"})
    adapter = _CountingAdapter(_persisted_state())
    verdict, reason, results = SV.score(row, "served_with_data", "complete", final, audit,
                                         legacy_score_refuse_agrees_on_a_served_bucket, adapter)
    _require(verdict == "agree", (verdict, reason, results))
    _require(reason == "family_confirmed", (verdict, reason))
    _require(results[0][0] == "agree", f"serve branch must reach agree: {results}")
    _require(results[1][0] == "agree_weak", f"refuse branch must be untouched by this ticket: {results}")
    _require(SV._RANK[results[0][0]] > SV._RANK[results[1][0]],
             f"the persisted-confirmed serve must outrank the wrongly-certified refuse: {results}")
    _require(adapter.calls == [final["result_id"]], adapter.calls)


def test_persisted_state_absent_stays_unscored():
    final, audit = _verified_exchange_with_result_id()
    row = declaration(serve())
    adapter = _CountingAdapter(None)  # adapter ran, found no row
    verdict, reason, _ = SV.score(row, "served_with_data", "complete", final, audit, fake_legacy_score, adapter)
    _require((verdict, reason) == ("unscored", ES.SEMANTIC_STATE_ABSENT), (verdict, reason))
    _require(adapter.calls == [final["result_id"]], adapter.calls)


def test_persisted_state_unreadable_stays_unscored():
    final, audit = _verified_exchange_with_result_id()
    row = declaration(serve())
    adapter = _CountingAdapter(SV.PersistedSemanticStateUnreadable("corrupt row"))
    verdict, reason, _ = SV.score(row, "served_with_data", "complete", final, audit, fake_legacy_score, adapter)
    _require((verdict, reason) == ("unscored", ES.SEMANTIC_STATE_UNREADABLE), (verdict, reason))


def test_persisted_state_non_dict_return_is_unreadable():
    final, audit = _verified_exchange_with_result_id()
    row = declaration(serve())
    for bad in ["not-a-dict", 12345, ["a", "list"]]:
        adapter = _CountingAdapter(bad)
        verdict, reason, _ = SV.score(row, "served_with_data", "complete", final, audit, fake_legacy_score, adapter)
        _require((verdict, reason) == ("unscored", ES.SEMANTIC_STATE_UNREADABLE), (bad, verdict, reason))


def test_persisted_state_malformed_shape_is_unreadable():
    # Domain table over the two shape-bearing fields (`family`,
    # `validation.gate_outcome`) this scorer reads once format_version is
    # known: {absent, null, wrong scalar/container type} each -- every cell
    # must fail closed to `SEMANTIC_STATE_UNREADABLE`, never a crash and
    # never a manufactured mismatch/agree against a value that was never
    # really there.
    final, audit = _verified_exchange_with_result_id()
    row = declaration(serve())
    cells = [
        ("family_absent", {"format_version": "semantic-state.v1", "validation": {"gate_outcome": "passed"}}),
        ("family_null", {"format_version": "semantic-state.v1", "family": None,
                          "validation": {"gate_outcome": "passed"}}),
        ("family_wrong_type", {"format_version": "semantic-state.v1", "family": 42,
                                "validation": {"gate_outcome": "passed"}}),
        ("validation_absent", {"format_version": "semantic-state.v1", "family": "discovered_cohort_ranking"}),
        ("validation_null", {"format_version": "semantic-state.v1", "family": "discovered_cohort_ranking",
                              "validation": None}),
        ("validation_wrong_type_string", {"format_version": "semantic-state.v1",
                                           "family": "discovered_cohort_ranking", "validation": "not-a-dict"}),
        ("validation_wrong_container_type_list", {"format_version": "semantic-state.v1",
                                                   "family": "discovered_cohort_ranking", "validation": []}),
        ("gate_outcome_absent", {"format_version": "semantic-state.v1", "family": "discovered_cohort_ranking",
                                  "validation": {}}),
        ("gate_outcome_null", {"format_version": "semantic-state.v1", "family": "discovered_cohort_ranking",
                                "validation": {"gate_outcome": None}}),
        ("gate_outcome_wrong_type", {"format_version": "semantic-state.v1", "family": "discovered_cohort_ranking",
                                      "validation": {"gate_outcome": 200}}),
    ]
    for label, bad in cells:
        adapter = _CountingAdapter(bad)
        verdict, reason, _ = SV.score(row, "served_with_data", "complete", final, audit, fake_legacy_score, adapter)
        _require((verdict, reason) == ("unscored", ES.SEMANTIC_STATE_UNREADABLE), (label, verdict, reason))


def test_persisted_family_mismatch_is_disagree():
    final, audit = _verified_exchange_with_result_id()
    row = declaration(serve())
    adapter = _CountingAdapter(_persisted_state(family="grouped_cohort_status"))
    verdict, reason, _ = SV.score(row, "served_with_data", "complete", final, audit, fake_legacy_score, adapter)
    _require((verdict, reason) == ("disagree", "persisted_family_mismatch"), (verdict, reason))


def test_persisted_gate_outcome_not_accepted_is_not_agree():
    final, audit = _verified_exchange_with_result_id()
    row = declaration(serve())
    for gate_outcome in ["refused_basis", "rejected_invalid", "not_proposed", ""]:
        adapter = _CountingAdapter(_persisted_state(gate_outcome=gate_outcome))
        verdict, reason, _ = SV.score(row, "served_with_data", "complete", final, audit, fake_legacy_score, adapter)
        _require(verdict != "agree", f"gate_outcome={gate_outcome!r} must never reach agree: {(verdict, reason)}")
        _require((verdict, reason) == ("unscored", "gate_outcome_not_accepted"),
                 f"gate_outcome={gate_outcome!r}: {(verdict, reason)}")


def test_persisted_state_unknown_format_version_is_unscored():
    final, audit = _verified_exchange_with_result_id()
    row = declaration(serve())
    adapter = _CountingAdapter(_persisted_state(format_version="semantic-state.v0-legacy"))
    verdict, reason, _ = SV.score(row, "served_with_data", "complete", final, audit, fake_legacy_score, adapter)
    _require((verdict, reason) == ("unscored", "semantic_state_version_unknown"), (verdict, reason))


def test_malformed_result_id_is_absent_and_adapter_is_never_called():
    # Domain table over `final.result_id`: {absent, null, empty string,
    # wrong scalar type} -- none of these may reach the adapter at all
    # (there is nothing to look up), and every one must read as
    # SEMANTIC_STATE_ABSENT, never a crash.
    row = declaration(serve())
    for label, mutate in [
        ("absent", lambda f: f.pop("result_id")),
        ("null", lambda f: f.__setitem__("result_id", None)),
        ("empty_string", lambda f: f.__setitem__("result_id", "")),
        ("wrong_type_int", lambda f: f.__setitem__("result_id", 12345)),
    ]:
        final, audit = _verified_exchange_with_result_id()
        mutate(final)
        adapter = _CountingAdapter(_persisted_state())
        verdict, reason, _ = SV.score(row, "served_with_data", "complete", final, audit, fake_legacy_score, adapter)
        _require((verdict, reason) == ("unscored", ES.SEMANTIC_STATE_ABSENT), (label, verdict, reason))
        _require(adapter.calls == [], f"{label}: an adapter must never be called with no result_id: {adapter.calls}")


def test_adapter_is_never_called_for_a_scalar_row():
    adapter = _CountingAdapter(_persisted_state())
    row = {"id": "synthetic", "text": "Synthetic", "expect": "serve"}
    SV.score(row, "served_with_data", "complete", {}, {}, fake_legacy_score, adapter)
    _require(adapter.calls == [], f"a scalar row must never consult the persisted-state adapter: {adapter.calls}")


def test_adapter_is_never_called_for_a_refuse_branch():
    final, audit = _verified_exchange_with_result_id()
    adapter = _CountingAdapter(_persisted_state())
    row = declaration({"outcome": "refuse"}, {"outcome": "decline"}, {"outcome": "clarify"})
    SV.score(row, "unserved", "complete", final, audit, fake_legacy_score, adapter)
    _require(adapter.calls == [],
             f"a refuse/decline/clarify branch must never consult the persisted-state adapter: {adapter.calls}")


def test_adapter_is_never_called_when_window_binding_mismatches_or_family_changed():
    # (window_binding mismatch, family_relation changed) both short-circuit
    # score_branch BEFORE the persisted-state check -- see score_branch.
    mismatched = base_exchange()
    mismatched[1]["request"]["priorWindowReceipts"][0]["receipt_id"] = "winr_unoffered"
    final_mismatch = {**mismatched[1]["response"]["result"], "result_id": "result-mismatch"}
    mismatched[1] = {**mismatched[1], "response": {"result": final_mismatch}}
    audit_mismatch = SV.audit_window_exchange(mismatched)
    _require(audit_mismatch["window_binding"] == "mismatch", audit_mismatch)
    adapter = _CountingAdapter(_persisted_state())
    row = declaration(serve())
    verdict, reason, _ = SV.score(row, "served_with_data", "complete", final_mismatch, audit_mismatch,
                                   fake_legacy_score, adapter)
    _require(verdict == "disagree", (verdict, reason))
    _require(adapter.calls == [], f"a window-binding mismatch must never reach the adapter: {adapter.calls}")

    changed = base_exchange(final_family="grouped_cohort_status", first_family="discovered_cohort_ranking")
    final_changed = {**changed[1]["response"]["result"], "result_id": "result-changed"}
    changed[1] = {**changed[1], "response": {"result": final_changed}}
    audit_changed = SV.audit_window_exchange(changed)
    _require(audit_changed["family_relation"] == "changed", audit_changed)
    adapter2 = _CountingAdapter(_persisted_state(family="grouped_cohort_status"))
    row2 = declaration(serve("grouped_cohort_status"))
    verdict2, reason2, _ = SV.score(row2, "served_with_data", "complete", final_changed, audit_changed,
                                     fake_legacy_score, adapter2)
    _require((verdict2, reason2) == ("unscored", "unratified_family_change"), (verdict2, reason2))
    _require(adapter2.calls == [], f"an unratified family change must never reach the adapter: {adapter2.calls}")


def test_persisted_link_fields_are_published_in_branch_results():
    final, audit = _verified_exchange_with_result_id()
    row = declaration(serve())
    record = SV.build_verdict(row, "served_with_data", "complete", final, audit, fake_legacy_score,
                               corpus_version="test-corpus-v0", legacy_scorer_version="fake-legacy-v1",
                               persisted_semantic_state=_CountingAdapter(_persisted_state()))
    branch = record["branch_results"][0]
    _require(branch["verdict"] == "agree", branch)
    _require(branch["result_id"] == final["result_id"], branch)
    _require(branch["persisted_format_version"] == "semantic-state.v1", branch)
    _require(branch["persisted_family"] == "discovered_cohort_ranking", branch)
    _require(branch["persisted_gate_outcome"] == "passed", branch)


def test_build_verdict_with_no_persisted_state_argument_is_backward_compatible():
    # Every call site that predates CHAOS-5722 (acr's semantic_verdict_bridge.py
    # included) calls build_verdict()/score() with no `persisted_semantic_state`
    # argument at all -- this must keep working exactly as documented (absent
    # adapter == adapter that found no row), never a TypeError.
    final, audit = _verified_exchange_with_result_id()
    row = declaration(serve())
    record = SV.build_verdict(row, "served_with_data", "complete", final, audit, fake_legacy_score,
                               corpus_version="test-corpus-v0", legacy_scorer_version="fake-legacy-v1")
    _require(record["verdict"] == "unscored", record)
    _require(record["reason"] == ES.SEMANTIC_STATE_ABSENT, record)


def test_rank_ordering_is_unchanged():
    # Regression pin: CHAOS-5722 adds a new terminal outcome (`agree` from a
    # persisted link) but must never touch the ordinal ranking itself.
    _require(SV._RANK == {"agree": 3, "agree_weak": 2, "unscored": 1, "disagree": 0}, SV._RANK)


_MUTATIONS = [
    ("receipt", "mismatch"),
    ("parent", "mismatch"),
    # Caught by the WindowClarification container's own `uniqueItems`
    # constraint now, before this audit's own per-page duplicate check
    # ever runs -- still fails closed, just via the schema-shape path
    # (`unreadable_exchange`) rather than this audit's own named reason.
    ("duplicate_offer", "unknown"),
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


_BANNED_TOKENS = (r"\bre\.", r"\bregex\b", r"\bdatetime\b", r"\bstrptime\b", r"\bcalendar\.", r"^import re$",
                  r"^import datetime$", r"^import calendar$")
_BANNED_RE = re.compile("|".join(_BANNED_TOKENS), re.MULTILINE)


def test_module_contains_no_regex_or_datetime_parsing_of_its_own():
    # The mechanical invariant: ajv (via schema_shim) is the ONLY
    # acceptance oracle in this module. No `re`/`datetime`/`calendar`
    # import, and no bare reference to `strptime`, may appear in
    # semantic_verdict.py's source -- a hand-rolled parser or format check
    # duplicating the schema's own rules is exactly what silently drifts
    # from the real contract over time.
    source = inspect.getsource(SV)
    hit = _BANNED_RE.search(source)
    _require(hit is None, f"semantic_verdict.py must not re-implement date/format parsing, found: {hit}")


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


# Window-shape legality (every RelativeWindowID/WindowOption/
# EffectiveEvidenceWindow branch, legal and illegal) is a schema-GENERATED
# table now, not hand-enumerated here -- see test_schema_driven_shapes.py.


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


def test_oversized_offer_container_cannot_verify():
    # WindowClarification.options caps at 20 items (and StructureNeeds at
    # the same, via window_options) -- a container ajv itself rejects must
    # never verify just because every individual WindowOption inside it is
    # otherwise well-formed. Only the container-level shape check catches
    # this; no per-offer loop ever will.
    attempts = base_exchange()
    first = attempts[0]["response"]["result"]
    extra_offers = [
        {**_offer(option_id=f"opt-extra-{i}", receipt_id=f"winr_extra{i:04d}")} for i in range(20)
    ]
    first["window_clarification"] = {"options": [_offer(), *extra_offers]}
    audit = SV.audit_window_exchange(attempts)
    _require(audit["window_binding"] != "verified", f"a 21-option container must not verify: {audit}")


def test_window_value_accepts_more_than_nine_fractional_digits():
    # ajv-formats' own `date-time` format has no upper bound on fractional
    # digits (`(?:\.\d+)?`) -- a value the pinned contract schema accepts
    # must not fail here just because a stricter, hand-rolled cap once
    # rejected it. This module has no timestamp parser of its own to
    # impose one: the ajv shim decides validity, and window ordering is
    # its own `ordered_ascending` fact (JS `Date.parse`), not a Python
    # computation -- so this is exercised through window_value(), not a
    # removed standalone parser.
    offer = {"receipt_id": "winr_precise0", "option_id": "opt-precise", "label": "precise",
             "start": "2026-05-01T00:00:00.1234567890123Z", "end": "2026-08-01T00:00:00Z"}
    value = SV.window_value(offer)
    _require(value == ("explicit", offer["start"], offer["end"]), value)


def _get(container, path):
    obj = container
    for key in path[:-1]:
        obj = obj[key]
    return obj, path[-1]


def _mutate(base_attempts, path, kind):
    mutated = copy.deepcopy(base_attempts)
    obj, key = _get(mutated, path)
    if kind == "absent":
        del obj[key]
    elif kind == "null":
        obj[key] = None
    elif kind == "wrong_type":
        current = obj[key]
        obj[key] = "wrong_type_string" if isinstance(current, (int, float)) else 12345
    elif kind == "empty":
        current = obj[key]
        obj[key] = [] if isinstance(current, list) else ({} if isinstance(current, dict) else "")
    elif kind == "duplicate_list":
        obj[key] = obj[key] * 2
    else:
        raise ValueError(kind)
    return mutated


# Every field this audit actually reads, per audit_window_exchange's own
# body, crossed with the mutations applicable to its own type. `kinds`
# lists only mutations that make sense for that field's shape (e.g.
# "duplicate_list" only where the value is a list feeding a uniqueness
# check).
_FUZZ_FIELDS = [
    ((1, "status"), ["absent", "null", "wrong_type"]),
    ((1, "response"), ["absent", "null", "wrong_type", "empty"]),
    ((1, "response", "result"), ["absent", "null", "wrong_type"]),
    ((1, "request"), ["absent", "null", "wrong_type", "empty"]),
    ((1, "request", "question"), ["absent", "null", "wrong_type"]),
    ((1, "request", "priorWindowReceipts"), ["absent", "null", "wrong_type", "empty", "duplicate_list"]),
    ((0, "response", "result", "status"), ["absent", "null", "wrong_type"]),
    ((0, "response", "result", "result_id"), ["absent", "null"]),
    ((0, "response", "result", "structure_needs"), ["absent", "null", "wrong_type"]),
    ((0, "response", "result", "window_clarification"), ["absent", "null", "wrong_type"]),
    ((0, "response", "result", "answer_plan"), ["absent", "null", "wrong_type"]),
    ((1, "response", "result", "answer_plan"), ["absent", "null", "wrong_type"]),
    ((1, "response", "result", "confirmed_structure"), ["absent", "null", "wrong_type", "empty", "duplicate_list"]),
    ((1, "response", "result", "effective_evidence_window"), ["absent", "null", "wrong_type"]),
]


def test_fuzz_every_consumed_field_fails_closed():
    # The hard invariant fail-closed guarantees: NOTHING here may ever
    # raise (F4), and nothing here may claim MORE confidence
    # (family_confirmation) than this schema version ever grants (always
    # "unavailable" -- see audit_window_exchange's docstring). Whether a
    # single-field mutation still verifies depends on whether that field's
    # data is redundant elsewhere in the exchange (e.g. window_options is
    # offered via two paths) -- the printed table below shows the actual
    # outcome per field/kind so that is visible, not asserted blind.
    base = base_exchange()
    executed = []
    for path, kinds in _FUZZ_FIELDS:
        for kind in kinds:
            try:
                mutated = _mutate(base, path, kind)
            except (KeyError, TypeError):
                continue  # this (path, kind) combination is not constructible; not a cell to report
            try:
                audit = SV.audit_window_exchange(mutated)
            except Exception as exc:  # noqa: BLE001 -- the whole point is that NOTHING may raise here
                _require(False, f"{path}/{kind} RAISED {type(exc).__name__}: {exc}")
            _require(isinstance(audit, dict) and "window_binding" in audit, f"{path}/{kind}: malformed audit {audit}")
            _require(audit["family_confirmation"] == "unavailable",
                     f"{path}/{kind} must never claim more than unavailable at this schema version, got {audit}")
            executed.append((path, kind, audit["window_binding"], audit["reason"]))
    for path, kind, binding, reason in executed:
        print(f"FUZZ {'.'.join(map(str, path))}/{kind}: window_binding={binding} reason={reason}")
    print(f"fuzz_every_consumed_field: {len(executed)} cells executed, 0 raised, 0 over-claimed confirmation")

    # The one cell that DOES have to break verification: both redundant
    # offer sources gone at once, leaving no offer to match the receipt.
    both_gone = copy.deepcopy(base)
    del both_gone[0]["response"]["result"]["structure_needs"]
    del both_gone[0]["response"]["result"]["window_clarification"]
    audit = SV.audit_window_exchange(both_gone)
    _require(audit["window_binding"] != "verified", f"both offer sources gone must not verify: {audit}")
    print(f"FUZZ both-offer-sources-absent: window_binding={audit['window_binding']} reason={audit['reason']}")


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for test in tests:
        test()
        print(f"PASS: {test.__name__}")
    print(f"PASS: {len(tests)} semantic_verdict controls")


if __name__ == "__main__":
    main()
