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

## Ownership

Row _expectations_ (`expect`, `basis`, `anchor`, `nonexistent`) are data
semantics, not code: what a given question should score as is chris's
call, not an engineering judgment made in the PR that happens to touch this
file. `corpus/test_corpus.py` only enforces the shape acr's harness
requires (see that file and acr's `scripts/corpus/validators.py:129-157`
for the validated rule set) — it never enforces or infers what any row's
correct `expect` value should be.
