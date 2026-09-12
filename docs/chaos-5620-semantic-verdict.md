# CHAOS-5620: versioned semantic verdict — design summary and proposed corpus diff

Ticket: CHAOS-5620 (parent CHAOS-4452; CHAOS-5597's machine-readable-expect
item folds in). Design of record: the astra corpus-semantics-design review
(2026-09-12), adopted by chris the same day.

This document is the reviewed, **not applied**, corpus-diff artefact rule 4
of the build brief requires: it proposes candidate `expect` values for
specific rows, for chris to accept, reject, or amend. Nothing here changes
`corpus/corpus.py`. It also carries the wire/contract follow-up this PR
deliberately does not implement.

## What shipped in this PR

- `scripts/validate_json_schema.mjs` — a small node shim around the SAME
  ajv setup `src/lib/acr/validate.ts` already uses in product code (no new
  dependency). Validates a payload against any `$def` in the pinned
  contract schemas, or against `corpus/schemas/` (this repo's own
  invented shapes). Every window/confirmation/`expect` shape below is
  validated through it, not by a hand-rolled Python `isinstance` chain —
  r2 review found hand-rolled checks miss cells a real JSON Schema
  validator gets right by construction (a `relative_id: null` offer
  silently treated as legal, a `null` `applied_value` compared for
  equality without checking its type, `sorted()` crashing on a
  non-string dict key).
- `corpus/schemas/expect.schema.json` — this repo's own schema for the
  `expect` declaration (scalar or `any_of`); its `answer.family` reaches
  into the real pinned contract via `$ref` for the family vocabulary,
  rather than re-declaring it.
- `corpus/expect_schema.py` — `parse_expect` now delegates shape
  validation to that schema. `FAMILIES` is read directly from the pinned
  contract schema at import time (not hand-copied), so it cannot drift.
- `corpus/semantic_verdict.py` — the family/window audit and branch
  combination machinery, versioned (`SCORER_VERSION`, `POLICY_VERSION`,
  `expect_schema.SCHEMA_VERSION`, and a REQUIRED `legacy_scorer_version`
  naming whichever scalar scorer was injected). Every offer, the
  effective-evidence-window, and every confirmed-structure entry is
  validated against the pinned contract's own `WindowOption`/
  `EffectiveEvidenceWindow`/`ConfirmedStructureEntry` shapes before this
  module reasons about it. Every field it consumes fails closed (never
  raises) on absent/null/wrong-type/malformed input.
- `corpus/test_corpus.py` widened to accept both `expect` shapes.
- `corpus/test_semantic_verdict_smoke.py` runs the machinery over every
  real `corpus.CORPUS` row (scalar, and a synthetic `any_of` variant of
  each) — the in-repo caller exercising this machinery end to end (see
  RISK-NOTES on the acr-side wiring boundary, CHAOS-5625).
  `corpus/test_semantic_verdict_proof.py` replays vendored REAL recorded
  exchanges (`corpus/testdata/cv-discovered-team-series-nine-reps/`)
  through the audit and asserts the exact published family/window
  figures, and actively re-verifies each vendored file's pinned sha256.
  `corpus/test_schema_driven_shapes.py` GENERATES its legal/illegal
  tables from the pinned schema's own `required` fields (one hand-authored
  seed per legal branch, then every required field mutated to
  absent/null, mechanically) and uses ajv itself as the pass/fail oracle
  — never a hand-declared expectation. All four run in `pnpm test:corpus`
  / CI.
- No row's `expect`, `basis`, `anchor`, or `nonexistent` value changed.
  `neg-illegal-i6-self-group` stays scalar `decline` (chris D20 = A).

## Scope boundary: this PR's caller vs. the corpus RUNNER (CHAOS-5625)

This PR's machinery has an IN-REPO caller: `corpus/test_semantic_verdict_smoke.py`
and `corpus/test_semantic_verdict_proof.py` run it, in CI, against every
real corpus row and against real vendored recorded exchanges. What it does
NOT have is a PRODUCTION caller, because the corpus RUNNER — the thing
that actually scores a live sweep and publishes bucket totals — is acr's
`scripts/corpus/harness.py`/`merge_corpus.py`, not anything in this
repository (ask-dev has never had a corpus scorer of its own; see
`corpus/README.md` "## Ownership"). Publishing this semantic verdict
beside acr's own bucket totals and PROVENANCE, consuming this PR's
`corpus/expect_schema.py`/`semantic_verdict.py` at the landed ask-dev pin,
is a separate, acr-side follow-up PR by this lane after this one lands —
proposed parent ticket CHAOS-5625. This PR does not implement that wiring
and does not claim to.

## The three distinctions this verdict keeps separate

| Concept                 | Authority                                                | What it proves                         |
| ----------------------- | -------------------------------------------------------- | -------------------------------------- |
| Declared answer target  | Corpus owner (chris)                                     | The authored semantic oracle for a row |
| Proposed interpretation | Model/plan, with source and version                      | What the engine picked at a given turn |
| Accepted question state | A verified caller action, or a previously accepted state | What the action actually confirmed     |

Matching the declared family, or repeating turn-1's family, satisfies
neither of the last two. A same-family answer that silently changes an
obligation, cohort scope, or comparison basis is not caught by this
verdict either — it is a known, documented limitation, not a false green.

## Proof executed against this PR's machinery

The nine `cv-discovered-team-series` reps at `760014f7` are vendored as
committed fixture data (`corpus/testdata/cv-discovered-team-series-nine-reps/`)
and replayed by `corpus/test_semantic_verdict_proof.py`, part of `pnpm
test:corpus` / CI: `family_relation` changed=3/same=6; `window_binding`
verified=9; `family_confirmation` unavailable=9 — the row has no `expect`
today, so this is an evidence-availability count, not a corpus score. This
needs no acr checkout: the audit reads only the recorded exchange.

The OTHER proof — that `build_verdict()` is a byte-exact no-op over acr's
real legacy scalar verdict for the full 36-row pinned baseline
(`~/.cache/acr-kiac-askdev/proofs/2026-09-11-main-89efc1f9/`) — genuinely
needs acr's real scorer, which ask-dev CI does not have (see
`corpus/README.md`). See the PR body's TEST-EVIDENCE for that executed,
uncommitted replay's output.

## Proposed corpus diff (NOT applied — chris's call)

One candidate, illustrating the shape on the row the proof above already
measured. `cv-discovered-team-series` ("How has each team's health trended
over the last two quarters?") currently has no `expect` and is unscored on
every run. A minimal declaration, matching its authored `family` label:

```python
dict(id="cv-discovered-team-series", text="How has each team's health trended over the last two quarters?",
     family="discovered_cohort_ranking", variant="discovered_kind", member_kind="team", group_kind=None,
     note="SERVABLE; goal=describe_trend; temporal=time_series",
     expect={"any_of": [{"outcome": "serve", "answer": {"family": "discovered_cohort_ranking"}}]})
```

Under this PR's machinery, that declaration would score `unscored` /
`family_confirmation_unavailable` on every rep in the nine-rep evidence
(a verified window receipt plus a matching family is not manufactured
confirmation), and `unscored` / `unratified_family_change` on the three
reps where the family changed after clarification — it would NOT flip
those three to `disagree`. Whether that is the right bar for this row, or
whether a second alternative (e.g. also accepting
`grouped_cohort_status` if chris judges "trended" as answerable either
way) belongs here, is chris's decision, not this PR's.

No other row is proposed for a diff in this PR; the corpus stays
byte-identical.

## RISK-NOTES: follow-up ticket proposal (not implemented here)

The current wire (`internal/contracts/v1`) has no producer-authored link
naming which prior offer/result a caller action accepted for FAMILY
specifically (window acceptance already has one: `confirmed_structure`
entries with `member: "window"`). Building a positive family-confirmation
path — so a served answer's family can be verified as CALLER-accepted,
not merely engine-picked or engine-repeated — needs:

1. A contract-owner decision on whether an acceptance link belongs on the
   wire (`internal/contracts/v1`, examples, validator) or is retrofittable
   from a harness-side sidecar store (requests/offers/hashes, no wire
   change, but also no producer authority beyond what the exchange already
   exposed).
2. If the wire changes: schema + examples + validator work in acr, and the
   ask-dev consumer pin bump + `scripts/sync-acr-contracts.mjs` re-generation,
   before any live proof.
3. A product/data decision on whether corpus-oracle agreement (family
   matches the declared target, changes explicitly authorized) suffices as
   the "questions served" standard, independent of a caller-acceptance
   receipt — this PR's `family_confirmation_unavailable` ceiling holds
   until that decision is made either way.

This PR proposes CHAOS-5620 as the parent for a follow-up ticket covering
item 1–2 above; it does not open or size that ticket itself.
