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

CHAOS-5620: `expect` may now ALSO be an explicit `{"any_of": [...]}`
disjunction (see expect_schema.py); the scalar form's rules and error
messages are unchanged byte-for-byte. Shape validation for both forms is
delegated to `expect_schema.parse_expect`, the single source of truth this
module and semantic_verdict.py both use -- no expect-shape rule is spelled
twice.

Run: python3 corpus/test_corpus.py
"""
import copy
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
import expect_schema  # noqa: E402

# Mirrors acr scripts/corpus/validators.py:15 (EXPECT_VALUES) and
# :129-157 (validate_corpus_row). Keep in sync by hand: acr's corpus
# harness (scripts/corpus/*.py) is supplied externally on sys.path at run
# time, never committed here, so there is no shared import to pin against.
# Re-exported from expect_schema so there is exactly one spelling of this
# set in this repo (CHAOS-5620).
EXPECT_VALUES = expect_schema.EXPECT_VALUES

# CHAOS-5599: the five terminal buckets a scored baseline row can land in,
# per semantic_verdict.py's module docstring (served_with_data /
# served_degraded / clarification_needed / unserved / error). No acr
# checkout is available here (see this file's module docstring), so this
# is a hand-mirror, same discipline as EXPECT_VALUES above -- keep both in
# sync by hand if the bucket set changes.
BUCKET_VALUES = frozenset({
    "served_with_data", "served_degraded", "unserved",
    "clarification_needed", "error",
})

# Pinned sha256 of corpus/baseline-20260905-sweep1.json. A silent edit to
# the baseline (hand or otherwise) fails CI here until this constant AND
# corpus/README.md's sha chain are both updated deliberately -- see
# corpus/README.md "## Versioning".
BASELINE_SHA256 = "ab7f8bb0ffda440240a8f60e3b1f07e8c86ed42b9ab740bedfdcdc3f5964b1dd"
BASELINE_PATH = Path(__file__).parent / "baseline-20260905-sweep1.json"


def validate_corpus_row(row):
    """(ok, reason) -- same shape and rules as acr's validators.py:129,
    plus `id`/`text` presence: acr's corpus harness reads both directly, so
    a row missing either must fail here, at the ingestion boundary, rather
    than downstream inside the evaluator. Also validates CHAOS-5620's
    `any_of` disjunction shape (delegated to expect_schema.parse_expect so
    this rule is authored once)."""
    if not isinstance(row, dict):
        return False, "row is not a mapping"

    row_id = row.get("id")
    if not isinstance(row_id, str) or not row_id:
        return False, f"id must be a non-empty string, got {row_id!r}"

    text = row.get("text")
    if not isinstance(text, str) or not text:
        return False, f"text must be a non-empty string, got {text!r}"

    ok, reason, branches = expect_schema.parse_expect(row.get("expect"))
    if not ok:
        return False, reason

    basis = row.get("basis")
    if basis is not None and not isinstance(basis, str):
        return False, f"basis must be a string or None, got {type(basis).__name__}"
    if branches is not None and basis is not None:
        return False, "an any_of row must declare basis on each alternative, not at row level"

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
        # CHAOS-5620: any_of shape controls.
        ({"id": "x", "text": "hello", "expect": {"any_of": []}}, "any_of"),
        ({"id": "x", "text": "hello", "expect": {"any_of": [{"outcome": "bogus"}]}}, "outcome"),
        ({"id": "x", "text": "hello", "expect": {"any_of": [{"outcome": "serve"}]}}, "answer"),
        ({"id": "x", "text": "hello",
          "expect": {"any_of": [{"outcome": "serve", "answer": {"family": "not_a_family"}}]}},
         "answer/family"),
        ({"id": "x", "text": "hello", "expect": {"any_of": [{"outcome": "decline"}]}, "basis": "named_basis"},
         "row level"),
    ]
    for bad_row, must_mention in cases:
        ok, reason = validate_corpus_row(bad_row)
        _require(not ok, f"RED CONTROL FAILED: {bad_row!r} was accepted")
        _require(must_mention in (reason or ""),
                  f"RED CONTROL FAILED: {bad_row!r} rejected for the wrong reason: {reason!r}")
    # GREEN controls: the smallest legal scalar row, and a legal any_of row.
    ok, reason = validate_corpus_row({"id": "x", "text": "hello"})
    _require(ok, f"GREEN CONTROL FAILED: minimal legal row rejected: {reason!r}")
    ok, reason = validate_corpus_row({
        "id": "x", "text": "hello",
        "expect": {"any_of": [
            {"outcome": "serve", "answer": {"family": "discovered_cohort_ranking"}},
            {"outcome": "decline", "basis": "named_basis"},
        ]},
    })
    _require(ok, f"GREEN CONTROL FAILED: legal any_of row rejected: {reason!r}")


def _require_type(doc, key, want_type, type_name):
    val = doc.get(key)
    _require(isinstance(val, want_type),
              f"baseline.{key} must be a {type_name}, got {type(val).__name__}")
    return val


def _validate_baseline_doc(doc, corpus_ids):
    """Shape + cross-check logic for a parsed baseline document, separated
    from file I/O and the sha256 pin (see `_validate_baseline` below) so
    RED/GREEN fixtures can exercise it directly without a real file on
    disk -- see `_self_test_baseline_guard_fires`.

    Type-checks every required top-level field (not just presence -- a
    baseline with `ticket=None`/`provenance=None`/`per_family=None`
    previously passed, r1 finding P3) and requires each row to carry the
    real schema's `corpus_id`/`family`/`bucket` fields, not just
    `corpus_id` alone.

    CHAOS-5599: also cross-checks a re-pinned baseline is internally
    consistent -- no two rows share a `corpus_id`, every row's `bucket` is
    in the known vocabulary (`BUCKET_VALUES`), and `totals` (both the
    overall `total` and each known bucket's count) agrees with the actual
    rows rather than being a stale summary left over from a hand edit.
    """
    _require(isinstance(doc, dict), "baseline must be a JSON object")

    ticket = _require_type(doc, "ticket", str, "string")
    _require(ticket, "baseline.ticket must be a non-empty string")
    _require_type(doc, "provenance", dict, "mapping")
    totals = _require_type(doc, "totals", dict, "mapping")
    per_family = _require_type(doc, "per_family", dict, "mapping")
    rows = _require_type(doc, "rows", list, "list")
    _require(rows, "baseline.rows must be a nonempty list")

    row_ids = []
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
        bucket = row["bucket"]
        _require(bucket in BUCKET_VALUES,
                  f"baseline.rows[{i}].bucket must be one of {sorted(BUCKET_VALUES)}, got {bucket!r}")
        row_ids.append(row["corpus_id"])

    dupes = sorted({rid for rid in row_ids if row_ids.count(rid) > 1})
    _require(not dupes, f"duplicate corpus_id(s) in baseline.rows: {dupes}")

    baseline_ids = set(row_ids)
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

    # Per-bucket totals are optional keys (only `total` is required above),
    # but any that ARE present must be an int and must agree with the rows
    # actually carrying that bucket -- a re-pin that edits a row's bucket
    # without updating its summary count is exactly the drift this rule
    # exists to catch.
    for bucket in sorted(BUCKET_VALUES):
        if bucket not in totals:
            continue
        count = totals[bucket]
        _require(isinstance(count, int) and not isinstance(count, bool),
                  f"baseline.totals.{bucket} must be an int, got {type(count).__name__}")
        actual = sum(1 for row in rows if row["bucket"] == bucket)
        _require(count == actual,
                  f"baseline.totals.{bucket} ({count}) != rows with bucket=={bucket!r} ({actual})")

    # per_family's bucket counts and totals must reconcile against the actual
    # rows the same way the top-level totals do above -- a mapping-shaped but
    # otherwise unchecked per_family would let a stale or fabricated summary
    # pass silently. Group rows by family the same way acr's merge_corpus.py
    # does (`fam = r.get("family") or BY_ID[...].get("family") or "_none"` --
    # confirmed against the real pinned baseline: the I6-illegal probe row's
    # family=None lands under "_none"), then cross-check every family entry's
    # `total` and any present bucket counts.
    family_rows = {}
    for row in rows:
        family_rows.setdefault(row.get("family") or "_none", []).append(row)

    for fam_key, fam_summary in per_family.items():
        _require(isinstance(fam_summary, dict),
                  f"baseline.per_family[{fam_key!r}] must be a mapping, got {type(fam_summary).__name__}")
        fam_rows = family_rows.get(fam_key, [])
        _require("total" in fam_summary, f"baseline.per_family[{fam_key!r}].total missing")
        fam_total = fam_summary["total"]
        _require(isinstance(fam_total, int) and not isinstance(fam_total, bool),
                  f"baseline.per_family[{fam_key!r}].total must be an int, got {type(fam_total).__name__}")
        _require(fam_total == len(fam_rows),
                  f"baseline.per_family[{fam_key!r}].total ({fam_total}) != "
                  f"rows with family=={fam_key!r} ({len(fam_rows)})")
        for bucket in sorted(BUCKET_VALUES):
            if bucket not in fam_summary:
                continue
            count = fam_summary[bucket]
            _require(isinstance(count, int) and not isinstance(count, bool),
                      f"baseline.per_family[{fam_key!r}].{bucket} must be an int, "
                      f"got {type(count).__name__}")
            actual = sum(1 for row in fam_rows if row["bucket"] == bucket)
            _require(count == actual,
                      f"baseline.per_family[{fam_key!r}].{bucket} ({count}) != "
                      f"rows with family=={fam_key!r} and bucket=={bucket!r} ({actual})")

    _require(set(family_rows) <= set(per_family),
              "family/families with rows but no baseline.per_family entry at all: "
              f"{sorted(set(family_rows) - set(per_family))}")

    return len(rows), len(only_in_baseline)


def _validate_baseline():
    """Shape + sha256 pin for corpus/baseline-20260905-sweep1.json. See
    `_validate_baseline_doc` for the shape/cross-check rules themselves."""
    raw = BASELINE_PATH.read_bytes()
    got_sha = hashlib.sha256(raw).hexdigest()
    _require(got_sha == BASELINE_SHA256,
              f"baseline sha256 mismatch: got {got_sha}, pinned {BASELINE_SHA256} "
              "-- update BASELINE_SHA256 here AND corpus/README.md's sha chain together, "
              "deliberately, if this edit is real")

    doc = json.loads(raw)
    corpus_ids = {row["id"] for row in corpus_module.CORPUS}
    return _validate_baseline_doc(doc, corpus_ids)


def _base_baseline_fixture():
    """Canonical two-row baseline doc + its matching corpus_ids, used as
    the GREEN starting point every RED control in
    `_self_test_baseline_guard_fires` mutates exactly one field of."""
    doc = {
        "ticket": "TEST-FIXTURE",
        "provenance": {},
        "per_family": {
            "f1": {"served_with_data": 1, "total": 1},
            "_none": {"error": 1, "total": 1},
        },
        "totals": {
            "served_with_data": 1, "served_degraded": 0, "unserved": 0,
            "clarification_needed": 0, "error": 1, "total": 2,
        },
        "rows": [
            {"corpus_id": "r1", "bucket": "served_with_data", "family": "f1"},
            {"corpus_id": "r2", "bucket": "error", "family": None},
        ],
    }
    corpus_ids = {"r1", "r2"}
    return doc, corpus_ids


def _self_test_baseline_guard_fires():
    """RED CONTROLs: prove `_validate_baseline_doc` actually rejects a
    re-pinned baseline carrying a duplicate row id, a bucket value outside
    the known vocabulary, or totals that no longer match the actual rows
    (CHAOS-5599) -- and that the canonical shape is still accepted. Same
    discipline as `_self_test_guard_fires` above: a check never exercised
    against a failing case is unproven."""
    base_doc, base_ids = _base_baseline_fixture()

    def mutated(mutate):
        doc = copy.deepcopy(base_doc)
        mutate(doc)
        return doc

    cases = [
        # duplicate corpus_id: canonical vs duplicate vs re-pinned canonical
        (mutated(lambda d: d["rows"].__setitem__(
            1, {"corpus_id": "r1", "bucket": "error", "family": None})),
         "duplicate corpus_id"),
        # bucket: out of vocabulary / wrong scalar type / empty / null / absent
        (mutated(lambda d: d["rows"][0].__setitem__("bucket", "not_a_real_bucket")),
         "bucket must be one of"),
        (mutated(lambda d: d["rows"][0].__setitem__("bucket", 1)),
         "bucket"),
        (mutated(lambda d: d["rows"][0].__setitem__("bucket", "")),
         "bucket"),
        (mutated(lambda d: d["rows"][0].__setitem__("bucket", None)),
         "bucket"),
        (mutated(lambda d: d["rows"][0].pop("bucket")),
         "bucket"),
        # totals-vs-rows agreement: per-bucket count off by one (both directions),
        # wrong scalar type, and the pre-existing total-vs-len(rows) check
        (mutated(lambda d: d["totals"].__setitem__("served_with_data", 2)),
         "totals.served_with_data"),
        (mutated(lambda d: d["totals"].__setitem__("error", 0)),
         "totals.error"),
        (mutated(lambda d: d["totals"].__setitem__("error", "1")),
         "totals.error must be an int"),
        (mutated(lambda d: d["totals"].__setitem__("total", 3)),
         "totals.total"),
        # per_family-vs-rows agreement: a stale/fabricated per_family summary
        # must be caught the same way top-level totals are.
        (mutated(lambda d: d["per_family"]["f1"].__setitem__("total", 999)),
         "per_family['f1'].total"),
        (mutated(lambda d: d["per_family"]["f1"].__setitem__("served_with_data", 0)),
         "per_family['f1'].served_with_data"),
        (mutated(lambda d: d["per_family"]["f1"].__setitem__("total", "1")),
         "per_family['f1'].total must be an int"),
        (mutated(lambda d: d["per_family"].__setitem__("f1", "not-a-mapping")),
         "per_family['f1'] must be a mapping"),
        (mutated(lambda d: d["per_family"].pop("_none")),
         "family/families with rows but no baseline.per_family entry"),
    ]
    for bad_doc, must_mention in cases:
        # Catching the RED control's own synthesized "accepted" failure in the
        # same except block that checks the REJECTION reason lets the
        # accept-message (which quotes the whole bad_doc, and so can itself
        # contain the word being searched for, e.g. "bucket") satisfy
        # `must_mention` even though the guard being tested never actually
        # fired. Two independent assertions close this -- same discipline as
        # `_self_test_guard_fires` above, which never shares one try/except
        # between "was it accepted" and "why was it rejected."
        accepted = False
        reason = None
        try:
            _validate_baseline_doc(bad_doc, base_ids)
            accepted = True
        except CorpusValidationError as exc:
            reason = str(exc)
        _require(not accepted, f"RED CONTROL FAILED: baseline doc accepted: {bad_doc!r}")
        _require(must_mention in reason,
                  f"RED CONTROL FAILED: baseline doc rejected for the wrong reason: {reason}")

    # GREEN control: the canonical fixture, and a canonical baseline that
    # legitimately drops a corpus row (rows_deleted_since_by_lane_corpus_cleanup).
    ok_doc, ok_ids = _base_baseline_fixture()
    n_rows, n_dropped = _validate_baseline_doc(ok_doc, ok_ids)
    _require((n_rows, n_dropped) == (2, 0),
              f"GREEN CONTROL FAILED: canonical baseline rejected or miscounted: {(n_rows, n_dropped)!r}")

    shrunk_doc, _ = _base_baseline_fixture()
    n_rows, n_dropped = _validate_baseline_doc(shrunk_doc, {"r1"})
    _require((n_rows, n_dropped) == (2, 1),
              f"GREEN CONTROL FAILED: baseline row (r2) since removed from the corpus "
              f"wrongly rejected or miscounted: {(n_rows, n_dropped)!r}")


# CHAOS-5610: the exact `expect` value of each of the 12 CHAOS-5597
# refuse/decline rows, pinned -- previously only their shape/type
# (validate_corpus_row) was checked, never the actual value. Row
# *expectations* remain chris's data-semantics call (corpus/README.md
# "## Ownership"); this pin catches a silent edit to any of the 12, it
# does not judge whether any value is correct -- a pin that fails is
# reported, never "fixed" by updating the pin to match.
PINNED_REFUSE_DECLINE_EXPECT = {
    "pos-grouped-per-phrasing": "refuse",
    "basis-discovered-repo-count": "refuse",
    "basis-grouped-pr-by-project": "refuse",
    "basis-grouped-deployment-by-team": "refuse",
    "basis-discovered-incidents": "refuse",
    "basis-scoped-workitems-by-project": "refuse",
    "basis-discovered-documents": "refuse",
    "basis-grouped-metric-by-repo": "refuse",
    "neg-nonexistent-team": "decline",
    "neg-nonexistent-project": "decline",
    "neg-nonexistent-repo-scope": "decline",
    "neg-illegal-i6-self-group": "decline",
}

# D24: a second tranche of refuse/decline rows, drafted from the 2026-09-12
# main-b6579178 yardstick and chris-approved alongside the rest of D24's
# scalar/any_of expect values. Kept as its OWN named dict rather than merged
# into CHAOS-5597's 12 above so each pin's own origin/history stays legible --
# CHAOS-5597 is the first tranche, D24 the second, and drift between either
# tranche and the rest of the corpus is still caught (see the reverse check).
PINNED_D24_REFUSE_DECLINE_EXPECT = {
    "cv-c3-grouped-explain-change": "refuse",
    "cv-b5-org-health": "refuse",
    "cv-org-count-projects": "refuse",
    "neg-open-question": "decline",
    "neg-open-vague": "decline",
}


def _check_pinned_refuse_decline_expect(corpus):
    by_id = {row["id"]: row for row in corpus}
    all_pinned = {**PINNED_REFUSE_DECLINE_EXPECT, **PINNED_D24_REFUSE_DECLINE_EXPECT}
    for row_id, want in all_pinned.items():
        origin = "CHAOS-5597" if row_id in PINNED_REFUSE_DECLINE_EXPECT else "D24"
        _require(row_id in by_id,
                  f"pinned row {row_id!r} ({origin}) no longer exists in CORPUS")
        got = by_id[row_id].get("expect")
        _require(got == want,
                  f"CORPUS[{row_id!r}].expect changed: pinned {want!r}, got {got!r} -- "
                  "row expectations are chris's call (corpus/README.md ## Ownership); "
                  "report this, do not silently update the pin")
    # Reverse direction: no OTHER row has drifted INTO refuse/decline, and none of
    # the pinned rows has drifted OUT to some other expect value not listed above --
    # either would mean the pinned set has silently changed size.
    actual = {row["id"] for row in corpus if row.get("expect") in ("refuse", "decline")}
    pinned = set(all_pinned)
    _require(actual == pinned,
              "refuse/decline row set changed since CHAOS-5597/D24: "
              f"added={sorted(actual - pinned)}, removed={sorted(pinned - actual)}")


def _self_test_pin_guard_fires():
    """RED CONTROLs: prove `_check_pinned_refuse_decline_expect` actually
    rejects a drifted pin -- a changed value, a pinned row deleted
    outright, and a row drifting into (or out of) the refuse/decline set
    without being added to (or removed from) the pin -- and that the
    canonical shape (both the CHAOS-5597 12 and the D24 5) is still
    accepted (CHAOS-5610, CHAOS-D24)."""
    canonical = [{"id": row_id, "expect": expect}
                 for row_id, expect in {**PINNED_REFUSE_DECLINE_EXPECT,
                                         **PINNED_D24_REFUSE_DECLINE_EXPECT}.items()]

    def mutated(mutate):
        corpus = copy.deepcopy(canonical)
        mutate(corpus)
        return corpus

    cases = [
        (mutated(lambda c: c[0].__setitem__("expect", "decline")), "expect changed"),
        (mutated(lambda c: c[0].__setitem__("expect", None)), "expect changed"),
        (mutated(lambda c: c.pop(0)), "no longer exists"),
        (mutated(lambda c: c.append({"id": "drifted-in", "expect": "refuse"})),
         "refuse/decline row set changed"),
    ]
    for bad_corpus, must_mention in cases:
        # Catching the RED control's own synthesized "accepted" failure in the
        # same except block that checks the REJECTION reason lets the
        # accept-message (which quotes the whole rejected corpus, and so can
        # itself contain the word being searched for) satisfy `must_mention`
        # even though the guard being tested never actually fired. Two
        # independent assertions close this -- same discipline as
        # `_self_test_guard_fires` and `_self_test_baseline_guard_fires`
        # above, neither of which shares one try/except between "was it
        # accepted" and "why was it rejected."
        accepted = False
        reason = None
        try:
            _check_pinned_refuse_decline_expect(bad_corpus)
            accepted = True
        except CorpusValidationError as exc:
            reason = str(exc)
        _require(not accepted, f"RED CONTROL FAILED: drifted pin accepted: {bad_corpus!r}")
        _require(must_mention in reason,
                  f"RED CONTROL FAILED: drifted pin rejected for the wrong reason: {reason}")

    # RED control for the masking bug the split above fixes (CHAOS-5651): a
    # stub that WRONGLY accepts, whose argument's repr contains the exact word
    # `must_mention` would be searched for, must still be reported as
    # "accepted" -- never silently pass because its own accept-message
    # happens to contain that word. `stub_bad_corpus`'s repr contains "id"
    # (every row has an "id" key) on purpose, and the stub itself never
    # raises, standing in for a validator whose guard has regressed to a
    # no-op.
    def _stub_wrongly_accepts(_corpus):
        return None

    stub_bad_corpus = [{"id": "x", "expect": "id"}]
    stub_accepted = False
    try:
        _stub_wrongly_accepts(stub_bad_corpus)
        stub_accepted = True
    except CorpusValidationError:
        pass
    masking_control_fired = False
    try:
        _require(not stub_accepted,
                  f"RED CONTROL FAILED: drifted pin accepted: {stub_bad_corpus!r}")
    except CorpusValidationError as caught:
        masking_control_fired = True
        _require("accepted" in str(caught),
                  f"masking-bug RED control raised for the wrong reason: {caught}")
    _require(masking_control_fired,
              "masking-bug RED control did not fire: a wrongly-accepting stub must be caught "
              "by the accepted-check, never let its own accept-message satisfy a later "
              "reason-check")

    # GREEN control: the canonical 12, untouched.
    _check_pinned_refuse_decline_expect(copy.deepcopy(canonical))


# D24: every corpus row must now declare an `expect` except the two named
# below, which are intentionally left unset -- both hit an unresolved 5-turn
# clarification loop with no served text at all on the 2026-09-12 yardstick
# of record (CHAOS-5660), not a stable target to pin against yet. This pin
# exists so a future row added without an expect (or a future fix to one of
# these two that should get an expect) is caught explicitly, not silently.
UNSCORED_BY_DESIGN = frozenset({"neg-single-subject-why", "cv-named-project-completion"})


def _check_every_row_scored_except_named(corpus):
    unscored = {row["id"] for row in corpus if row.get("expect") is None}
    missing = unscored - UNSCORED_BY_DESIGN
    _require(not missing,
              f"row(s) with no expect and not in UNSCORED_BY_DESIGN: {sorted(missing)}")
    stale = UNSCORED_BY_DESIGN - unscored
    _require(not stale,
              f"UNSCORED_BY_DESIGN name(s) that now HAVE an expect (stale exemption, "
              f"remove from UNSCORED_BY_DESIGN): {sorted(stale)}")


def _self_test_every_row_scored_guard_fires():
    """RED CONTROLs: prove `_check_every_row_scored_except_named` actually
    rejects an unscored row outside the named exemption set, and a stale
    exemption (a named row that now has an expect) -- and that the real
    shape (exactly the two named rows unscored, everything else scored) is
    accepted."""
    base = [
        {"id": "neg-single-subject-why", "expect": None},
        {"id": "cv-named-project-completion", "expect": None},
        {"id": "qa-grouped-clean", "expect": "serve"},
    ]

    def mutated(mutate):
        corpus = copy.deepcopy(base)
        mutate(corpus)
        return corpus

    cases = [
        (mutated(lambda c: c.append({"id": "some-new-row", "expect": None})),
         "row(s) with no expect and not in UNSCORED_BY_DESIGN"),
        (mutated(lambda c: c[0].__setitem__("expect", "serve")),
         "stale exemption"),
    ]
    for bad_corpus, must_mention in cases:
        accepted = False
        reason = None
        try:
            _check_every_row_scored_except_named(bad_corpus)
            accepted = True
        except CorpusValidationError as exc:
            reason = str(exc)
        _require(not accepted, f"RED CONTROL FAILED: unscored-pin accepted: {bad_corpus!r}")
        _require(must_mention in reason,
                  f"RED CONTROL FAILED: unscored-pin rejected for the wrong reason: {reason}")

    # GREEN control: the canonical shape.
    _check_every_row_scored_except_named(copy.deepcopy(base))


def main():
    _self_test_guard_fires()
    _self_test_baseline_guard_fires()
    _self_test_pin_guard_fires()

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

    _check_pinned_refuse_decline_expect(corpus)
    _self_test_every_row_scored_guard_fires()
    _check_every_row_scored_except_named(corpus)

    baseline_rows, dropped = _validate_baseline()

    print(f"PASS: {len(corpus)} corpus rows validated")
    print(f"PASS: {len(PINNED_REFUSE_DECLINE_EXPECT)} CHAOS-5597 + {len(PINNED_D24_REFUSE_DECLINE_EXPECT)} D24 "
          "refuse/decline expect values pinned and matched")
    print(f"PASS: every corpus row scored except {sorted(UNSCORED_BY_DESIGN)} (CHAOS-5660)")
    print(f"PASS: baseline sha256 pin matched, {baseline_rows} baseline rows shape-checked "
          f"({dropped} historical-only, not in the current corpus)")


if __name__ == "__main__":
    main()
