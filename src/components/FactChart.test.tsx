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
});
