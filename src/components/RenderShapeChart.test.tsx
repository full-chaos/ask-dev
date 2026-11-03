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

/**
 * CHAOS-12838 (E8 AC-2): a LINE over a category axis. The time-axis line is pinned elsewhere; this is
 * the other axis acr may draw a line on. Served order is the order the reader sees: acr chose it, and
 * no live producer serves one yet, so a re-sort here would go unnoticed. Labels are served out of
 * alphabetical order on purpose ("web", "api", "ops"), and the second series has no point for "api".
 */
const categoryLine: RenderShape = {
    shape_id: "rs_category_line",
    kind: "series",
    presentation: "line",
    selected_by: "cohort_attention_score",
    title: "Attention score by repository",
    axis_kind: "category",
    axis_label: "repository",
    value_label: "attention score",
    series: [
        {
            key: "this_window",
            label: "This window",
            points: [
                {
                    label: "web",
                    value: 30,
                    source: { kind: "cohort_member_score", subject_canonical_id: "repo:gh:web" },
                },
                {
                    label: "api",
                    value: 12,
                    source: { kind: "cohort_member_score", subject_canonical_id: "repo:gh:api" },
                },
                {
                    label: "ops",
                    value: 25,
                    source: { kind: "cohort_member_score", subject_canonical_id: "repo:gh:ops" },
                },
            ],
        },
        {
            key: "last_window",
            label: "Last window",
            points: [
                {
                    label: "web",
                    value: 18,
                    source: { kind: "cohort_member_score", subject_canonical_id: "repo:gh:web" },
                },
                {
                    label: "ops",
                    value: 9,
                    source: { kind: "cohort_member_score", subject_canonical_id: "repo:gh:ops" },
                },
            ],
        },
    ],
};

describe("a line on a category axis (CHAOS-12838)", () => {
    const SERVED = ["web", "api", "ops"];

    const markX = (container: HTMLElement, label: string, series: string) =>
        Number(
            container
                .querySelector(`g[aria-label^="${label}, ${series}:"] circle`)
                ?.getAttribute("cx"),
        );

    it("keeps the served order in the value table, the axis and the marks", () => {
        const { container } = render(<RenderShapeChart shape={categoryLine} />);
        const table = screen.getByRole("table", { name: "Attention score by repository" });
        const rowHeads = within(table)
            .getAllByRole("rowheader")
            .map((cell) => cell.textContent);
        expect(rowHeads).toEqual(SERVED);

        const ticks = Array.from(
            container.querySelectorAll(
                'svg > text.fact-chart__axis-label[text-anchor="middle"] > title',
            ),
        ).map((title) => title.textContent);
        expect(ticks).toEqual(SERVED);

        const xs = SERVED.map((label) => markX(container, label, "This window"));
        expect(xs.every(Number.isFinite)).toBe(true);
        expect(xs).toEqual([...xs].sort((left, right) => left - right));
        expect(new Set(xs).size).toBe(SERVED.length);
    });

    it("shows a missing point as a gap: an em dash, no mark, and no line across it", () => {
        const { container } = render(<RenderShapeChart shape={categoryLine} />);
        const table = screen.getByRole("table", { name: "Attention score by repository" });
        const apiRow = within(table).getByRole("rowheader", { name: "api" }).closest("tr")!;
        expect(Array.from(apiRow.querySelectorAll("td")).map((cell) => cell.textContent)).toEqual([
            "12",
            "—",
        ]);

        expect(screen.queryByLabelText(/^api, Last window:/)).toBeNull();
        expect(screen.getByLabelText(/^web, Last window:/)).toBeInTheDocument();
        expect(screen.getByLabelText(/^ops, Last window:/)).toBeInTheDocument();

        // "Last window" has points at web and ops only: two one-point runs, never one line from web
        // to ops that would draw a value for api.
        const lastWindow = container.querySelector(
            'g[aria-label^="web, Last window:"]',
        )!.parentElement!;
        const runs = Array.from(lastWindow.querySelectorAll(":scope > polyline")).map(
            (line) => line.getAttribute("points")!.split(" ").length,
        );
        expect(runs).toEqual([1, 1]);

        // The full series is one unbroken line across all three served labels.
        const thisWindow = container.querySelector(
            'g[aria-label^="web, This window:"]',
        )!.parentElement!;
        const full = Array.from(thisWindow.querySelectorAll(":scope > polyline")).map(
            (line) => line.getAttribute("points")!.split(" ").length,
        );
        expect(full).toEqual([3]);
    });
});
