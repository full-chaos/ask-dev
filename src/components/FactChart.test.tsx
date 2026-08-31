import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FactChart } from "@/components/FactChart";
import type { ClaimedFactRow } from "@/lib/contracts";

function row(fields: ClaimedFactRow["fields"]): ClaimedFactRow {
    return { fields };
}

describe("FactChart", () => {
    it("breaks the line into separate segments across a missing value, never implying continuity", () => {
        // Row 2 has no `count` value at all — a real gap, not a zero.
        const rows = [
            row({ day: { string: "2026-08-20" }, count: { integer: 10 } }),
            row({ day: { string: "2026-08-21" } }),
            row({ day: { string: "2026-08-22" }, count: { integer: 12 } }),
        ];
        const { container } = render(
            <FactChart
                axis={{ column: "day", kind: "time" }}
                chartKind="line"
                rows={rows}
                seriesColumns={["count"]}
            />,
        );
        // One point on each side of the gap: two segments, each carrying
        // exactly one point (never fused into one polyline across the
        // missing middle row) — and exactly 2 marks total, not 3, since
        // the missing row contributes no mark either.
        const polylines = container.querySelectorAll("polyline");
        expect(polylines.length).toBe(2);
        expect(container.querySelectorAll(".fact-chart__mark-group").length).toBe(2);
    });

    it("does not break the line when every row has a value (no false gaps)", () => {
        const rows = [
            row({ day: { string: "2026-08-20" }, count: { integer: 10 } }),
            row({ day: { string: "2026-08-21" }, count: { integer: 11 } }),
            row({ day: { string: "2026-08-22" }, count: { integer: 12 } }),
        ];
        const { container } = render(
            <FactChart
                axis={{ column: "day", kind: "time" }}
                chartKind="line"
                rows={rows}
                seriesColumns={["count"]}
            />,
        );
        expect(container.querySelectorAll("polyline").length).toBe(1);
    });

    it("gives the chart itself an accessible role and label", () => {
        const rows = [
            row({ day: { string: "2026-08-20" }, count: { integer: 10 } }),
            row({ day: { string: "2026-08-21" }, count: { integer: 11 } }),
        ];
        const { container } = render(
            <FactChart
                axis={{ column: "day", kind: "time" }}
                chartKind="line"
                rows={rows}
                seriesColumns={["count"]}
            />,
        );
        const svg = container.querySelector("svg")!;
        expect(svg.getAttribute("role")).toBe("img");
        expect(svg.getAttribute("aria-label")).toBeTruthy();
    });

    it("positions time-axis points by actual elapsed time, not evenly by index", () => {
        // Two points one day apart, one point 28 days after that — the
        // second gap should be roughly 28x wider than the first, not equal.
        const rows = [
            row({ day: { string: "2026-08-01" }, count: { integer: 1 } }),
            row({ day: { string: "2026-08-02" }, count: { integer: 2 } }),
            row({ day: { string: "2026-08-30" }, count: { integer: 3 } }),
        ];
        const { container } = render(
            <FactChart
                axis={{ column: "day", kind: "time" }}
                chartKind="line"
                rows={rows}
                seriesColumns={["count"]}
            />,
        );
        const points = container
            .querySelector("polyline")!
            .getAttribute("points")!
            .split(" ")
            .map((pair) => pair.split(",").map(Number));
        const [p1, p2, p3] = points as [number[], number[], number[]];
        const gap1 = p2[0]! - p1[0]!;
        const gap2 = p3[0]! - p2[0]!;
        expect(gap2).toBeGreaterThan(gap1 * 10);
    });

    /**
     * CHAOS-4672: the reported defect was two x-axis tick labels visually
     * overlapping in a small-multiples cell ("2026-08-02026-06-28" — two ISO
     * dates whose glyphs ran together). A small-multiples cell is 300px wide
     * (`MULTIPLE_WIDTH`, 12px margins each side); asserting a real minimum
     * pixel gap between adjacent tick label x-positions ties the test to the
     * actual defect (overlapping geometry), not just a tick count.
     */
    it("keeps small-multiples x-axis tick labels from colliding (real pixel gap, not just a lower count)", () => {
        // 90 daily rows — the "last 90 days" window shape the real rig hit
        // this on — with 2 numeric columns, which is what routes FactChart
        // into the small-multiples grid layout (`showTitle`/per-cell axis).
        const rows = Array.from({ length: 90 }, (_, i) => {
            const day = new Date(Date.UTC(2026, 4, 3 + i)).toISOString().slice(0, 10);
            return row({ day: { string: day }, a: { integer: i }, b: { integer: i * 2 } });
        });
        const { container } = render(
            <FactChart
                axis={{ column: "day", kind: "time" }}
                chartKind="line"
                rows={rows}
                seriesColumns={["a", "b"]}
            />,
        );
        const cell = container.querySelector(".fact-chart__cell")!;
        // `.fact-chart__axis-label` also names the y-scale's max-value label
        // (top-left, `text-anchor="start"`) — the x-axis ticks this defect
        // is about are the `text-anchor="middle"` ones along the bottom.
        const xPositions = Array.from(
            cell.querySelectorAll('.fact-chart__axis-label[text-anchor="middle"]'),
        )
            .map((el) => Number(el.getAttribute("x")))
            .sort((a, b) => a - b);
        expect(xPositions.length).toBeGreaterThanOrEqual(2);
        const gaps = xPositions.slice(1).map((x, i) => x - xPositions[i]!);
        // A 10-character ISO date at the panel's 10px axis-label font does
        // not fit inside a gap much narrower than 100px without adjacent
        // glyphs touching — the real rig's 5-tick layout (~69px gaps) is
        // exactly what collided.
        expect(Math.min(...gaps)).toBeGreaterThanOrEqual(100);
    });
});
