import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { FactRowsPanels } from "@/components/FactRowsPanel";
import type { ClaimedFact, InvestigationResult, RenderShape } from "@/lib/contracts";
import { renderShapesFor, verifyRenderShape } from "@/lib/render-shapes";

// CHAOS-4641: verification must FAIL CLOSED.
//
// CHAOS-4415's uniqueness work made this view refuse a chart whose NUMBERS
// disagree with the answer. These two are the other half: a shape whose
// numbers are all correct, that this view still must not draw — and, more
// importantly, must not drop in silence.
//
// Neither is reachable on today's wire. That is the reason they are worth
// fixing now rather than later: both become live exactly when a new acr
// capability ships, which is when a blank space is most likely to be read as
// "that just isn't built yet" rather than as a defect.

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

function cohortAnswer(shapes: RenderShape[]): InvestigationResult {
    return {
        cohort: { kind: "team", members: [member("team:a", 46.7)] },
        claimed_facts: [],
        render_shapes: shapes,
    } as unknown as InvestigationResult;
}

function scoreShape(over: Partial<RenderShape> = {}): RenderShape {
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
                        label: "team:a",
                        value: 46.7,
                        source: { kind: "cohort_member_score", subject_canonical_id: "team:a" },
                    },
                ],
            },
        ],
        ...over,
    } as unknown as RenderShape;
}

describe("a kind this view cannot draw is withheld, not silently dropped", () => {
    it("refuses a shape whose kind has no renderer here", () => {
        // Verification checked `presentation` only for kind "series", so a
        // sankey passed, was ADMITTED, and RenderShapeChart returned null for
        // it: no chart and no withheld notice. The reader saw nothing and was
        // told nothing — the exact silent absence the notice exists for.
        const sankey = scoreShape({ kind: "sankey" });
        expect(verifyRenderShape(sankey, cohortAnswer([]))).toBe(false);
        const selected = renderShapesFor(cohortAnswer([sankey]), ["cohort_attention_score"]);
        expect(selected.shapes).toHaveLength(0);
        expect(selected.withheld).toBe(1);
    });

    it("still draws the kind it does render", () => {
        // The control: without it the fix is satisfied by refusing every
        // shape.
        const good = scoreShape();
        const selected = renderShapesFor(cohortAnswer([good]), ["cohort_attention_score"]);
        expect(selected.shapes).toHaveLength(1);
        expect(selected.withheld).toBe(0);
    });
});

describe("a time axis must be chronological, or it is not drawn", () => {
    const fact = {
        claim_id: "claim_t",
        kind: "flow",
        subject: { kind: "team", canonical_id: "team:a", label: "a" },
        field: "v",
        value: { number: 3 },
        rows: [
            { fields: { day: { string: "2026-04-01" }, v: { number: 1 } } },
            { fields: { day: { string: "2026-01-01" }, v: { number: 2 } } },
            { fields: { day: { string: "2026-03-01" }, v: { number: 3 } } },
        ],
    } as unknown as ClaimedFact;

    function trend(order: readonly [string, number, number][]): RenderShape {
        return {
            shape_id: "rs_t",
            kind: "series",
            presentation: "line",
            selected_by: "dated_fact_trend",
            title: "V over time",
            axis_kind: "time",
            axis_label: "day",
            value_label: "V",
            series: [
                {
                    key: "v",
                    label: "V",
                    points: order.map(([label, value, row]) => ({
                        label,
                        value,
                        source: {
                            kind: "claimed_fact_row",
                            claim_id: "claim_t",
                            row_index: row,
                            field: "v",
                        },
                    })),
                },
            ],
        } as unknown as RenderShape;
    }

    it("refuses points that do not ascend in time", () => {
        // Every value here is correctly sourced and verifies individually.
        // The LINE BETWEEN THEM is the lie: drawn in payload order it goes
        // April -> January -> March, inventing transitions that never
        // happened. Same defect class as CHAOS-4616, reached through segment
        // order instead of through the axis.
        const outOfOrder = trend([
            ["2026-04-01", 1, 0],
            ["2026-01-01", 2, 1],
            ["2026-03-01", 3, 2],
        ]);
        const result = {
            claimed_facts: [fact],
            render_shapes: [outOfOrder],
        } as unknown as InvestigationResult;
        expect(verifyRenderShape(outOfOrder, result)).toBe(false);
        const { container } = render(<FactRowsPanels facts={[fact]} result={result} />);
        expect(container.querySelector(".render-shape")).toBeNull();
    });

    it("draws a chronological trend", () => {
        const ordered = trend([
            ["2026-01-01", 2, 1],
            ["2026-03-01", 3, 2],
            ["2026-04-01", 1, 0],
        ]);
        const result = {
            claimed_facts: [fact],
            render_shapes: [ordered],
        } as unknown as InvestigationResult;
        expect(verifyRenderShape(ordered, result)).toBe(true);
    });
});
