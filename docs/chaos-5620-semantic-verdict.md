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

- `corpus/expect_schema.py` — the `any_of` vocabulary and shape validator.
- `corpus/semantic_verdict.py` — the family/window audit and branch
  combination machinery, versioned (`SCORER_VERSION`, `POLICY_VERSION`,
  `expect_schema.SCHEMA_VERSION`).
- `corpus/test_corpus.py` widened to accept both `expect` shapes.
- No row's `expect`, `basis`, `anchor`, or `nonexistent` value changed.
  `neg-illegal-i6-self-group` stays scalar `decline` (chris D20 = A).

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

See the PR body's TEST-EVIDENCE for the executed replay against:

- `~/.cache/acr-kiac-askdev/proofs/2026-09-11-main-89efc1f9/` (36-row
  baseline, unchanged buckets).
- The nine `cv-discovered-team-series` reps at `760014f7`
  (`family_relation`: changed=3/same=6; `confirmed_family_verified=0`;
  `unscored=9` under the legacy scalar bar — the row has no `expect`
  today, so this is an evidence-availability count, not a corpus score).

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
