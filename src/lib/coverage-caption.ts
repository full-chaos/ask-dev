import { rankingTable } from "./cohort-ranking";
import type { Cohort, RenderShape } from "./contracts";

/**
 * The coverage caption of a cohort chart (CHAOS-12429 E; the logic of the old web panel's
 * `coverage-caption.ts`, CHAOS-11943): which ranked members the chart does not show, in counts of
 * members read from the verified cohort, never from the chart's numbers. It mirrors ACR's own
 * selection (ranked members with a score, by `attention_rank` then canonical id, at most 64; a
 * stack only for members with drivers).
 *
 * The words carry no kind noun: the old code chose "teams", "projects" or "repositories" from a
 * table over `cohort.kind`, which CHAOS-4690 rules out. The render says "members", a word it
 * composes itself, for every kind.
 *
 * When the members the shape cites are not the members that selection expects, the caption states
 * the plain counts only, names no cause, and the mismatch is returned for a counts-only log line.
 */
export const COHORT_CHART_LIMIT = 64;

export type CoverageMismatch = {
    readonly ranked: number;
    readonly scored: number;
    readonly expected: number;
    readonly cited: number;
};

export type CoverageCaption = {
    readonly sentences: readonly string[];
    readonly mismatch: CoverageMismatch | null;
};

const member = (count: number) => (count === 1 ? "member" : "members");

export function coverageCaption(shape: RenderShape, cohort: Cohort | undefined): CoverageCaption {
    const rows = rankingTable(cohort?.members ?? []) ?? [];
    const ranked = rows.length;
    const scored = rows.filter((row) => row.score !== null);
    const noScore = ranked - scored.length;
    const id = (row: (typeof rows)[number]) => row.member.subject.canonical_id;
    const candidates = [...scored]
        .sort(
            (a, b) =>
                (a.attentionRank ?? Number.POSITIVE_INFINITY) -
                    (b.attentionRank ?? Number.POSITIVE_INFINITY) ||
                (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0),
        )
        .slice(0, COHORT_CHART_LIMIT);
    const capped = Math.max(0, scored.length - COHORT_CHART_LIMIT);
    const stack = shape.selected_by === "cohort_driver_contribution";
    const noDrivers = stack
        ? candidates.filter((row) => (row.member.drivers ?? []).length === 0).length
        : 0;
    // The members ACR's selection gives, and the members the shape cites: compared as sets, so the
    // right count of the wrong members is a mismatch too.
    const expectedIds = new Set(
        candidates
            .filter((row) => !stack || (row.member.drivers ?? []).length > 0)
            .map((row) => id(row)),
    );
    const citedIds = new Set(
        shape.series.flatMap((series) =>
            series.points.map(
                (point) => (point.source as { subject_canonical_id?: string }).subject_canonical_id,
            ),
        ),
    );
    const expected = expectedIds.size;
    const cited = citedIds.size;
    const same =
        expected === cited &&
        [...citedIds].every((cid) => cid !== undefined && expectedIds.has(cid));

    if (!same) {
        return {
            sentences: [`Shows ${String(cited)} of ${String(ranked)} ranked ${member(ranked)}.`],
            mismatch: { ranked, scored: scored.length, expected, cited },
        };
    }
    const sentences: string[] = [];
    if (noScore > 0) {
        sentences.push(
            `${String(noScore)} ranked ${member(noScore)} ${noScore === 1 ? "has" : "have"} no score.`,
        );
    }
    if (capped > 0) {
        sentences.push(
            `${String(capped)} more scored ${member(capped)} ${capped === 1 ? "is" : "are"} beyond the ` +
                `${String(COHORT_CHART_LIMIT)}-member chart limit.`,
        );
    }
    if (noDrivers > 0) {
        sentences.push(
            `${String(noDrivers)} ${member(noDrivers)} ${noDrivers === 1 ? "has" : "have"} no driver data.`,
        );
    }
    return { sentences, mismatch: null };
}
