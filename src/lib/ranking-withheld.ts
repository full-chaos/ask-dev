/**
 * The ONE boundary where unrankable cohort rankings leave a result.
 *
 * AGENTS.md: no person-to-person rankings. `Cohort.kind` and member
 * `SubjectRef.kind` are open vocabularies; a kind off `RANKABLE_SUBJECT_KINDS`
 * (including `person`) must never surface a rank, score or ranking driver in
 * ANY view. Gating each component separately leaves every new consumer a way
 * to leak, so the removal happens once, where a result enters client state
 * (route response, then `fireInvestigation`), and every later consumer reads
 * the withheld form by construction. The removal is recorded in a typed
 * marker (`rankingWithheld`, beside the result) that panels read; it is never silent.
 *
 * Service prose (`deterministic_answer`, `direct_judgment`, `current_state`) is replaced here too
 * (lead's ruling on CHAOS-12429, which supersedes the note from CHAOS-9616): no person ranking is a
 * platform hard rule, prose can name and score a member, and a render cannot parse names out of it.
 * The service serves no person ranks, so this is reachable only by a contract break. Determinism
 * here is a safety property, which CHAOS-4690 allows. A kind ON the list keeps its prose:
 * organization and pull-request cohorts do not reach this path.
 */
import { isRankableSubjectKind } from "./cohort-ranking";
import type { InvestigationResult } from "./contracts";

export type RankingWithheld = {
    readonly reason: "subject_kind_not_ranked";
    /** How many cohort members were withheld with the cohort. */
    readonly members_affected: number;
};

/**
 * What the boundary returns. The marker travels BESIDE the result, never
 * inside it: the pinned result schema is `additionalProperties: false`, so a
 * marker inside would make the withheld result fail its own contract.
 */
export type WithheldBoundary = {
    readonly result: InvestigationResult;
    /** Present exactly when the result was rebuilt from the keep list. */
    readonly rankingWithheld?: RankingWithheld;
};

/**
 * FAIL CLOSED BY ALLOWLIST. A withheld result is BUILT from the keep list
 * below; every other field (cohort, render_shapes, claimed facts, drivers,
 * and any field a future producer adds) is dropped. A new schema property is
 * withheld until someone decides it here; a test walks the pinned result
 * schema and fails on an undecided property, so a pin bump forces the call.
 *
 * Kept fields cannot carry member rank, score, driver weight or
 * member-keyed ranking points: envelope ids, status and completeness,
 * interpretation, coverage/versions/limitations/warnings, subject
 * resolution (candidate offers, no scores), temporal and window fields,
 * refusal/correction/semantic-reading notices.
 */
export const RESULT_FIELDS_KEPT = [
    "schema_version",
    "result_id",
    "request_id",
    "generated_at",
    "status",
    "question",
    "interpretation",
    "subject_resolution",
    "limitations",
    "limitations_displaced",
    "coverage",
    "versions",
    "warnings",
    "reused",
    "temporal",
    "effective_evidence_window",
    "window_clarification",
    "completeness",
    "refusal_basis",
    "status_correction",
    "semantic_reading",
] as const;

/** What a withheld answer says instead of the service's prose. No member, no count. */
export const WITHHELD_ANSWER =
    "This answer is not shown, because it ranks subjects of a kind this view does not rank.";

/**
 * The service's prose fields: required strings, so each is replaced, never dropped. The contract
 * requires a decisive result's answer and judgment to be non-empty; `AnswerPanel` shows one line
 * when they are equal.
 */
export const RESULT_FIELDS_REPLACED = {
    deterministic_answer: WITHHELD_ANSWER,
    direct_judgment: WITHHELD_ANSWER,
    current_state: "",
} as const;

/** Required arrays the contract needs present; withheld to `[]`. */
export const RESULT_FIELDS_DROPPED_TO_EMPTY = [
    "strongest_pressures",
    "drivers",
    "remaining_work",
    "readiness_gaps",
    "paths",
    "conflicts",
    "evidence_ref_ids",
    "claimed_facts",
] as const;

/** Optional fields removed outright (they can name or order members). */
export const RESULT_FIELDS_DROPPED = [
    "answer_plan",
    "cohort",
    "structure_needs",
    "confirmed_structure",
    "structure_offer_snapshot",
    "render_shapes",
    "fact_scope_census",
    "fact_scope_census_omitted",
    "evidence_ref_labels",
] as const;

/**
 * Returns the result unchanged when its cohort (kind and every member subject
 * kind) is rankable; otherwise a result built from the keep list only, plus
 * a typed `rankingWithheld` marker BESIDE it. Idempotent on the result (a
 * second pass changes nothing and returns no marker; keep the first one).
 */
export function withholdUnrankableRankings(result: InvestigationResult): WithheldBoundary {
    const cohort = result.cohort;
    if (cohort === undefined) return { result };
    const rankable =
        isRankableSubjectKind(cohort.kind) &&
        cohort.members.every((member) => isRankableSubjectKind(member.subject.kind));
    if (rankable) return { result };
    const source = result as unknown as Record<string, unknown>;
    const built: Record<string, unknown> = {};
    for (const field of RESULT_FIELDS_KEPT) {
        if (source[field] !== undefined) built[field] = source[field];
    }
    for (const field of RESULT_FIELDS_DROPPED_TO_EMPTY) built[field] = [];
    Object.assign(built, RESULT_FIELDS_REPLACED);
    return {
        result: built as unknown as InvestigationResult,
        rankingWithheld: {
            reason: "subject_kind_not_ranked",
            members_affected: cohort.members.length,
        },
    };
}
