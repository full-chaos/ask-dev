import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { RenderShapeChart } from "@/components/RenderShapeChart";
import type { InvestigationResult, RenderShape } from "@/lib/contracts";
import { trendShapesForClaim, verifyRenderShape } from "@/lib/render-shapes";

// codex round 1 on ask-dev. Every finding gets a failing test BEFORE a fix.
// The theme across them: the LIB fails closed and the RENDERER fails open, so
// a payload that acr would never emit but that the published JSON Schema
// admits gets drawn anyway. acr's own validator rejects each of these; this
// view is the last gate, and AGENTS.md makes it fail closed rather than mask.

function base(): RenderShape {
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
                        label: "ops",
                        value: 46.7,
                        source: { kind: "cohort_member_score", subject_canonical_id: "team:a" },
                    },
                ],
            },
        ],
    };
}

function answer(): InvestigationResult {
    return {
        cohort: {
            kind: "team",
            members: [
                {
                    subject: { kind: "team", canonical_id: "team:a", label: "A" },
                    rank: 1,
                    inclusion_reasons: ["x"],
                    ranking_computed: true,
                    attention_rank: 1,
                    score: 46.7,
                    outcome: "qualified",
                    drivers: [],
                },
            ],
        },
        claimed_facts: [
            {
                claim_id: "claim_a",
                kind: "metrics",
                subject: { kind: "team", canonical_id: "team:a", label: "A" },
                field: "v",
                value: { number: 1 },
                rows: [{ fields: { day: { string: "2026-08-03" }, v: { number: 1 } } }],
            },
            {
                claim_id: "claim_b",
                kind: "metrics",
                subject: { kind: "team", canonical_id: "team:a", label: "A" },
                field: "v",
                value: { number: 2 },
                rows: [{ fields: { day: { string: "2026-08-04" }, v: { number: 2 } } }],
            },
        ],
    } as unknown as InvestigationResult;
}

describe("codex P1 — duplicate point labels", () => {
    it("withholds a series carrying two points at one axis position", () => {
        // acr rejects this ("render point labels must be unique within a
        // series"), but the published schema cannot express it, so a
        // schema-valid payload reaches here. The renderer deduplicates by
        // label and keeps the FIRST value — a number is dropped, silently,
        // and the chart still draws.
        const shape = base();
        shape.series[0].points = [
            shape.series[0].points[0],
            { ...shape.series[0].points[0], value: 46.7 },
        ];
        expect(verifyRenderShape(shape, answer())).toBe(false);
    });
});

describe("codex P2 — a source address must match its own kind", () => {
    it("withholds a score source that also carries a driver signal", () => {
        // acr's validateRenderPointSourceShape rejects this. Resolving it
        // anyway means a source that names something contradictory still
        // draws — and the address, not just the value, is the provenance.
        const shape = base();
        shape.series[0].points[0].source = {
            kind: "cohort_member_score",
            subject_canonical_id: "team:a",
            signal: "readiness.coverage_gap",
        };
        expect(verifyRenderShape(shape, answer())).toBe(false);
    });
});

describe("codex P2 — encoding and axis metadata must not fail open", () => {
    it("withholds a series shape with no presentation instead of guessing bars", () => {
        const shape = base();
        delete (shape as { presentation?: unknown }).presentation;
        expect(verifyRenderShape(shape, answer())).toBe(false);
    });

    it("withholds a time-axis shape whose labels are not all real dates", () => {
        // A time axis is POSITIONED by elapsed time. Falling back to index
        // spacing draws evenly-spaced samples the data does not have.
        const shape = base();
        shape.axis_kind = "time";
        shape.presentation = "line";
        shape.series[0].points[0].label = "not-a-date";
        expect(verifyRenderShape(shape, answer())).toBe(false);
    });
});

describe("codex P2 — a trend belongs to ONE claim", () => {
    it("does not attribute a mixed-source trend to every claim it touches", () => {
        const result = answer();
        const trend = {
            ...base(),
            shape_id: "rs_2",
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
                            label: "2026-08-04",
                            value: 2,
                            source: {
                                kind: "claimed_fact_row",
                                claim_id: "claim_b",
                                row_index: 0,
                                field: "v",
                            },
                        },
                    ],
                },
            ],
        } as RenderShape;
        (result as { render_shapes?: RenderShape[] }).render_shapes = [trend];
        // Rendering it under BOTH panels shows one chart twice and makes each
        // panel claim a fact it does not fully rest on.
        const a = trendShapesForClaim(result, "claim_a");
        const b = trendShapesForClaim(result, "claim_b");
        expect(a.shapes.length + b.shapes.length).toBeLessThanOrEqual(1);
    });
});

describe("codex P2 — the renderer must not round a verified number into a different one", () => {
    it("shows a small non-zero value as itself, never as 0", () => {
        // The whole contract exists so a chart number equals the fact it
        // cites. Formatting 0.004 as "0" breaks that at the last inch, and
        // in the accessible table it is the ONLY number a reader gets.
        const shape = base();
        shape.series[0].points[0].value = 0.004;
        const result = answer();
        result.cohort!.members[0]!.score = 0.004;
        render(<RenderShapeChart shape={shape} />);
        const table = screen.getByRole("table", { name: /Attention score by team/i });
        // The accessible table is the only place a reader is guaranteed the
        // number at all, so it carries the EXACT value, never a rounded one.
        expect(table).toHaveTextContent("0.004");
        expect(
            screen.getByLabelText("ops, Attention score: 0.004 attention score"),
        ).toBeInTheDocument();
    });
});

describe("a computed sum is never printed as a fact", () => {
    it("gives a stacked bar NO total label, complete or not", () => {
        // Found by re-running the live rig after the codex fixes, not by a
        // reviewer: on the real cohort answer the segments sum to
        // 46.66666666666667 while the member's own score is
        // 46.666666666666664. Printing the stack height would have been this
        // contract's own defect, reached from the renderer's side. The score
        // is already plotted verbatim by the attention-score shape.
        // A missing segment means the family was not measured. Summing it as
        // zero and calling the result the total states a measurement the
        // answer never made.
        const shape = {
            ...base(),
            shape_id: "rs_3",
            presentation: "stacked_bars",
            selected_by: "cohort_driver_contribution",
            series: [
                {
                    key: "a",
                    label: "A",
                    points: [
                        {
                            label: "ops",
                            value: 20,
                            source: {
                                kind: "cohort_driver_weight_contributed",
                                subject_canonical_id: "team:a",
                                signal: "a",
                            },
                        },
                    ],
                },
                {
                    key: "b",
                    label: "B",
                    points: [
                        {
                            label: "other",
                            value: 5,
                            source: {
                                kind: "cohort_driver_weight_contributed",
                                subject_canonical_id: "team:a",
                                signal: "b",
                            },
                        },
                    ],
                },
            ],
        } as RenderShape;
        const { container } = render(<RenderShapeChart shape={shape} />);
        expect(container.querySelectorAll(".fact-chart__value-label")).toHaveLength(0);
    });

    it("gives a COMPLETE stack no total label either", () => {
        const complete = {
            ...base(),
            shape_id: "rs_4",
            presentation: "stacked_bars",
            selected_by: "cohort_driver_contribution",
            series: [
                {
                    key: "a",
                    label: "A",
                    points: [
                        {
                            label: "ops",
                            value: 20,
                            source: {
                                kind: "cohort_driver_weight_contributed",
                                subject_canonical_id: "team:a",
                                signal: "a",
                            },
                        },
                    ],
                },
                {
                    key: "b",
                    label: "B",
                    points: [
                        {
                            label: "ops",
                            value: 13.333333333333334,
                            source: {
                                kind: "cohort_driver_weight_contributed",
                                subject_canonical_id: "team:a",
                                signal: "b",
                            },
                        },
                    ],
                },
            ],
        } as unknown as RenderShape;
        const { container } = render(<RenderShapeChart shape={complete} />);
        expect(container.querySelectorAll(".fact-chart__value-label")).toHaveLength(0);
    });
});
