import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RenderShapeChart } from "@/components/RenderShapeChart";
import type { RenderShape } from "@/lib/contracts";

/**
 * CHAOS-4415: what the chart component draws, and what it refuses to draw.
 *
 * It never decides whether a chart is warranted and never computes a value —
 * acr did both. The properties worth pinning are therefore about honesty of
 * the drawing: every number is reachable without navigating SVG marks, a
 * missing observation is a gap and never a zero, and a kind this component
 * has no payload reader for draws nothing rather than something wrong.
 */

const bars: RenderShape = {
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
                    value: 46.7,
                    source: { kind: "cohort_member_score", subject_canonical_id: "team:gh:ops" },
                },
                {
                    label: "platform",
                    value: 21.4,
                    source: { kind: "cohort_member_score", subject_canonical_id: "team:gh:plat" },
                },
            ],
        },
    ],
};

const stacked: RenderShape = {
    shape_id: "rs_2",
    kind: "series",
    presentation: "stacked_bars",
    selected_by: "cohort_driver_contribution",
    title: "Score contribution by driver, per team",
    axis_kind: "category",
    axis_label: "team",
    value_label: "points contributed",
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
                        subject_canonical_id: "team:gh:ops",
                        signal: "readiness.coverage_gap",
                    },
                },
            ],
        },
        {
            key: "workload.forecast_pressure",
            label: "Workload forecast pressure",
            points: [
                // Deliberately NO point for ops-team's second team: the
                // family was not available for it, and the em-dash assertion
                // below is what proves that stays visible as absence.
                {
                    label: "platform",
                    value: 13.3,
                    source: {
                        kind: "cohort_driver_weight_contributed",
                        subject_canonical_id: "team:gh:plat",
                        signal: "workload.forecast_pressure",
                    },
                },
            ],
        },
    ],
};

describe("RenderShapeChart", () => {
    it("makes every plotted number reachable as a real table, not only as SVG", () => {
        // A chart is a claimed fact, and a fact a reader cannot get at is not
        // evidence. The accessible table carries the same numbers the marks do.
        render(<RenderShapeChart shape={bars} />);
        const table = screen.getByRole("table", { name: /Attention score by team/i });
        expect(table).toHaveTextContent("ops-team");
        expect(table).toHaveTextContent("46.7");
        expect(table).toHaveTextContent("21.4");
    });

    it("labels every mark with its own axis position and value", () => {
        render(<RenderShapeChart shape={bars} />);
        expect(
            screen.getByLabelText("ops-team, Attention score: 46.7 attention score"),
        ).toBeInTheDocument();
        expect(
            screen.getByLabelText("platform, Attention score: 21.4 attention score"),
        ).toBeInTheDocument();
    });

    it("shows an unmeasured series as an em dash, never as zero", () => {
        // "This family was not available for this team" and "this family
        // contributed nothing" are different claims. A 0 in the table, or a
        // zero-height segment, would state the second.
        render(<RenderShapeChart shape={stacked} />);
        const table = screen.getByRole("table", { name: /contribution by driver/i });
        expect(table).toHaveTextContent("—");
        expect(
            screen.queryByLabelText(/ops-team, Workload forecast pressure/),
        ).not.toBeInTheDocument();
    });

    it("names each series in a legend once there is more than one", () => {
        render(<RenderShapeChart shape={stacked} />);
        const legend = within(screen.getByTestId("render-shape-legend"));
        expect(legend.getByText("Readiness coverage gap")).toBeInTheDocument();
        expect(legend.getByText("Workload forecast pressure")).toBeInTheDocument();
    });

    it("draws NOTHING for a kind it has no payload reader for", () => {
        // acr declares all eight kinds so a consumer can switch exhaustively,
        // but only produces `series` today. Inventing a fallback drawing for a
        // payload this component has never seen is how a chart starts claiming
        // something the answer does not.
        const { container } = render(
            <RenderShapeChart shape={{ ...bars, kind: "sankey" } as unknown as RenderShape} />,
        );
        expect(container).toBeEmptyDOMElement();
    });
});
