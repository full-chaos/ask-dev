import { describe, expect, it } from "vitest";

import type { InvestigationResult, RenderShape } from "@/lib/contracts";
import { renderShapesFor, trendShapesForClaim, verifyRenderShape } from "@/lib/render-shapes";

// codex round 3 on ask-dev. All three findings are the SAME defect in three
// places: a duplicate-identity rule that exists on one path and not on its
// sibling.
//
// I have now made this mistake four times in this lane — silent truncation
// (cohort members, then trend series), duplicate claim ids (fixed) versus
// duplicate cohort members (not), duplicate shape ids in the cohort selector
// (fixed) versus the trend selector (not), and duplicate point labels
// (checked) versus duplicate series keys (not). Each fix was correct and
// each was applied to exactly the case the reviewer named.
//
// So these tests pin the RULE, not the three instances: every identity this
// view resolves by must be unique, everywhere it is resolved.

function member(id: string, score: number) {
    return {
        subject: { kind: "team", canonical_id: id, label: id },
        rank: 1,
        inclusion_reasons: ["x"],
        ranking_computed: true,
        attention_rank: 1,
        score,
        outcome: "qualified",
        drivers: [],
    };
}

function scoreShape(id: string, value: number, shapeId = "rs_1"): RenderShape {
    return {
        shape_id: shapeId,
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
                        label: id,
                        value,
                        source: { kind: "cohort_member_score", subject_canonical_id: id },
                    },
                ],
            },
        ],
    } as unknown as RenderShape;
}

describe("R3-1 — a duplicate cohort member is a malformed document", () => {
    it("withholds a point citing a canonical id that appears twice", () => {
        // This view took the FIRST match; acr's resolver builds a map and
        // takes the last, and its validator rejects the duplicate outright.
        // So the same answer could show two readers different numbers — the
        // identical reasoning that made duplicate CLAIM ids a refusal in
        // round 2, applied to the sibling identity I missed.
        const result = {
            cohort: { kind: "team", members: [member("team:a", 43.5), member("team:a", 44.5)] },
            claimed_facts: [],
        } as unknown as InvestigationResult;
        expect(verifyRenderShape(scoreShape("team:a", 43.5), result)).toBe(false);
    });
});

describe("R3-2 — duplicate shape ids are refused on EVERY selector", () => {
    it("withholds duplicate-id trends, as the cohort selector already does", () => {
        const trend = {
            ...scoreShape("team:a", 1, "rs_dup"),
            presentation: "line",
            axis_kind: "time",
            selected_by: "dated_fact_trend",
            series: [
                {
                    key: "v",
                    label: "V",
                    points: [
                        {
                            label: "2026-08-03",
                            value: 1,
                            source: {
                                kind: "claimed_fact_row",
                                claim_id: "claim_a",
                                row_index: 0,
                                field: "v",
                            },
                        },
                        {
                            label: "2026-08-30",
                            value: 2,
                            source: {
                                kind: "claimed_fact_row",
                                claim_id: "claim_a",
                                row_index: 1,
                                field: "v",
                            },
                        },
                    ],
                },
            ],
        } as unknown as RenderShape;
        const result = {
            claimed_facts: [
                {
                    claim_id: "claim_a",
                    kind: "flow",
                    subject: { kind: "team", canonical_id: "team:a", label: "a" },
                    field: "v",
                    value: { number: 2 },
                    rows: [
                        { fields: { day: { string: "2026-08-03" }, v: { number: 1 } } },
                        { fields: { day: { string: "2026-08-30" }, v: { number: 2 } } },
                    ],
                },
            ],
            render_shapes: [trend, { ...trend }],
        } as unknown as InvestigationResult;
        const selected = trendShapesForClaim(result, "claim_a");
        expect(selected.shapes).toHaveLength(0);
        expect(selected.withheld).toBe(2);
    });
});

describe("R3-3 — a series key is an identity too", () => {
    it("withholds a shape whose two series share a key", () => {
        // Both renderers use `series.key` as a React child key, so duplicates
        // leave reconciliation non-deterministic — and acr rejects them.
        const shape = scoreShape("team:a", 1);
        const dup = {
            ...shape,
            series: [shape.series[0], { ...shape.series[0] }],
        } as unknown as RenderShape;
        const result = {
            cohort: { kind: "team", members: [member("team:a", 1)] },
            claimed_facts: [],
        } as unknown as InvestigationResult;
        expect(verifyRenderShape(dup, result)).toBe(false);
    });
});

describe("the rule, not the three instances", () => {
    it("keeps accepting a well-formed answer", () => {
        // The control. Without it every assertion above is satisfied by a
        // verifier that refuses everything.
        const result = {
            cohort: { kind: "team", members: [member("team:a", 43.5)] },
            claimed_facts: [],
            render_shapes: [scoreShape("team:a", 43.5)],
        } as unknown as InvestigationResult;
        const selected = renderShapesFor(result, ["cohort_attention_score"]);
        expect(selected.shapes).toHaveLength(1);
        expect(selected.withheld).toBe(0);
    });
});
