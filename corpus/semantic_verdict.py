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

THE ONLY ACCEPTANCE ORACLE. This module writes no pattern of its own to
recognize a timestamp string, calls no library to turn one into a
comparable value, and adds no hand-written field-presence/type check of
its own for any shape the pinned contract already describes: every window
offer
(`WindowOption`), window container (`WindowClarification`,
`StructureNeeds`), the server-canonicalized window
(`EffectiveEvidenceWindow`), a carried structure member's disposition
(`ConfirmedStructureEntry`), and a window receipt (`WindowBoundReceipt`)
are all validated through `schema_shim.validate_via_schema` (ajv, the same
library and options `src/lib/acr/validate.ts` already uses in product
code) before this module reads a single field out of them. Any fact about
a payload's own `start`/`end` ordering -- JSON Schema has no "field A
before field B" keyword -- is computed by the SAME shim (via JS
`Date.parse`), never by a Python-side timestamp parser; `test_semantic_verdict.py`'s
own grep control asserts this module's source never re-acquires one. The
outer two-attempt EXCHANGE envelope (`attempts`, each attempt's `request`/
`response` wrapper) is the acr corpus HARNESS's own capture convention,
not itself a shape the pinned wire contract describes (see below) --
navigating it is not a second acceptance oracle for a shape ajv already
owns.

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
  * CHAOS-5722: an `any_of` SERVE branch's family-confirmation link, read
    from the PERSISTED semantic state of the served result (acr's M2
    `semantic_state` column -- internal/contextfabric/semantic_state.go),
    not the wire. The wire carries only the `semantic_reading` disclosure
    (unavailable/absent/unreadable, D49) -- never the accepted reading
    itself -- so this module never opens a connection of its own: the
    caller (the corpus runner) injects a `persisted_semantic_state(result_id)
    -> dict | None` adapter, the same injection shape `legacy_score` already
    uses, and every reason this function returns for it reuses D49's own two
    closed tokens (`expect_schema.SEMANTIC_STATE_ABSENT`/
    `SEMANTIC_STATE_UNREADABLE`) so a harness report can never spell "no
    reading" differently from the engine's own disclosure.
"""

import expect_schema as S
from schema_shim import validate_via_schema

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
#
# Bumped for CHAOS-5722: a serve branch's family-confirmation link is now
# read from the served result's PERSISTED semantic state (when the caller
# supplies the `persisted_semantic_state` adapter) instead of being
# uniformly `unscored`/`family_confirmation_unavailable` -- a rescore under
# this version is not comparable to one under `any_of-fail-closed-v1`
# without saying so (see corpus/README.md).
POLICY_VERSION = "any_of-fail-closed-v2-persisted-family-link"

# Mirrors acr scripts/corpus/contract.py:63 (`is_success_status`) and its
# `SERVED_STATUSES = frozenset({200})`. The producer's contract, not
# ask-dev's; mirrored here because that file lives in acr and is not on
# ask-dev's sys.path. A change to acr's SERVED_STATUSES must be mirrored here
# by hand, the same way test_corpus.py mirrors validators.py.
_SERVED_HTTP_STATUSES = frozenset({200})


def is_success_status(status):
    return status in _SERVED_HTTP_STATUSES


class ValidatorUnavailable(Exception):
    """The ajv shim itself could not run or produced unreadable output --
    an INFRASTRUCTURE failure, distinct from an invalid or malformed
    exchange. Callers report this under its own reason
    (`validator_unavailable`), never conflated with `unreadable_exchange`
    (which means the DATA was bad, not the tooling)."""


class PersistedSemanticStateUnreadable(Exception):
    """CHAOS-5722: raised by a caller-supplied `persisted_semantic_state`
    adapter when the trial store carries a row for the given result id but
    it cannot be trusted (fails to decode, exceeds a bound, or otherwise
    cannot be read) -- distinct from the adapter returning `None`, which
    means no row exists at all. Mirrors acr's own absent-vs-unreadable
    distinction for a stored semantic reading (D49,
    internal/contracts/v1/context_fabric_semantic_reading.go). An adapter
    that cannot tell the two apart should prefer raising this over
    returning `None` -- "unreadable" is strictly more informative and this
    module reports it under its own D49 reason
    (`expect_schema.SEMANTIC_STATE_UNREADABLE`), never conflated with
    `SEMANTIC_STATE_ABSENT`.
    """


# acr internal/contextfabric/semantic_state.go: SemanticStateFormatVersion.
# Never on the wire (see this module's docstring), so unlike FAMILIES/
# SEMANTIC_STATE_ABSENT/SEMANTIC_STATE_UNREADABLE above there is no synced
# schema file to read this from -- mirrored here by hand, the same
# discipline _SERVED_HTTP_STATUSES below already uses for an acr constant
# this repo cannot import. A stored snapshot naming any other format is
# unavailable to this scorer, exactly as it is to acr's own reader.
_SEMANTIC_STATE_FORMAT_VERSION = "semantic-state.v1"

# acr internal/contextfabric/frame_gate.go: FrameGateOutcome's accepted
# member, FrameGatePassed. Hand-mirrored for the same reason as
# _SEMANTIC_STATE_FORMAT_VERSION above -- FrameGateOutcome never reaches the
# wire, so there is no synced contract file this module could read it from
# instead.
_GATE_OUTCOME_PASSED = "passed"


def _validate_shape(schema_def, payload):
    """Validate `payload` against `_COMMON_SCHEMA#/$defs/<schema_def>` and
    return its `ordered_ascending` fact (see schema_shim.validate_via_schema
    -- `None` when the payload carries no `start`/`end` pair). Nothing
    here parses a timestamp string or re-checks a field's presence/type
    on its own: ajv is the only acceptance oracle, and any ordering fact
    about a payload's own `start`/`end` is computed by the shim (via JS
    `Date.parse`), never here.

    Raises `ValidatorUnavailable` if the validator itself could not run,
    or `ValueError` (caught by every caller's existing fail-closed path)
    if the shape is schema-invalid.
    """
    ok, errors, ordered = validate_via_schema(_COMMON_SCHEMA, f"#/$defs/{schema_def}", payload)
    if ok is None:
        raise ValidatorUnavailable("; ".join(errors))
    if not ok:
        raise ValueError(f"invalid {schema_def}: {'; '.join(errors)}")
    return ordered


def window_value(window, schema_def="WindowOption"):
    """A comparable value for an evidence window, once validated against
    the pinned contract's own `schema_def` (`WindowOption` for an offer,
    `EffectiveEvidenceWindow` for the window an answer speaks for --
    different shapes: only `WindowOption` carries `receipt_id`/
    `option_id`/`label`). Distinguishes bounded windows (by their own
    `start`/`end` strings, read verbatim -- never parsed into a numeric
    form here), `all_time`, and an EXPLICIT bounded window carrying no
    `relative_id` at all (legal per the pinned contract: both defs require
    `relative_id` OR `start`+`end`, not neither, and no other combination
    reaches this point at all -- the schema itself enforces every
    combination the contract forbids). Bound ORDERING, which the schema
    does not express, is the shim's own `ordered_ascending` fact, applied
    here, never computed by this module."""
    ordered = _validate_shape(schema_def, window)
    relative = window.get("relative_id")
    if relative == "all_time":
        return (relative,)
    if ordered is not True:
        raise ValueError("unordered window")
    return (relative or "explicit", window["start"], window["end"])


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
        # `ref` matches `WindowBoundReceipt`'s shape exactly ({result_id,
        # receipt_id}, receipt_id namespaced `winr_`) even though it is
        # read from the harness's own camelCase request envelope, not the
        # wire's snake_case one -- the RECEIPT OBJECT ITSELF is the same
        # shape either way, only the envelope key naming around it differs
        # (see the module docstring on the harness-vs-wire boundary).
        _validate_shape("WindowBoundReceipt", ref)
        structure_needs = first.get("structure_needs")
        window_clarification = first.get("window_clarification")
        # Validate the CONTAINER objects themselves, not only the offers
        # inside them: `WindowClarification.options` and
        # `StructureNeeds.window_options` carry their own `minItems`/
        # `maxItems`/`uniqueItems` constraints (e.g. at most 20 offers) that
        # validating each `WindowOption` individually can never see -- an
        # offer list a lone-item check accepts one at a time can still be a
        # container ajv itself rejects.
        if structure_needs is not None:
            _validate_shape("StructureNeeds", structure_needs)
        if window_clarification is not None:
            _validate_shape("WindowClarification", window_clarification)
        pages = [
            page
            for page in [
                (structure_needs or {}).get("window_options"),
                (window_clarification or {}).get("options"),
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
    except ValidatorUnavailable:
        # An INFRASTRUCTURE failure (the ajv shim itself could not run),
        # never conflated with a malformed exchange: an operator needs to
        # tell "my data is bad" apart from "my tooling is broken".
        return {**out, "reason": "validator_unavailable"}
    except (KeyError, TypeError, ValueError, AttributeError):
        return {**out, "reason": "unreadable_exchange"}


def _score_persisted_family_confirmation(observed_family, final, persisted_semantic_state):
    """CHAOS-5722: the terminal step of a serve branch's family-confirmation
    link, once the observed family matches the declared one and the
    window-binding audit is clean (score_branch's caller already checked
    both). Never called for a scalar row, a refuse branch, or a branch that
    already failed an earlier check -- see score_branch.

    `persisted_semantic_state` is `None` when the caller wired in no
    adapter at all (every legacy `build_verdict`/`score` call site that
    predates this ticket) -- treated exactly like an adapter that found no
    row: `unscored`/`SEMANTIC_STATE_ABSENT`, never a crash and never a
    promotion to `agree`.
    """
    detail = {}
    if persisted_semantic_state is None:
        return "unscored", S.SEMANTIC_STATE_ABSENT, detail
    result_id = final.get("result_id") if isinstance(final, dict) else None
    if not isinstance(result_id, str) or not result_id:
        return "unscored", S.SEMANTIC_STATE_ABSENT, detail
    detail["result_id"] = result_id
    try:
        persisted = persisted_semantic_state(result_id)
    except PersistedSemanticStateUnreadable:
        return "unscored", S.SEMANTIC_STATE_UNREADABLE, detail
    if persisted is None:
        return "unscored", S.SEMANTIC_STATE_ABSENT, detail
    if not isinstance(persisted, dict):
        return "unscored", S.SEMANTIC_STATE_UNREADABLE, detail
    format_version = persisted.get("format_version")
    detail["persisted_format_version"] = format_version
    if format_version != _SEMANTIC_STATE_FORMAT_VERSION:
        return "unscored", "semantic_state_version_unknown", detail
    persisted_family = persisted.get("family")
    validation = persisted.get("validation")
    gate_outcome = validation.get("gate_outcome") if isinstance(validation, dict) else None
    if not isinstance(persisted_family, str) or not isinstance(validation, dict) or not isinstance(gate_outcome, str):
        # A row at a format_version this scorer knows must carry these
        # fields (they are required, non-nullable, in that format) -- one
        # missing or mistyped is the row failing to be what its own declared
        # format promises, i.e. unreadable, never a mismatch verdict against
        # values that were never really there.
        return "unscored", S.SEMANTIC_STATE_UNREADABLE, detail
    detail["persisted_family"] = persisted_family
    if persisted_family != observed_family:
        return "disagree", "persisted_family_mismatch", detail
    detail["persisted_gate_outcome"] = gate_outcome
    if gate_outcome != _GATE_OUTCOME_PASSED:
        return "unscored", "gate_outcome_not_accepted", detail
    return "agree", "family_confirmed", detail


def score_branch(row, branch, bucket, status, final, audit, legacy_score, persisted_semantic_state=None,
                  **identity):
    """Score one `any_of` alternative.

    `legacy_score(scalar_row, bucket, status, **identity) -> (verdict, reason)`
    is the caller-supplied scalar leaf scorer (acr's real table in
    production; a test double in ask-dev's own tests -- see
    test_semantic_verdict.py). This function never grants `agree` for a
    serve branch on outcome alone: it additionally requires the observed
    family to match the declared one, the window-binding audit to have found
    NO POSITIVE MISTAKE (`!= "mismatch"` -- see the next paragraph for why
    this is not the same as "verified"), and (CHAOS-5722) the
    family-confirmation link from the served result's PERSISTED semantic
    state (`persisted_semantic_state`, injected the same way `legacy_score`
    is -- this function never opens a connection of its own) -- see
    `_score_persisted_family_confirmation`. Any step short of a complete,
    matching link stays `unscored` under one of D49's two closed reasons; a
    positive family mismatch (declared, or persisted) or a window-binding
    mismatch is `disagree`, never `unscored`.

    WHY `window_binding != "mismatch"`, NOT `== "verified"`. The window
    audit (`audit_window_exchange`) and the persisted-family link below are
    two INDEPENDENT sources of evidence about two DIFFERENT questions: the
    audit asks "was a window-clarification receipt correctly offered and
    applied", the persisted link asks "does the engine's own record of what
    it served and validated match what was declared". A row that never went
    through a window-clarification exchange at all (an ordinary single-turn
    serve -- the audit's own default, `window_binding="unknown"`,
    `reason="unsupported_exchange"`) has NOTHING for the first question to
    confirm or deny; that says nothing about the second question, which the
    persisted link answers on its own, from the engine's own stored state,
    not from the corpus harness's capture of a conversation. Only a
    POSITIVE, PROVEN mistake in the window mechanics (`"mismatch"` -- a
    receipt applied to the wrong offer, a conflicting confirmation, ...)
    contradicts what a served answer's family/gate says; an inconclusive or
    absent audit does not, and must not silently downgrade a real,
    independently-confirmed persisted link to `unscored`. See
    `test_persisted_link_promotes_a_single_turn_serve_with_no_window_exchange_at_all`
    for the executed proof, and the ticket's own rescore evidence (a real
    single-turn `any_of` row, `window_binding="unknown"`, correctly reaching
    `agree` from its persisted state).

    Returns `(verdict, reason, detail)` -- `detail` is `{}` unless the
    persisted-state check actually ran and read something, in which case it
    carries exactly the fields this function consulted (`result_id`,
    `persisted_format_version`, `persisted_family`,
    `persisted_gate_outcome`), so a published record can show why a serve
    branch won or did not without a reader needing to re-run the query.
    """
    scalar = {**row, "expect": branch["outcome"], "basis": branch.get("basis")}
    verdict, why = legacy_score(scalar, bucket, status, **identity)
    if branch["outcome"] != S.SERVE or verdict not in {"agree", "agree_weak"}:
        return verdict, why, {}
    # `final` is evidence, not a guaranteed shape: a row with no successful
    # result at all (error/no_match/turns-exhausted) legitimately has no
    # `final` payload to read a family from. Missing or malformed evidence
    # is `family_unavailable`, never an exception.
    observed = (final.get("answer_plan") or {}).get("family") if isinstance(final, dict) else None
    if observed is None:
        return "unscored", "family_unavailable", {}
    if observed != branch["answer"]["family"]:
        return "disagree", "declared_family_mismatch", {}
    if audit["window_binding"] == "mismatch":
        return "disagree", audit["reason"], {}
    if audit["family_relation"] == "changed":
        return "unscored", "unratified_family_change", {}
    return _score_persisted_family_confirmation(observed, final, persisted_semantic_state)


_RANK = {"agree": 3, "agree_weak": 2, "unscored": 1, "disagree": 0}


def score(row, bucket, status, final, audit, legacy_score, persisted_semantic_state=None, **identity):
    """(verdict, reason, branch_results) for one row/rep.

    `branch_results` is `[]` for a scalar/absent declaration (legacy_score's
    own verdict is authoritative and unchanged) and the full per-branch list
    of `(verdict, reason, detail)` triples for an `any_of` declaration, in
    declaration order -- every branch result is retained, never only the
    winner, so a report can show why an undecidable or losing alternative
    did not manufacture a pass. `persisted_semantic_state` (CHAOS-5722) is
    forwarded to `score_branch` unchanged; it is never consulted for a
    scalar/absent declaration (this function never calls score_branch at
    all in that case) or for a refuse/decline/clarify branch (score_branch
    returns before reaching it -- see score_branch).
    """
    ok, reason, choices = S.parse_expect(row.get("expect") if isinstance(row, dict) else None)
    if not ok:
        # `validator_unavailable` is an infrastructure failure (the ajv
        # shim could not run), never conflated with `invalid_expectation`
        # (a data problem: the declaration itself does not match the
        # schema) -- see semantic_verdict.py's own ValidatorUnavailable.
        if reason.startswith("validator_unavailable:"):
            return "unscored", reason, []
        return "unscored", "invalid_expectation:" + reason, []
    if choices is None:
        verdict, why = legacy_score(row, bucket, status, **identity)
        return verdict, why, []
    results = [
        score_branch(row, b, bucket, status, final, audit, legacy_score, persisted_semantic_state, **identity)
        for b in choices
    ]
    best = max(results, key=lambda r: _RANK[r[0]])
    return best[0], best[1], results


def build_verdict(row, bucket, status, final, audit, legacy_score, corpus_version,
                   legacy_scorer_version, persisted_semantic_state=None, **identity):
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

    `persisted_semantic_state` (CHAOS-5722, optional) is the same adapter
    `score`/`score_branch` take; omitting it (every call site that predates
    this ticket) scores exactly as if the adapter found no persisted row for
    every serve branch it would otherwise have consulted -- see
    `_score_persisted_family_confirmation`.
    """
    verdict, reason, branch_results = score(row, bucket, status, final, audit, legacy_score,
                                             persisted_semantic_state, **identity)
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
            {"verdict": v, "reason": r, **detail} for v, r, detail in branch_results
        ],
        "family_relation": audit.get("family_relation", "unknown"),
        "window_binding": audit.get("window_binding", "unknown"),
        "family_confirmation": audit.get("family_confirmation", "unavailable"),
    }
