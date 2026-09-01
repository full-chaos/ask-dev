import { describe, expect, it } from "vitest";

import renderShapesResult from "@/contracts/examples/context_fabric_investigation_result_render_shapes.v1.json";
import type { InvestigationResult, RenderShape } from "@/lib/contracts";
import {
    COHORT_SHAPE_RULES,
    renderShapesFor,
    renderableRowsSource,
    trendChartSourceCounts,
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

/**
 * CHAOS-4682 (§5.1 P2 dual-read cutover): acr can now serve a dual-table
 * fact carrying BOTH a legacy `rows` (its breakdown/ranking table, unrelated
 * row count and shape) AND the additive `time_series_rows` (a genuine
 * time_series riding alongside it). acr's own `renderableRows` prefers
 * `time_series_rows` whenever present for EVERY `claimed_fact_row`-sourced
 * point, including the ones a trend shape cites — this is the wire-level
 * mirror of that rule.
 *
 * Before this rule was mirrored here, `rowsFor` always read the legacy
 * `rows` array. A trend shape citing `row_index` 1 or 2 against a legacy
 * table with only ONE row resolved to `undefined` (index out of bounds),
 * `verifyRenderShape` refused the point as unsourced, and the whole trend
 * was WITHHELD — acr's dual-read cutover reaching the wire, then being
 * silently dropped by this view. This is the red case that change fixes.
 */
function dualTableAnswer(): InvestigationResult {
    return {
        cohort: undefined,
        claimed_facts: [
            {
                claim_id: "claim_workload_dual",
                kind: "workload",
                subject: { kind: "project", canonical_id: "project_x", label: "Project X" },
                field: "backlog_size",
                value: { integer: 12 },
                // The legacy breakdown table: ONE row, a different shape and
                // meaning entirely from the time series below.
                rows: [
                    {
                        fields: {
                            team_id: { string: "team_a" },
                            backlog_size: { integer: 12 },
                        },
                    },
                ],
                table: {
                    field: "team_breakdown",
                    shape: "breakdown",
                    key: ["team_id"],
                    measures: ["backlog_size"],
                },
                // The additive time_series pair: three rows, riding alongside.
                time_series_rows: [
                    {
                        fields: { day: { string: "2026-08-03" }, backlog_size: { integer: 9 } },
                    },
                    {
                        fields: { day: { string: "2026-08-18" }, backlog_size: { integer: 11 } },
                    },
                    {
                        fields: { day: { string: "2026-08-30" }, backlog_size: { integer: 12 } },
                    },
                ],
                time_series_table: {
                    field: "daily_workload",
                    shape: "time_series",
                    key: ["day"],
                    measures: ["backlog_size"],
                },
            },
        ],
        render_shapes: [
            {
                shape_id: "rs_dual",
                kind: "series",
                presentation: "line",
                selected_by: "dated_fact_trend",
                title: "Backlog size over time — Project X",
                axis_kind: "time",
                axis_label: "day",
                value_label: "Backlog size",
                series: [
                    {
                        key: "backlog_size",
                        label: "Backlog size",
                        points: [
                            {
                                label: "2026-08-03",
                                value: 9,
                                source: {
                                    kind: "claimed_fact_row",
                                    claim_id: "claim_workload_dual",
                                    row_index: 0,
                                    field: "backlog_size",
                                },
                            },
                            {
                                label: "2026-08-18",
                                value: 11,
                                source: {
                                    kind: "claimed_fact_row",
                                    claim_id: "claim_workload_dual",
                                    row_index: 1,
                                    field: "backlog_size",
                                },
                            },
                            {
                                label: "2026-08-30",
                                value: 12,
                                source: {
                                    kind: "claimed_fact_row",
                                    claim_id: "claim_workload_dual",
                                    row_index: 2,
                                    field: "backlog_size",
                                },
                            },
                        ],
                    },
                ],
            },
        ],
    } as unknown as InvestigationResult;
}

describe("renderableRowsSource (CHAOS-4682)", () => {
    it("prefers time_series_rows when the fact carries a non-empty pair", () => {
        const [fact] = dualTableAnswer().claimed_facts;
        expect(renderableRowsSource(fact!)).toBe("time_series_rows");
    });

    it("falls back to the legacy rows when time_series_rows is absent", () => {
        const [fact] = answer([]).claimed_facts;
        expect(renderableRowsSource(fact!)).toBe("rows");
    });

    it("falls back to rows when time_series_rows is present but empty", () => {
        const fact = { ...dualTableAnswer().claimed_facts[0]!, time_series_rows: [] };
        expect(renderableRowsSource(fact)).toBe("rows");
    });
});

describe("dual-table trend resolution (CHAOS-4682)", () => {
    it("resolves a trend's points against time_series_rows, not the legacy rows", () => {
        const result = dualTableAnswer();
        // The row_index=1/2 points would be out of bounds against `rows`
        // (length 1) — this only verifies if resolution reads
        // `time_series_rows` (length 3), the exact regression this pin fixes.
        expect(verifyRenderShape(result.render_shapes![0]!, result)).toBe(true);
    });

    it("admits the dual-table trend, not withholding it as unsourced", () => {
        const result = dualTableAnswer();
        const trends = trendShapesForClaim(result, "claim_workload_dual");
        expect(trends.shapes).toHaveLength(1);
        expect(trends.withheld).toBe(0);
    });
});

describe("trendChartSourceCounts (CHAOS-4682 telemetry)", () => {
    it("attributes an admitted dual-table trend to time_series_rows", () => {
        const result = dualTableAnswer();
        expect(trendChartSourceCounts(result)).toEqual({
            dualTableTrendChartCount: 1,
            legacyTrendChartCount: 0,
        });
    });

    it("attributes an admitted single-table trend to the legacy rows", () => {
        const result = answer([trendShape(0.41)]);
        expect(trendChartSourceCounts(result)).toEqual({
            dualTableTrendChartCount: 0,
            legacyTrendChartCount: 1,
        });
    });

    it("never counts a withheld/tampered trend under either source", () => {
        // A trend that fails verification was drawn by neither source — it
        // was not drawn at all — so it must not inflate either count.
        const result = answer([trendShape(0.99)]);
        expect(trendChartSourceCounts(result)).toEqual({
            dualTableTrendChartCount: 0,
            legacyTrendChartCount: 0,
        });
    });

    /**
     * codex round 1, P3 (EXECUTED): a shape whose points cite TWO different
     * claims can be value-valid (each point resolves correctly against ITS
     * OWN cited claim) and so passes `renderShapesFor`'s admission — but no
     * panel draws it, because `trendShapesForClaim` requires EVERY point of
     * a shape cite the ONE claim its panel is about (`shapeCitesClaim`).
     * Attributing by the first point's claim id (the bug this fixes)
     * reported one legacy-source chart drawn while EVERY panel reported
     * `shapes:[] withheld:1` — a source attributed to a chart nobody saw.
     */
    it("counts a value-valid but MIXED-claim trend under neither source", () => {
        const base = dualTableAnswer();
        const otherClaim = {
            claim_id: "claim_workload_other",
            kind: "workload",
            subject: { kind: "project", canonical_id: "project_y", label: "Project Y" },
            field: "backlog_size",
            value: { integer: 5 },
            rows: [{ fields: { day: { string: "2026-08-04" }, backlog_size: { integer: 5 } } }],
        };
        const mixedShape = {
            shape_id: "rs_mixed",
            kind: "series",
            presentation: "line",
            selected_by: "dated_fact_trend",
            title: "Mixed-claim trend",
            axis_kind: "time",
            axis_label: "day",
            value_label: "Backlog size",
            series: [
                {
                    key: "backlog_size",
                    label: "Backlog size",
                    points: [
                        {
                            label: "2026-08-03",
                            value: 9,
                            source: {
                                kind: "claimed_fact_row",
                                claim_id: "claim_workload_dual",
                                row_index: 0,
                                field: "backlog_size",
                            },
                        },
                        {
                            label: "2026-08-04",
                            value: 5,
                            source: {
                                kind: "claimed_fact_row",
                                claim_id: "claim_workload_other",
                                row_index: 0,
                                field: "backlog_size",
                            },
                        },
                    ],
                },
            ],
        } as unknown as RenderShape;
        const result = {
            ...base,
            claimed_facts: [...base.claimed_facts, otherClaim],
            render_shapes: [mixedShape],
        } as unknown as InvestigationResult;

        // Sanity: value-valid — each point resolves correctly against the
        // claim IT cites — so it clears the value-correctness gate.
        expect(verifyRenderShape(mixedShape, result)).toBe(true);
        // But no panel draws it: neither claim's own panel admits a shape
        // that also cites another claim.
        expect(trendShapesForClaim(result, "claim_workload_dual").shapes).toHaveLength(0);
        expect(trendShapesForClaim(result, "claim_workload_other").shapes).toHaveLength(0);

        expect(trendChartSourceCounts(result)).toEqual({
            dualTableTrendChartCount: 0,
            legacyTrendChartCount: 0,
        });
    });

    it("counts zero of both when the answer carries no trend at all", () => {
        expect(trendChartSourceCounts(answer([]))).toEqual({
            dualTableTrendChartCount: 0,
            legacyTrendChartCount: 0,
        });
    });
});

/**
 * EXECUTED proof against the REAL synced fixture (CHAOS-4682's own pin bump
 * regenerated this file from acr's pinned commit — see
 * scripts/sync-acr-contracts.mjs). `claim_workload_ask_dev_backlog` is the
 * dual-table claim acr's own PR added: a legacy `team_breakdown` (one row)
 * riding alongside a genuine `daily_workload` time series (three rows), with
 * its own server-selected trend shape `rs_4`. This is not a hand-authored
 * fixture — it is the actual shape the pinned acr commit emits, so a pass
 * here proves the fix against the real wire document, not just a
 * hand-built regression case.
 */
describe("real synced fixture — claim_workload_ask_dev_backlog (CHAOS-4682)", () => {
    const fixture = renderShapesResult as unknown as InvestigationResult;

    it("the fixture's dual-table claim carries a non-empty time_series_rows", () => {
        const fact = fixture.claimed_facts.find(
            (candidate) => candidate.claim_id === "claim_workload_ask_dev_backlog",
        );
        expect(fact).toBeDefined();
        expect(renderableRowsSource(fact!)).toBe("time_series_rows");
    });

    it("its trend chart is admitted, not withheld, and reads the correct values", () => {
        const trends = trendShapesForClaim(fixture, "claim_workload_ask_dev_backlog");
        expect(trends.withheld).toBe(0);
        expect(trends.shapes).toHaveLength(1);
        expect(trends.shapes[0]!.series[0].points.map((point) => point.value)).toEqual([9, 11, 12]);
    });
});
