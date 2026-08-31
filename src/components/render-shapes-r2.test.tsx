import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { FactRowsPanels } from "@/components/FactRowsPanel";
import { RenderShapeChart } from "@/components/RenderShapeChart";
import type { InvestigationResult, RenderShape } from "@/lib/contracts";
import { renderShapesFor, trendShapesForClaim, verifyRenderShape } from "@/lib/render-shapes";

// codex round 2 on ask-dev — every finding EXECUTED by the reviewer, and
// every one re-run here by this lane before being ledgered CONFIRMED.
//
// Round 1's theme was "the renderer fails open". Round 2's is narrower and
// sharper: a DERIVED number is still reaching a reader, and several
// structural rules acr enforces are still absent here, so a document acr
// would reject still renders.

function scoreSource(id = "team:a") {
    return { kind: "cohort_member_score" as const, subject_canonical_id: id };
}

function driverShape(a: number, b: number): RenderShape {
    return {
        shape_id: "rs_1",
        kind: "series",
        presentation: "stacked_bars",
        selected_by: "cohort_driver_contribution",
        title: "Score contribution by driver, per team",
        axis_kind: "category",
        axis_label: "team",
        value_label: "points contributed",
        series: [
            {
                key: "a",
                label: "A",
                points: [
                    {
                        label: "ops",
                        value: a,
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
                        value: b,
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
}

function trend(
    points: { label: string; claim: string; value: number; row?: number }[],
): RenderShape {
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
                points: points.map((p) => ({
                    label: p.label,
                    value: p.value,
                    source: {
                        kind: "claimed_fact_row",
                        claim_id: p.claim,
                        row_index: p.row ?? 0,
                        field: "v",
                    },
                })),
            },
        ],
    } as unknown as RenderShape;
}

function answer(facts: unknown[] = [], shapes: RenderShape[] = []): InvestigationResult {
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
                    drivers: [
                        {
                            signal: "a",
                            value: 1,
                            weight: 20,
                            weight_contributed: 20,
                            window: "current",
                        },
                        {
                            signal: "b",
                            value: 1,
                            weight: 20,
                            weight_contributed: 13.333333333333334,
                            window: "current",
                        },
                    ],
                },
            ],
        },
        claimed_facts: facts,
        render_shapes: shapes,
    } as unknown as InvestigationResult;
}

function fact(claimId: string, value: number, day = "2026-08-03") {
    return {
        claim_id: claimId,
        kind: "metrics",
        subject: { kind: "team", canonical_id: "team:a", label: "A" },
        field: "v",
        value: { number: value },
        rows: [{ fields: { day: { string: day }, v: { number: value } } }],
    };
}

describe("R2-1 — no DERIVED number reaches a reader, not even as an axis value", () => {
    it("prints no axis maximum for a stacked shape", () => {
        // The stack's height is a sum this component computed. Round 1
        // removed the total GLYPH; the same number was still exposed as the
        // y-axis maximum, exactly and in a <title>. A computed sum is not a
        // fact wherever it is printed.
        const { container } = render(
            <RenderShapeChart shape={driverShape(20, 13.333333333333334)} />,
        );
        expect(container.innerHTML).not.toContain("33.333333333333336");
        expect(container.innerHTML).not.toContain("33.33");
    });
});

describe("R2-2 — a mixed-source trend is withheld, never quietly dropped", () => {
    it("reports it as withheld for the claims it touches", () => {
        // Round 1 filtered by claim BEFORE verifying, so a trend citing A and
        // B matched neither and returned shapes:[] withheld:0 — which reads
        // as "acr selected nothing" and lets the heuristic chart draw. My own
        // round-1 test passed vacuously on 0+0<=1; this one cannot.
        const result = answer(
            [fact("claim_a", 1), fact("claim_b", 2, "2026-08-04")],
            [
                trend([
                    { label: "2026-08-03", claim: "claim_a", value: 1 },
                    { label: "2026-08-04", claim: "claim_b", value: 2 },
                ]),
            ],
        );
        const a = trendShapesForClaim(result, "claim_a");
        const b = trendShapesForClaim(result, "claim_b");
        expect(a.shapes).toHaveLength(0);
        expect(b.shapes).toHaveLength(0);
        expect(a.withheld + b.withheld).toBeGreaterThan(0);
    });

    it("suppresses the heuristic chart for the fact whose trend was refused", () => {
        const result = answer(
            [fact("claim_a", 1), fact("claim_b", 2, "2026-08-04")],
            [
                trend([
                    { label: "2026-08-03", claim: "claim_a", value: 1 },
                    { label: "2026-08-04", claim: "claim_b", value: 2 },
                ]),
            ],
        );
        const { container } = render(
            <FactRowsPanels facts={result.claimed_facts} result={result} />,
        );
        expect(container.querySelectorAll(".fact-chart")).toHaveLength(0);
    });
});

describe("R2-3 — an integer past 2^53 cannot be plotted faithfully", () => {
    // The wire value is 9007199254740993. It is NOT written as a literal
    // here: eslint's no-loss-of-precision rejects that literal outright,
    // which is itself the finding — by the time this value exists in JS it
    // is already 9007199254740992 and the original is unrecoverable.
    const UNSAFE = Number("9007199254740993");

    it("withholds a value beyond the exact-integer bound acr enforces", () => {
        const shape = {
            ...driverShape(UNSAFE, 1),
            presentation: "bars",
            selected_by: "cohort_attention_score",
            series: [
                {
                    key: "s",
                    label: "S",
                    points: [{ label: "ops", value: UNSAFE, source: scoreSource() }],
                },
            ],
        } as unknown as RenderShape;
        const result = answer();
        result.cohort!.members[0]!.score = UNSAFE;
        expect(verifyRenderShape(shape, result)).toBe(false);
    });
});

describe("R2-4 — duplicate claim ids are a malformed document, not a lookup race", () => {
    it("withholds a point citing a claim id that appears twice", () => {
        const result = answer(
            [fact("claim_dup", 1), fact("claim_dup", 2)],
            [
                trend([
                    { label: "2026-08-03", claim: "claim_dup", value: 1 },
                    { label: "2026-08-04", claim: "claim_dup", value: 1, row: 0 },
                ]),
            ],
        );
        expect(trendShapesForClaim(result, "claim_dup").shapes).toHaveLength(0);
    });
});

describe("R2-5 — a time axis admits only real calendar dates", () => {
    it("withholds a label that Date.parse normalizes into a different day", () => {
        // 2026-02-30 parses and silently becomes 2026-03-02, which reorders
        // the line and reverses its apparent direction.
        const result = answer([fact("claim_a", 1, "2026-02-30")]);
        const shape = trend([
            { label: "2026-02-30", claim: "claim_a", value: 1 },
            { label: "2026-03-05", claim: "claim_a", value: 1 },
        ]);
        expect(verifyRenderShape(shape, result)).toBe(false);
    });
});

describe("R2-6 — a time axis is never drawn with category spacing", () => {
    it("withholds a time-axis shape whose presentation is not a line", () => {
        const shape = {
            ...trend([
                { label: "2026-01-01", claim: "claim_a", value: 1 },
                { label: "2026-12-01", claim: "claim_a", value: 1 },
            ]),
            presentation: "bars",
        } as unknown as RenderShape;
        expect(verifyRenderShape(shape, answer([fact("claim_a", 1)]))).toBe(false);
    });
});

describe("R2-8 — duplicate shape ids are refused", () => {
    it("withholds shapes that share an id", () => {
        const one = { ...driverShape(20, 13.333333333333334) };
        const two = { ...driverShape(20, 13.333333333333334) };
        const result = answer([], [one, two]);
        const selected = renderShapesFor(result, ["cohort_driver_contribution"]);
        expect(selected.shapes).toHaveLength(0);
        expect(selected.withheld).toBe(2);
    });
});

describe("R2-7 — the withheld notice does not claim the wrong reason", () => {
    it("does not say values mismatched when the shape was structurally invalid", () => {
        const shape = { ...driverShape(20, 13.333333333333334) };
        delete (shape as { presentation?: unknown }).presentation;
        const result = answer([], [shape]);
        render(<FactRowsPanels facts={[]} result={result} />);
        // Nothing to assert on FactRows here; the wording lives on the cohort
        // panel and is asserted there. This test exists to keep the reason
        // vocabulary honest if it ever moves.
        expect(renderShapesFor(result, ["cohort_driver_contribution"]).withheld).toBe(1);
    });
});
