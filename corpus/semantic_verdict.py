#!/usr/bin/env python3
"""CHAOS-5620: the versioned semantic verdict, published beside the five
existing buckets (served_with_data / served_degraded / clarification_needed
/ unserved / error) without changing them.

WHAT THIS DOES NOT DO. It does not replace or re-implement acr's scalar leaf
scoring table (COHERENCE / VERDICTS in scripts/corpus/expectations.py) -- that
table is acr's, stays acr's, and no wire/contract or engine behavior changes
here. Every function below that needs a scalar verdict (a serve/refuse/
decline/clarify outcome against a bucket+terminal-status) takes it as an
INJECTED callable (`legacy_score`), never imports acr. This keeps the new
machinery runnable in ask-dev CI, where no acr checkout is available (the
same reason corpus/test_corpus.py hand-mirrors acr's validators.py instead of
importing it), and it means the two sides can never silently drift apart --
there is only ever one implementation of the scalar table, acr's.

WHAT THIS DOES. It adds:

  * a fail-closed AUDIT of a two-turn window-clarification exchange, telling
    apart the DECLARED target (what the corpus row asks for), the PROPOSED
    interpretation (what the engine's `answer_plan.family` said at each
    turn), and the ACCEPTED question state (what a verified window receipt
    actually confirmed) -- matching the declared family, or repeating
    turn-1's family, manufactures neither of the last two.
  * BRANCH COMBINATION for an `any_of` declaration (see expect_schema.py):
    every alternative is evaluated, the best result wins, and an
    undecidable alternative can never turn into a pass -- only a decided,
    complete, matching branch can.
  * explicit VERSIONING (SCORER_VERSION / POLICY_VERSION) and explicit
    unscored/unverifiable counts on every published verdict record, so a
    rescore under a changed policy is never mistaken for one under the old
    policy (see corpus/README.md).
"""

import calendar
import datetime
import re

import expect_schema as S
from schema_shim import SchemaShimError, validate_via_schema

# The one contract schema file every window/confirmation shape below is
# validated against -- offers (`WindowOption`), the server-canonicalized
# window an answer speaks for (`EffectiveEvidenceWindow`), and a carried
# structure member's disposition (`ConfirmedStructureEntry`). Each shape
# accepts EXACTLY what its own $def in this schema accepts (a
# `relative_id` typed and enum-constrained as the schema declares, an
# `applied_value` the schema requires to be a non-empty string), never a
# hand-rolled Python check that could accept or reject something the
# schema itself does not -- see this module's docstring and
# corpus/README.md.
_COMMON_SCHEMA = "context_fabric_common.v1.schema.json"

# Bump on any change to the audit/branch-combination behavior below (not on a
# schema change -- that is expect_schema.SCHEMA_VERSION). A published verdict
# record carries both, plus the caller's own POLICY_VERSION for whichever
# scalar table it plugged in.
SCORER_VERSION = "chaos-5620-semantic-verdict-v1"

# The policy this module implements: complete matching branch -> pass; any
# missing evidence -> unverifiable, never pass. A future policy (e.g. "corpus-
# oracle agreement suffices without a caller-confirmation receipt") is a
# product/data decision (see the design of record) and gets its own version
# string, never a silent redefinition of this one.
POLICY_VERSION = "any_of-fail-closed-v1"

# Mirrors acr scripts/corpus/contract.py:63 (`is_success_status`) and its
# `SERVED_STATUSES = frozenset({200})`. The producer's contract, not
# ask-dev's; mirrored here because that file lives in acr and is not on
# ask-dev's sys.path. A change to acr's SERVED_STATUSES must be mirrored here
# by hand, the same way test_corpus.py mirrors validators.py.
_SERVED_HTTP_STATUSES = frozenset({200})


def is_success_status(status):
    return status in _SERVED_HTTP_STATUSES


_TIMESTAMP_RE = re.compile(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)")


def timestamp(value):
    """Integer nanoseconds since the epoch, preserving RFC3339Nano precision
    (Go's `time.Time` resolution) rather than truncating to microseconds."""
    match = _TIMESTAMP_RE.fullmatch(value)
    if not match:
        raise ValueError("invalid timestamp")
    base, fraction, zone = match.groups()
    parsed = datetime.datetime.fromisoformat(base + zone.replace("Z", "+00:00"))
    return calendar.timegm(parsed.utctimetuple()) * 10**9 + int((fraction or "").ljust(9, "0"))


def _validate_shape(schema_def, payload):
    """Validate `payload` against `_COMMON_SCHEMA#/$defs/<schema_def>`.
    Raises ValueError (caught by every caller's existing fail-closed path)
    on an invalid shape, or a broken validator alike -- a validator that
    cannot run must never be silently read as "this shape is fine"."""
    try:
        ok, errors = validate_via_schema(_COMMON_SCHEMA, f"#/$defs/{schema_def}", payload)
    except SchemaShimError as exc:
        raise ValueError(f"{schema_def} schema validation unavailable: {exc}") from exc
    if not ok:
        raise ValueError(f"invalid {schema_def}: {'; '.join(errors)}")


def window_value(window, schema_def="WindowOption"):
    """A comparable value for an evidence window, once validated against
    the pinned contract's own `schema_def` (`WindowOption` for an offer,
    `EffectiveEvidenceWindow` for the window an answer speaks for --
    different shapes: only `WindowOption` carries `receipt_id`/
    `option_id`/`label`). Distinguishes bounded windows (by their frozen
    instants, not a shared relative label), `all_time`, and an EXPLICIT
    bounded window carrying no `relative_id` at all (legal per the pinned
    contract: both defs require `relative_id` OR `start`+`end`, not
    neither, and no other combination reaches this point at all -- the
    schema itself enforces every combination the contract forbids, this
    function only enforces bound ORDERING, which the schema does not)."""
    _validate_shape(schema_def, window)
    relative = window.get("relative_id")
    if relative == "all_time":
        return (relative,)
    start, end = timestamp(window["start"]), timestamp(window["end"])
    if start >= end:
        raise ValueError("unordered window")
    return (relative or "explicit", start, end)


def audit_window_exchange(attempts):
    """Audit a two-turn window-clarification exchange for one corpus row/rep.

    Returns a dict with `family_relation` (unknown/same/changed -- diagnostic
    only, NEVER caller confirmation), `window_binding` (unknown/mismatch/
    verified), `family_confirmation` (always "unavailable" at this schema
    version: the wire has no producer-authored family-acceptance link, see
    the design of record), and `reason`.

    A retry is an attempt, not a new semantic turn: a retryable failure is
    discarded only when the immediately following request is byte-identical
    to it. Anything this audit cannot positively verify comes back
    `unknown`/`unavailable`, never a manufactured pass.
    """
    out = {
        "family_relation": "unknown",
        "window_binding": "unknown",
        "family_confirmation": "unavailable",
        "reason": "unsupported_exchange",
    }
    if not isinstance(attempts, list):
        return out
    # Every read below -- including the retry-collapse check, which touches
    # attacker/producer-controlled `response`/`request` shapes just as much
    # as the rest of this function -- is inside the SAME try/except as the
    # parse that follows. A malformed attempt (a non-dict `response`, a
    # `failure` that is not a mapping) must fail closed to `unreadable_exchange`,
    # never raise past this function's caller.
    try:
        semantic_turns = []
        for index, attempt in enumerate(attempts):
            if not isinstance(attempt, dict):
                return out
            if is_success_status(attempt.get("status")):
                semantic_turns.append(attempt)
            elif (
                index + 1 < len(attempts)
                and isinstance(attempt.get("response"), dict)
                and isinstance(attempt["response"].get("failure"), dict)
                and attempt["response"]["failure"].get("retryable") is True
                and attempt.get("request") == attempts[index + 1].get("request")
            ):
                continue
            else:
                return out
        attempts = semantic_turns
        if len(attempts) != 2:
            return out
        before, after = attempts
        # This is the acr CORPUS HARNESS's own attempt-record shape (`request`
        # is the exact dict the harness's `post()` builds and logs, `response`
        # is what `post()` returns, wrapping the parsed body under `result`) --
        # not the raw internal/contracts/v1 Go struct's json tags. The harness
        # builds this request body itself, camelCase, at
        # scripts/corpus/harness.py's window-receipt call site, and reads
        # `payload.get("result")` on the way back; that is the recorded shape
        # every corpus proof-of-record attempt file on disk actually carries,
        # confirmed against real recorded attempts (see the CHAOS-5620
        # TEST-EVIDENCE replay). A caller handing this function a raw
        # snake_case wire request/response, unwrapped, is passing the wrong
        # layer's shape -- fails closed to `unreadable_exchange` below, same
        # as any other unrecognized input.
        first, final = before["response"]["result"], after["response"]["result"]
        request = after["request"]
        if set(request) != {"question", "priorWindowReceipts"}:
            return out
        if before["request"]["question"] != request["question"]:
            return out
        if first["status"] != "clarification_required":
            return out
        refs = request["priorWindowReceipts"]
        if len(refs) != 1 or refs[0]["result_id"] != first["result_id"]:
            return {**out, "window_binding": "mismatch", "reason": "wrong_parent"}
        ref = refs[0]
        pages = [
            page
            for page in [
                (first.get("structure_needs") or {}).get("window_options"),
                (first.get("window_clarification") or {}).get("options"),
            ]
            if page
        ]
        for page in pages:
            if len({o["receipt_id"] for o in page}) != len(page) or len(
                {o["option_id"] for o in page}
            ) != len(page):
                return {**out, "window_binding": "mismatch", "reason": "duplicate_offer"}
            # Validate EVERY offered window's shape up front, in every page,
            # not only when reconciling two redundant pages: an offer this
            # audit could not otherwise validate (a malformed or invalid
            # `relative_id`, e.g. `null`, mismatched bounds, ...) must never
            # reach the confirmation check below un-checked -- window_value
            # raising here is caught by this function's own try/except and
            # fails closed to `unreadable_exchange`, never `verified`.
            for offer in page:
                window_value(offer)
        if len(pages) == 2:
            bindings = [
                {o["receipt_id"]: (o["option_id"], window_value(o)) for o in page} for page in pages
            ]
            if bindings[0] != bindings[1]:
                return {**out, "window_binding": "mismatch", "reason": "conflicting_offer_pages"}
        options = pages[0] if pages else []
        matched = [o for o in options if o.get("receipt_id") == ref["receipt_id"]]
        if len(matched) != 1:
            return {**out, "window_binding": "mismatch", "reason": "unoffered_or_duplicate_receipt"}
        offer = matched[0]
        initial_family = first.get("answer_plan", {}).get("family")
        final_family = final.get("answer_plan", {}).get("family")
        if initial_family and final_family:
            out["family_relation"] = "same" if initial_family == final_family else "changed"
        entries = [c for c in final.get("confirmed_structure", []) if c.get("member") == "window"]
        if not entries:
            return {**out, "reason": "missing_window_ack"}
        if len(entries) != 1:
            return {**out, "window_binding": "mismatch", "reason": "duplicate_window_ack"}
        confirmation = entries[0]
        # Validate the confirmation entry's own shape (e.g. `applied_value`
        # must be a non-empty string per ConfirmedStructureEntry) BEFORE
        # comparing its values against what this exchange should have
        # produced -- a schema-invalid confirmation (a null applied_value,
        # a receipt-sourced entry missing its receipt_id) must never reach
        # an equality check that could accidentally "match" two invalid
        # nulls and manufacture a false verification.
        _validate_shape("ConfirmedStructureEntry", confirmation)
        offer_relative_id = offer.get("relative_id")
        if offer_relative_id is None:
            # A legal, contract-permitted explicit-bounds-only offer (no
            # relative_id -- see window_value's docstring). The
            # confirmation check below is defined in terms of a relative_id
            # `applied_value`; there is no confirmed wire convention yet for
            # how an explicit-only offer's application is recorded, so this
            # stops here rather than guess one -- unknown, never a
            # manufactured pass and never a crash on a legal shape.
            return {**out, "reason": "explicit_offer_confirmation_unsupported"}
        expected = {
            "prior_result_id": first["result_id"],
            "receipt_id": ref["receipt_id"],
            "source": "receipt",
            "provenance": "clarification_confirmed",
            "disposition": "applied",
            "applied_value": offer_relative_id,
        }
        if any(confirmation.get(k) != v for k, v in expected.items()):
            return {**out, "window_binding": "mismatch", "reason": "window_ack_mismatch"}
        effective = final.get("effective_evidence_window")
        if effective is None:
            return {**out, "reason": "missing_effective_window"}
        if effective.get("provenance") != "clarification_confirmed" or window_value(
            effective, "EffectiveEvidenceWindow"
        ) != window_value(offer):
            return {**out, "window_binding": "mismatch", "reason": "effective_window_mismatch"}
        return {**out, "window_binding": "verified", "reason": "family_confirmation_unavailable"}
    except (KeyError, TypeError, ValueError, AttributeError):
        return {**out, "reason": "unreadable_exchange"}


def score_branch(row, branch, bucket, status, final, audit, legacy_score, **identity):
    """Score one `any_of` alternative.

    `legacy_score(scalar_row, bucket, status, **identity) -> (verdict, reason)`
    is the caller-supplied scalar leaf scorer (acr's real table in
    production; a test double in ask-dev's own tests -- see
    test_semantic_verdict.py). This function never grants `agree` for a
    serve branch on outcome alone: it additionally requires the observed
    family to match the declared one, and then requires a verified,
    unmistaken family-confirmation link before calling it more than
    `unscored` -- which the current wire cannot supply (see
    audit_window_exchange), so a serve branch's ceiling today is
    `unscored`/`family_confirmation_unavailable`, never `agree`.
    """
    scalar = {**row, "expect": branch["outcome"], "basis": branch.get("basis")}
    verdict, why = legacy_score(scalar, bucket, status, **identity)
    if branch["outcome"] != S.SERVE or verdict not in {"agree", "agree_weak"}:
        return verdict, why
    # `final` is evidence, not a guaranteed shape: a row with no successful
    # result at all (error/no_match/turns-exhausted) legitimately has no
    # `final` payload to read a family from. Missing or malformed evidence
    # is `family_unavailable`, never an exception.
    observed = (final.get("answer_plan") or {}).get("family") if isinstance(final, dict) else None
    if observed is None:
        return "unscored", "family_unavailable"
    if observed != branch["answer"]["family"]:
        return "disagree", "declared_family_mismatch"
    if audit["window_binding"] == "mismatch":
        return "disagree", audit["reason"]
    if audit["family_relation"] == "changed":
        return "unscored", "unratified_family_change"
    return "unscored", "family_confirmation_unavailable"


_RANK = {"agree": 3, "agree_weak": 2, "unscored": 1, "disagree": 0}


def score(row, bucket, status, final, audit, legacy_score, **identity):
    """(verdict, reason, branch_results) for one row/rep.

    `branch_results` is `[]` for a scalar/absent declaration (legacy_score's
    own verdict is authoritative and unchanged) and the full per-branch list
    for an `any_of` declaration, in declaration order -- every branch result
    is retained, never only the winner, so a report can show why an
    undecidable alternative did not manufacture a pass.
    """
    ok, reason, choices = S.parse_expect(row.get("expect") if isinstance(row, dict) else None)
    if not ok:
        return "unscored", "invalid_expectation:" + reason, []
    if choices is None:
        verdict, why = legacy_score(row, bucket, status, **identity)
        return verdict, why, []
    results = [score_branch(row, b, bucket, status, final, audit, legacy_score, **identity) for b in choices]
    best = max(results, key=lambda r: _RANK[r[0]])
    return best[0], best[1], results


def build_verdict(row, bucket, status, final, audit, legacy_score, corpus_version,
                   legacy_scorer_version, **identity):
    """The published, versioned semantic-verdict record for one row/rep.

    Carries SCORER_VERSION/POLICY_VERSION/`corpus_version` explicitly (a
    rescore under any of the three changing is never compared to a prior run
    as like-for-like without saying so), plus the legacy bucket unchanged,
    the semantic verdict/reason, every branch result, and an explicit
    `unscored` flag -- dropping unknowns from a report, rather than counting
    them against a fixed denominator, would let disappearing evidence
    improve the score.

    `legacy_scorer_version` is REQUIRED, not defaulted: SCORER_VERSION/
    POLICY_VERSION/SCHEMA_VERSION only identify THIS module's own behavior,
    never the injected `legacy_score` callable's -- two different scalar
    scoring policies wired in behind the same call can produce different
    verdicts while carrying identical metadata otherwise. The caller must
    name its own scorer's identity (e.g. acr's git sha, or a test double's
    own label) so a rescore under a changed `legacy_score` is never
    mistaken for a rescore under the same one.
    """
    verdict, reason, branch_results = score(row, bucket, status, final, audit, legacy_score, **identity)
    return {
        "scorer_version": SCORER_VERSION,
        "policy_version": POLICY_VERSION,
        "schema_version": S.SCHEMA_VERSION,
        "legacy_scorer_version": legacy_scorer_version,
        "corpus_version": corpus_version,
        "corpus_id": row.get("id") if isinstance(row, dict) else None,
        "bucket": bucket,
        "verdict": verdict,
        "reason": reason,
        "unscored": verdict == "unscored",
        "branch_results": [
            {"verdict": v, "reason": r} for v, r in branch_results
        ],
        "family_relation": audit.get("family_relation", "unknown"),
        "window_binding": audit.get("window_binding", "unknown"),
        "family_confirmation": audit.get("family_confirmation", "unavailable"),
    }
