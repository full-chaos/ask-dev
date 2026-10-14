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
import type { CohortMember, InvestigationResult } from "@/lib/contracts";

export type RankingWithheld = {
    readonly reason: "subject_kind_not_ranked";
    /** How many members had rank, score or drivers removed. */
    readonly members_affected: number;
};

export type WithheldAwareResult = InvestigationResult & {
    readonly ranking_withheld?: RankingWithheld;
};

/** The marker a result carries, or `undefined` when nothing was withheld. */
export function rankingWithheldOf(result: InvestigationResult): RankingWithheld | undefined {
    return (result as WithheldAwareResult).ranking_withheld;
}

const RANKING_FIELDS = [
    "attention_rank",
    "score",
    "drivers",
    "ranking_basis",
    "ranking_computed",
] as const;

function hasRankingFields(member: CohortMember): boolean {
    const record = member as Record<string, unknown>;
    return RANKING_FIELDS.some((field) => record[field] !== undefined);
}

function stripped(member: CohortMember): CohortMember {
    const copy: Record<string, unknown> = { ...member };
    for (const field of RANKING_FIELDS) delete copy[field];
    return copy as CohortMember;
}

/**
 * Returns the result unchanged when its cohort (kind and every member subject
 * kind) is rankable; otherwise a copy whose members carry no rank, score,
 * ranking basis or drivers, plus the `ranking_withheld` marker. Idempotent.
 */
export function withholdUnrankableRankings(result: InvestigationResult): WithheldAwareResult {
    const cohort = result.cohort;
    if (cohort === undefined) return result;
    const rankable =
        isRankableSubjectKind(cohort.kind) &&
        cohort.members.every((member) => isRankableSubjectKind(member.subject.kind));
    if (rankable) return result;
    const existing = rankingWithheldOf(result);
    const affected = cohort.members.filter(hasRankingFields).length;
    if (affected === 0 && existing !== undefined) return result;
    return {
        ...result,
        cohort: { ...cohort, members: cohort.members.map(stripped) },
        ranking_withheld: {
            reason: "subject_kind_not_ranked",
            members_affected: affected + (existing?.members_affected ?? 0),
        },
    };
}
