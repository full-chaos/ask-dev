/**
 * The ranking-table projection over `cohort.members` (CHAOS-4449; acr
 * CHAOS-4398 PR3/PR3b).
 *
 * This is a re-expression of acr's OWN reference rendering,
 * `internal/contextfabric/answerprojection/ranking_table.go`, and every rule
 * below is that file's rule, not one invented here: rows come only from
 * members acr actually ranked, in `attention_rank` order, built from fields
 * the member already carries. Nothing is re-derived, re-scored, or re-worded
 * — the Workbench is a read-only consumer (README, "What this is").
 *
 * The one intentional difference: `data_completeness` is carried through as a
 * column. acr's row omits it; CHAOS-4449 asks for it, and it is a real
 * contract field on the member, so surfacing it invents nothing.
 */
import type {
    CohortDriverWindow,
    CohortMember,
    CohortMemberDriver,
    InterpretedShape,
} from "@/lib/contracts";

/**
 * The interpreted shapes a cohort ranking is an answer TO.
 *
 * A ranking table is a rich view, and AGENTS.md check 10 makes rich views
 * conditional on intent, never default — so carrying cohort data is not on
 * its own a reason to render one. The pinned canonical example proves the two
 * come apart: its `interpretation.shape` is `single_subject` (the question is
 * about one project) while it still carries a ranked team cohort. Rendering
 * on the data alone would answer a question nobody asked, which is check 1's
 * "never answer the nearest measurable question".
 *
 * `open` is deliberately excluded: an unshaped question has not asked for a
 * ranking either.
 */
const COHORT_INTENT_SHAPES: readonly InterpretedShape[] = ["explicit_cohort", "discovered_cohort"];

/** Whether an interpreted question actually asked for a cohort ranking. */
export function isCohortIntent(shape: InterpretedShape): boolean {
    return COHORT_INTENT_SHAPES.includes(shape);
}

/**
 * How many of a member's own drivers a row surfaces, matching
 * `rankingTableTopDrivers` in acr's ranking_table.go: "never a bare score" —
 * every scored row also carries the strongest evidence behind it.
 */
export const RANKING_TABLE_TOP_DRIVERS = 2;

export type RankedCohortRow = {
    readonly member: CohortMember;
    /**
     * Present on every ranked row: `ranking_computed: true` makes `outcome`
     * required, and `attention_rank` is what the rows are ordered by.
     */
    readonly attentionRank: number | undefined;
    /**
     * `null` — not `undefined` — when the member carries no score. The
     * distinction is acr's: a row "never silently omits the key when there is
     * no score either, so a consumer can tell 'no score' from 'field not
     * rendered'". `outcome` is always beside it, which is the other half of
     * "never a bare score".
     */
    readonly score: number | null;
    /** The member's strongest drivers, already ordered. May be empty. */
    readonly topDrivers: readonly CohortMemberDriver[];
    /** The row-level window summary; see `rowWindow` below. */
    readonly window: CohortDriverWindow;
    /**
     * True when the member carries a score but NO drivers to explain it.
     *
     * The pinned schema accepts that shape — `outcome: "qualified"` requires
     * `score`, while `drivers` is only bounded when `data_completeness` is
     * present — so Ajv will not reject it upstream and this view is the last
     * place it can be caught. AGENTS.md:40 requires failing closed here
     * rather than masking an answer-quality failure, so the caller renders
     * the score as withheld and says why. Withheld, not dropped: the row and
     * its outcome still render, because silently omitting the member would
     * be the other failure mode.
     */
    readonly scoreWithheld: boolean;
};

/**
 * Summarizes a member's per-driver windows into one row-level value:
 * `current_vs_prior` iff any driver used a prior-window comparison, else
 * `current` (including when the member carries no drivers at all — there is
 * then nothing to have compared against a prior window). Deterministic, and
 * a real summary rather than a fabricated one, because only `investment_mix`
 * ever carries `current_vs_prior`.
 */
export function rowWindow(drivers: readonly CohortMemberDriver[]): CohortDriverWindow {
    return drivers.some((driver) => driver.window === "current_vs_prior")
        ? "current_vs_prior"
        : "current";
}

/**
 * The strongest `limit` drivers by `weight_contributed` descending, ties
 * broken by `signal` ascending so the order is stable across renders. This
 * orders evidence; it never re-judges it.
 */
export function topDriversByWeightContributed(
    drivers: readonly CohortMemberDriver[],
    limit: number,
): readonly CohortMemberDriver[] {
    return [...drivers]
        .sort((left, right) =>
            left.weight_contributed === right.weight_contributed
                ? left.signal.localeCompare(right.signal)
                : right.weight_contributed - left.weight_contributed,
        )
        .slice(0, limit);
}

/**
 * How a cohort member's score renders: one decimal place.
 *
 * acr sends `CohortMember.score` unrounded (CHAOS-4533 — a captured live
 * value was `32.666666666666664`); this is presentation only, nothing is
 * re-derived. One decimal matches acr's own narration layer
 * (`cohortDriverJudgmentSummary`, CHAOS-4580), which already narrates this
 * same score as "32.7" — so the table and the sentence describing it never
 * disagree.
 */
export function formatCohortScore(score: number): string {
    return score.toFixed(1);
}

/**
 * The ranking table for a cohort, or `null` when acr ranked no member of it.
 *
 * `null` is the "not computed" distinction `ranking_computed` itself makes,
 * and it is why the panel renders nothing at all rather than an empty table:
 * an empty table would read as "ranked, and nothing qualified", which is a
 * different claim from "ranking never ran".
 */
export function rankingTable(members: readonly CohortMember[]): readonly RankedCohortRow[] | null {
    const ranked = members.filter((member) => member.ranking_computed === true);
    if (ranked.length === 0) return null;

    return [...ranked]
        .sort((left, right) => (left.attention_rank ?? 0) - (right.attention_rank ?? 0))
        .map((member) => {
            const drivers = member.drivers ?? [];
            const score = member.score ?? null;
            return {
                member,
                attentionRank: member.attention_rank,
                score,
                topDrivers: topDriversByWeightContributed(drivers, RANKING_TABLE_TOP_DRIVERS),
                window: rowWindow(drivers),
                scoreWithheld: score !== null && drivers.length === 0,
            };
        });
}
