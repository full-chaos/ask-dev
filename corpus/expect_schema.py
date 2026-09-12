#!/usr/bin/env python3
"""CHAOS-5620: the `expect` declaration's vocabulary and shape.

Two shapes are legal for a row's `expect` field:

  * a SCALAR string (unchanged): one of EXPECT_VALUES, or None/absent for an
    unscored row. This is the corpus's shape since before this change and its
    semantics do not move here -- see corpus/README.md.
  * an explicit OBJECT disjunction: `{"any_of": [branch, ...]}`. Each branch
    is a complete accepted alternative: an `outcome` (the same closed
    vocabulary as the scalar form) plus, for `outcome == "serve"`, an
    `answer.family` naming which family the served answer must match.
    Conditions *within* a branch are ANDed (there is only one condition
    implemented so far: the family); alternatives are ORed by `any_of`. This
    intentionally excludes an accidental cross-product of independently
    allowed families/outcomes -- accepting two interpretations means
    authoring two complete branches.

This module only decides whether a declaration is WELL-FORMED. It does not
decide whether a served answer satisfies one -- see semantic_verdict.py for
that. An invalid alternative must never be silently ignored while a sibling
branch happens to be well-formed: `parse_expect` rejects the whole
declaration atomically, so a malformed branch cannot hide behind a valid one.

FAMILIES mirrors acr's closed Go vocabulary
(internal/contracts/v1/context_fabric_answer_plan.go,
ContextFabricQuestionFamily / contextFabricQuestionFamilies). Hand-kept in
sync for the same reason corpus/test_corpus.py hand-mirrors acr's
validators.py: no acr checkout is available in ask-dev CI, so there is no
shared import to pin against.
"""

SERVE, REFUSE, DECLINE, CLARIFY = "serve", "refuse", "decline", "clarify"

# The scalar `expect` vocabulary. Single source of truth: test_corpus.py
# imports this rather than re-spelling it, so the two can never drift.
EXPECT_VALUES = frozenset({SERVE, REFUSE, DECLINE, CLARIFY})

# Mirrors acr internal/contracts/v1/context_fabric_answer_plan.go's
# contextFabricQuestionFamilies, 8 tokens, at pin 89efc1f96bbd15135bef5dfaf8fd7ccdab54fa13.
FAMILIES = frozenset(
    {
        "subject_investigation",
        "discovered_cohort_ranking",
        "scoped_cohort_status",
        "grouped_cohort_status",
        "explicit_comparison",
        "trend",
        "investment_allocation",
        "unclassified",
    }
)

# Bump on any change to branch shape, vocabulary, or validation rule below --
# a published semantic verdict record carries this so a rescore under a
# changed schema is never silently compared to one scored under the old
# schema (see corpus/README.md "## Versioning").
SCHEMA_VERSION = "chaos-5620-any_of-v1"

_BRANCH_KEYS = frozenset({"outcome", "basis", "answer"})


def parse_expect(expect):
    """(ok, reason, branches) for a row's raw `expect` field.

    `branches` is `None` for the scalar/absent form (the legacy path applies
    unchanged); otherwise it is the validated list of branch dicts from
    `any_of`, in declaration order.

    Every rejection reason is a `str` prefixed the same way callers already
    expect from acr's ingestion boundary (`"expect must be ..."` /
    `"any_of ..."` / `"alternative ..."`), so a message can be surfaced
    directly without re-wrapping.
    """
    if expect is None:
        return True, None, None
    if isinstance(expect, str):
        if expect not in EXPECT_VALUES:
            return False, f"expect must be one of {sorted(EXPECT_VALUES)} or None, got {expect!r}", None
        return True, None, None
    if not isinstance(expect, dict):
        return False, f"expect must be a string, an any_of object, or None, got {type(expect).__name__}", None

    if set(expect) != {"any_of"}:
        return False, "expect object requires exactly one key, any_of", None
    choices = expect["any_of"]
    if not isinstance(choices, list) or not choices:
        return False, "any_of must be a nonempty list", None

    seen = []
    for index, branch in enumerate(choices):
        if not isinstance(branch, dict):
            return False, f"alternative {index} is not a mapping", None
        extra = set(branch) - _BRANCH_KEYS
        if extra:
            return False, f"alternative {index} has unsupported keys {sorted(extra)}", None
        outcome = branch.get("outcome")
        if not isinstance(outcome, str) or outcome not in EXPECT_VALUES:
            return False, f"alternative {index}.outcome must be one of {sorted(EXPECT_VALUES)}", None
        basis = branch.get("basis")
        if basis is not None and not isinstance(basis, str):
            return False, f"alternative {index}.basis must be a string or None", None
        answer = branch.get("answer")
        if outcome == SERVE:
            if not isinstance(answer, dict) or set(answer) != {"family"}:
                return False, f"alternative {index} (serve) requires answer={{'family': ...}}", None
            family = answer["family"]
            if not isinstance(family, str) or family not in FAMILIES:
                return False, f"alternative {index}.answer.family must be one of {sorted(FAMILIES)}", None
        elif answer is not None:
            return False, f"alternative {index}.answer only applies to outcome=serve", None
        if branch in seen:
            return False, f"alternative {index} duplicates an earlier alternative", None
        seen.append(branch)

    return True, None, choices
