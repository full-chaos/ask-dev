import { describe, expect, it } from "vitest";

import type { Cohort, CohortMember, RenderShape } from "@/lib/contracts";
import { COHORT_CHART_LIMIT, coverageCaption } from "@/lib/coverage-caption";

const ranked = (id: string, extra: Partial<CohortMember> = {}): CohortMember => ({
    subject: { kind: "team", canonical_id: `team:${id}`, label: id },
    rank: 1,
    inclusion_reasons: ["Matched by kind census over the org's team roster."],
    ranking_computed: true,
    attention_rank: 1,
    ...extra,
});
const scored = (id: string, rank: number, withDrivers = true): CohortMember =>
    ranked(id, {
        attention_rank: rank,
        score: 50 - rank,
        outcome: "qualified",
        ...(withDrivers
            ? {
                  drivers: [
                      {
                          signal: "investment_mix",
                          value: 1,
                          weight: 1,
                          weight_contributed: 1,
                          window: "current",
                      },
                  ],
              }
            : {}),
    });

const cohortOf = (kind: string, members: CohortMember[]): Cohort => ({
    kind,
    members,
    rationale: "r",
    complete: true,
    truncated: false,
    score_meaning: "attention",
});

const shapeCiting = (
    ids: string[],
    selected_by: RenderShape["selected_by"] = "cohort_attention_score",
): RenderShape =>
    ({
        shape_id: "rs",
        kind: "series",
        presentation: "bars",
        selected_by,
        title: "t",
        axis_kind: "category",
        axis_label: "a",
        value_label: "v",
        series: [
            {
                key: "k",
                label: "K",
                points: ids.map((id) => ({
                    label: id,
                    value: 1,
                    source: { kind: "cohort_member_score", subject_canonical_id: `team:${id}` },
                })),
            },
        ],
    }) as unknown as RenderShape;

describe("coverageCaption (CHAOS-12429 E)", () => {
    it("says which ranked members have no score, with no kind noun", () => {
        const cohort = cohortOf("team", [scored("A", 1), scored("B", 2), ranked("C"), ranked("D")]);
        const caption = coverageCaption(shapeCiting(["A", "B"]), cohort);
        expect(caption.sentences).toEqual(["2 ranked members have no score."]);
        expect(caption.mismatch).toBeNull();
    });

    it("says it in the singular for one", () => {
        const cohort = cohortOf("project", [scored("A", 1), ranked("C")]);
        expect(coverageCaption(shapeCiting(["A"]), cohort).sentences).toEqual([
            "1 ranked member has no score.",
        ]);
    });

    it("never names the cohort kind, whatever it is", () => {
        for (const kind of ["team", "project", "repository", "person", "brand_new_kind"]) {
            const cohort = cohortOf(kind, [scored("A", 1), ranked("C")]);
            const text = coverageCaption(shapeCiting(["A"]), cohort).sentences.join(" ");
            expect(text).not.toMatch(new RegExp(kind, "iu"));
            expect(text).toMatch(/member/u);
        }
    });

    it("says nothing when every ranked member is drawn", () => {
        const cohort = cohortOf("team", [scored("A", 1), scored("B", 2)]);
        expect(coverageCaption(shapeCiting(["A", "B"]), cohort).sentences).toEqual([]);
    });

    it("counts from the verified cohort, never from the chart's numbers", () => {
        const cohort = cohortOf("team", [scored("A", 1), ranked("C")]);
        const shape = shapeCiting(["A"]);
        shape.series[0].points[0].value = 9999;
        expect(coverageCaption(shape, cohort).sentences).toEqual(["1 ranked member has no score."]);
    });

    it("a stack says which scored members have no driver data", () => {
        const cohort = cohortOf("team", [scored("A", 1), scored("B", 2, false)]);
        const caption = coverageCaption(shapeCiting(["A"], "cohort_driver_contribution"), cohort);
        expect(caption.sentences).toEqual(["1 member has no driver data."]);
    });

    it("states members beyond the chart limit", () => {
        const members = Array.from({ length: COHORT_CHART_LIMIT + 2 }, (_, i) =>
            scored(`m${String(i).padStart(3, "0")}`, i + 1),
        );
        const cited = members.slice(0, COHORT_CHART_LIMIT).map((m) => m.subject.label);
        const caption = coverageCaption(shapeCiting(cited), cohortOf("team", members));
        expect(caption.sentences).toEqual([
            `2 more scored members are beyond the ${String(COHORT_CHART_LIMIT)}-member chart limit.`,
        ]);
    });

    it("where the cited members disagree with the selection: plain counts, no cause, mismatch returned", () => {
        const cohort = cohortOf("team", [scored("A", 1), scored("B", 2), ranked("C")]);
        const caption = coverageCaption(shapeCiting(["A"]), cohort);
        expect(caption.sentences).toEqual(["Shows 1 of 3 ranked members."]);
        expect(caption.mismatch).toEqual({ ranked: 3, scored: 2, expected: 2, cited: 1 });
    });

    it("the right count of the wrong members is a mismatch too", () => {
        const cohort = cohortOf("team", [scored("A", 1), scored("B", 2)]);
        const caption = coverageCaption(shapeCiting(["A", "Z"]), cohort);
        expect(caption.mismatch).not.toBeNull();
        expect(caption.sentences).toEqual(["Shows 2 of 2 ranked members."]);
    });
});
