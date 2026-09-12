# Corpus of record

`corpus.py` is the corpus of record consumed by acr's `scripts/corpus`
evaluation harness (`harness.py`, `run_shard.py`, `merge_corpus.py`,
`expectations.py`, `validators.py`). It is never committed inside the acr
repo itself (see acr's `scripts/corpus/README.md`); acr's harness scripts
take it as an external module supplied on `sys.path` at run time, pointed
at a checkout of this file. Versioning it here, instead of only as ad hoc
copies in lane scratch, gives every run a fixed, citable sha rather than
"whichever copy someone had lying around."

`baseline-20260905-sweep1.json` is the reference sweep this corpus was
last measured against (2026-09-05), for diffing a new run's classifications
against the prior baseline.

## Versioning

Each landed change to `corpus.py` is its own commit, so `git log --follow
corpus/corpus.py` is the change history and `git show <sha>:corpus/corpus.py`
recovers any prior state exactly. A PR that changes a row's `expect`
(or any other scored field) must say so explicitly in its body — changing
what a row expects moves the pass/fail bar for every future run against
that row, and a report that doesn't name the move risks reading a bar
change as a result improvement or regression.

**Sha chain**: `baseline-20260905-sweep1.json` is pinned by sha256 in
`corpus/test_corpus.py`'s `BASELINE_SHA256` constant, currently
`ab7f8bb0ffda440240a8f60e3b1f07e8c86ed42b9ab740bedfdcdc3f5964b1dd`. CI fails
if the file's actual sha256 stops matching that constant, so a landed
baseline replacement must update both the file and `BASELINE_SHA256` in the
same commit — that pairing is the deliberate-edit signal; anything else is
an unintended change.

## Ownership

Row _expectations_ (`expect`, `basis`, `anchor`, `nonexistent`) are data
semantics, not code: what a given question should score as is chris's
call, not an engineering judgment made in the PR that happens to touch this
file. `corpus/test_corpus.py` only enforces the shape acr's harness
requires (see that file and acr's `scripts/corpus/validators.py:129-157`
for the validated rule set) — it never enforces or infers what any row's
correct `expect` value should be. This applies identically to the `any_of`
form below: which alternatives a row accepts is still chris's call.

## Expectation declaration (CHAOS-5620)

`expect` supports two shapes:

- **Scalar** (unchanged): one of `serve`/`refuse`/`decline`/`clarify`, or
  `None`/absent for an unscored row.
- **Explicit disjunction**: `expect = {"any_of": [branch, ...]}`. Each
  branch is a complete accepted alternative — an `outcome` from the same
  vocabulary, plus (for `outcome: "serve"`) `answer: {"family": <token>}`
  naming which family the served answer must match. Conditions _within_ a
  branch are ANDed; branches are ORed by `any_of`. A row with `any_of`
  declares `basis` on each alternative that needs one, never at the row
  level (avoids an ambiguous "which alternative does this basis belong
  to?"). `anchor`/`nonexistent` stay row-level constraints applying to
  every alternative.

The vocabulary and shape live in `corpus/expect_schema.py` (`FAMILIES`,
`EXPECT_VALUES`, `SCHEMA_VERSION`, `parse_expect`). `corpus/test_corpus.py`
delegates its `expect` shape check to that module, so scalar and `any_of`
rows are validated by one rule, not two.

`corpus/semantic_verdict.py` adds the **versioned semantic verdict**,
published beside the five existing buckets without changing them: it
combines an `any_of` row's branch results (a complete matching branch can
pass; an undecidable branch can never manufacture one), and it audits a
two-turn window-clarification exchange to tell apart the row's declared
target, the engine's proposed interpretation, and what a verified caller
action actually accepted — matching the declared family, or repeating
turn-1's family, does neither. It does not re-implement acr's scalar leaf
scoring table (`COHERENCE`/`VERDICTS` in acr `scripts/corpus/expectations.py`);
that table is supplied by the caller (an injected `legacy_score`), the same
boundary `test_corpus.py` already draws around acr's real ingestion
validator. See `corpus/semantic_verdict.py`'s module docstring and
`docs/chaos-5620-semantic-verdict.md` for the full design and its proposed
(not applied) corpus diff.

No row in this corpus was changed to `any_of` by this change; `expect`
values remain chris's to set, same as any other row edit (see "## Versioning"
above).
