import { describe, expect, it } from "vitest";

import type { InvestigationResult, RenderShape } from "@/lib/contracts";
import {
    COHORT_SHAPE_RULES,
    renderShapesFor,
    trendShapesForClaim,
    verifyRenderShape,
} from "@/lib/render-shapes";

/**
 * CHAOS-4415: the Workbench's own check on a chart it did not compute.
 *
 * acr validates every render shape before it serves one, so a mismatch here
 * is not a routine condition — it means the answer disagrees with itself,
 * and this view is the last place it can be caught. AGENTS.md makes that a
 * fail-closed obligation, so the property under test is: a chart whose
 * numbers do not equal the facts it cites is DROPPED, and the drop is
 * counted so a panel can say a chart was withheld.
 */

function scoreShape(value: number): RenderShape {
    return {
        shape_id: "rs_1",
        kind: "series",
        presentation: "bars",
        selected_by: "cohort_attention_score",
        title: "Attention score by team",
        axis_kind: "category",
        axis_label: "team",
        value_label: "attention score",
        series: [
            {
                key: "attention_score",
                label: "Attention score",
                points: [
                    {
                        label: "ops-team",
                        value,
                        source: {
                            kind: "cohort_member_score",
                            subject_canonical_id: "team:gh:ops-team",
                        },
                    },
                ],
            },
        ],
    };
}

function trendShape(value: number): RenderShape {
    return {
        shape_id: "rs_3",
        kind: "series",
        presentation: "line",
        selected_by: "dated_fact_trend",
        title: "Coverage ratio over time",
        axis_kind: "time",
        axis_label: "day",
        value_label: "Coverage ratio",
        series: [
            {
                key: "coverage_ratio",
                label: "Coverage ratio",
                points: [
                    {
                        label: "2026-08-03",
                        value,
                        source: {
                            kind: "claimed_fact_row",
                            claim_id: "claim_readiness_trend",
                            row_index: 0,
                            field: "coverage_ratio",
                        },
                    },
                    {
                        label: "2026-08-30",
                        value: 0.6,
                        source: {
                            kind: "claimed_fact_row",
                            claim_id: "claim_readiness_trend",
                            row_index: 1,
                            field: "coverage_ratio",
                        },
                    },
                ],
            },
        ],
    };
}

function answer(shapes: readonly RenderShape[]): InvestigationResult {
    return {
        cohort: {
            kind: "team",
            members: [
                {
                    subject: { kind: "team", canonical_id: "team:gh:ops-team", label: "ops-team" },
                    rank: 1,
                    inclusion_reasons: ["in the census"],
                    ranking_computed: true,
                    attention_rank: 1,
                    score: 46.7,
                    outcome: "qualified",
                    drivers: [
                        {
                            signal: "readiness.coverage_gap",
                            value: 1,
                            weight: 20,
                            weight_contributed: 20,
                            window: "current",
                        },
                    ],
                },
            ],
        },
        claimed_facts: [
            {
                claim_id: "claim_readiness_trend",
                kind: "readiness",
                subject: { kind: "team", canonical_id: "team:gh:ops-team", label: "ops-team" },
                field: "coverage_ratio",
                value: { number: 0.6 },
                rows: [
                    { fields: { day: { string: "2026-08-03" }, coverage_ratio: { number: 0.41 } } },
                    { fields: { day: { string: "2026-08-30" }, coverage_ratio: { number: 0.6 } } },
                ],
            },
        ],
        render_shapes: shapes,
    } as unknown as InvestigationResult;
}

describe("verifyRenderShape", () => {
    it("accepts a shape whose every point equals the fact it cites", () => {
        // The control. Without it the rejection cases below would be
        // satisfied by a verifier that rejects everything.
        expect(verifyRenderShape(scoreShape(46.7), answer([]))).toBe(true);
    });

    it("rejects a point that disagrees with its cited source", () => {
        expect(verifyRenderShape(scoreShape(46.8), answer([]))).toBe(false);
    });

    it("rejects a ROUNDED point, which is as wrong as an invented one", () => {
        // The answer says 46.7. A bar labelled 47 is a bar of a number
        // nothing measured — and rounding is the change a well-meaning
        // renderer makes, which is exactly why it is tested.
        expect(verifyRenderShape(scoreShape(47), answer([]))).toBe(false);
    });

    it("rejects a point citing a member this answer does not carry", () => {
        const shape = scoreShape(46.7);
        const stray = {
            ...shape,
            series: [
                {
                    ...shape.series[0],
                    points: [
                        {
                            ...shape.series[0].points[0],
                            source: {
                                kind: "cohort_member_score" as const,
                                subject_canonical_id: "team:gh:nobody",
                            },
                        },
                    ],
                },
            ],
        } as RenderShape;
        expect(verifyRenderShape(stray, answer([]))).toBe(false);
    });

    it("resolves a driver weight and a claimed-fact row cell, not just a score", () => {
        const driverShape = {
            ...scoreShape(20),
            shape_id: "rs_2",
            presentation: "stacked_bars",
            selected_by: "cohort_driver_contribution",
            series: [
                {
                    key: "readiness.coverage_gap",
                    label: "Readiness coverage gap",
                    points: [
                        {
                            label: "ops-team",
                            value: 20,
                            source: {
                                kind: "cohort_driver_weight_contributed",
                                subject_canonical_id: "team:gh:ops-team",
                                signal: "readiness.coverage_gap",
                            },
                        },
                    ],
                },
            ],
        } as RenderShape;
        expect(verifyRenderShape(driverShape, answer([]))).toBe(true);
        expect(verifyRenderShape(trendShape(0.41), answer([]))).toBe(true);
        expect(verifyRenderShape(trendShape(0.42), answer([]))).toBe(false);
    });
});

describe("renderShapesFor", () => {
    it("returns nothing at all for an answer carrying no shapes", () => {
        // The common case, and the point of the whole feature: most answers
        // warrant no chart, and reading an empty field must be silent.
        const result = { claimed_facts: [] } as unknown as InvestigationResult;
        expect(renderShapesFor(result, COHORT_SHAPE_RULES)).toEqual({ shapes: [], withheld: 0 });
    });

    it("selects by RULE, not by kind, so a trend never lands in the cohort panel", () => {
        // All three slice-1 rules produce kind "series". Which panel a chart
        // belongs in is a question about WHY it was selected.
        const result = answer([scoreShape(46.7), trendShape(0.41)]);
        const cohort = renderShapesFor(result, COHORT_SHAPE_RULES);
        expect(cohort.shapes.map((shape) => shape.selected_by)).toEqual(["cohort_attention_score"]);
    });

    it("withholds a tampered shape and COUNTS it rather than dropping it quietly", () => {
        const result = answer([scoreShape(99)]);
        expect(renderShapesFor(result, COHORT_SHAPE_RULES)).toEqual({ shapes: [], withheld: 1 });
    });
});

describe("trendShapesForClaim", () => {
    it("matches a trend to the claim its own points cite", () => {
        const result = answer([scoreShape(46.7), trendShape(0.41)]);
        expect(trendShapesForClaim(result, "claim_readiness_trend").shapes).toHaveLength(1);
        expect(trendShapesForClaim(result, "claim_other").shapes).toHaveLength(0);
    });

    it("never reports another fact's withheld trend under this claim", () => {
        // A withheld count attributed to the wrong panel would tell a reader
        // that THIS fact's chart disagreed with THIS fact's rows, which is a
        // false statement about the data in front of them.
        const result = answer([trendShape(0.99)]);
        expect(trendShapesForClaim(result, "claim_readiness_trend").withheld).toBe(1);
        expect(trendShapesForClaim(result, "claim_other").withheld).toBe(0);
    });
});
