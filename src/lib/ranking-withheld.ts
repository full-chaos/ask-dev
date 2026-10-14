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
 * marker (`ranking_withheld`) that panels read; it is never silent.
 *
 * Service prose (`deterministic_answer`, ...) is producer-owned and is not
 * rewritten here.
 */
import { isRankableSubjectKind } from "@/lib/cohort-ranking";
import type { InvestigationResult } from "@/lib/contracts";

export type RankingWithheld = {
    readonly reason: "subject_kind_not_ranked";
    /** How many cohort members were withheld with the cohort. */
    readonly members_affected: number;
};

export type WithheldAwareResult = InvestigationResult & {
    readonly ranking_withheld?: RankingWithheld;
};

/** The marker a result carries, or `undefined` when nothing was withheld. */
export function rankingWithheldOf(result: InvestigationResult): RankingWithheld | undefined {
    return (result as WithheldAwareResult).ranking_withheld;
}

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
 * refusal/correction/semantic-reading notices. The answer prose
 * (`deterministic_answer`, `direct_judgment`, `current_state`) is
 * producer-owned and is not rewritten here.
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
    "direct_judgment",
    "current_state",
    "limitations",
    "limitations_displaced",
    "coverage",
    "versions",
    "deterministic_answer",
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
 * the `ranking_withheld` marker. Idempotent.
 */
export function withholdUnrankableRankings(result: InvestigationResult): WithheldAwareResult {
    const cohort = result.cohort;
    if (cohort === undefined) return result;
    const rankable =
        isRankableSubjectKind(cohort.kind) &&
        cohort.members.every((member) => isRankableSubjectKind(member.subject.kind));
    if (rankable) return result;
    const source = result as unknown as Record<string, unknown>;
    const built: Record<string, unknown> = {};
    for (const field of RESULT_FIELDS_KEPT) {
        if (source[field] !== undefined) built[field] = source[field];
    }
    for (const field of RESULT_FIELDS_DROPPED_TO_EMPTY) built[field] = [];
    built.ranking_withheld = {
        reason: "subject_kind_not_ranked",
        members_affected:
            cohort.members.length + (rankingWithheldOf(result)?.members_affected ?? 0),
    } satisfies RankingWithheld;
    return built as unknown as WithheldAwareResult;
}
