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
        // (top-left, `y = yForValue(maxValue) - 4`) — the x-axis ticks this
        // defect is about all share ONE y (`height - 8` = 162 for
        // `MULTIPLE_HEIGHT`), regardless of which of the three text-anchor
        // values a given tick now uses (see the anchor test below).
        const xPositions = Array.from(cell.querySelectorAll('.fact-chart__axis-label[y="162"]'))
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

    /**
     * CHAOS-4672, found live: a MIDDLE-anchored label at the first/last tick
     * sits exactly at the chart's own left/right margin, so roughly half its
     * own text extends past that chart's viewBox — into the NEXT small-
     * multiples cell in the CSS grid. That is a second, distinct instance of
     * the reported collision (across a grid boundary, not within one
     * chart's ticks) that reducing the tick count alone does not fix: it
     * reproduced live even with 3 ticks. Anchoring the first label to grow
     * rightward and the last to grow leftward keeps both inside their own
     * chart regardless of tick count or grid gap.
     */
    it("anchors the first and last small-multiples tick label inward, never centered on the chart's own edge", () => {
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
        const ticks = Array.from(cell.querySelectorAll('.fact-chart__axis-label[y="162"]')).sort(
            (a, b) => Number(a.getAttribute("x")) - Number(b.getAttribute("x")),
        );
        expect(ticks.length).toBeGreaterThanOrEqual(3);
        expect(ticks[0]!.getAttribute("text-anchor")).toBe("start");
        expect(ticks.at(-1)!.getAttribute("text-anchor")).toBe("end");
        // Every INTERIOR tick keeps the original centered anchor.
        for (const tick of ticks.slice(1, -1)) {
            expect(tick.getAttribute("text-anchor")).toBe("middle");
        }
    });

    /**
     * CHAOS-4672 (codex round 1, EXECUTED repro): a full ISO timestamp axis
     * ("2026-01-01T12:34:56.000Z", 24 chars) still collided after the
     * tick-count and edge-anchor fixes — even 3 ticks' worth of 24-char text
     * does not fit a 300px small-multiples cell. The tick text shortens to
     * the calendar date; the mark's own accessible label keeps full
     * precision (nothing is lost, only the AXIS TICK is more compact).
     */
    it("shortens a full-timestamp axis tick to the calendar date, keeping full precision on the mark itself", () => {
        const rows = Array.from({ length: 90 }, (_, i) => {
            const iso = new Date(Date.UTC(2026, 0, 1 + i, 12, 34, 56)).toISOString();
            return row({ moment: { string: iso }, a: { integer: i }, b: { integer: i * 2 } });
        });
        const { container } = render(
            <FactChart
                axis={{ column: "moment", kind: "time" }}
                chartKind="line"
                rows={rows}
                seriesColumns={["a", "b"]}
            />,
        );
        const cell = container.querySelector(".fact-chart__cell")!;
        const ticks = Array.from(cell.querySelectorAll('.fact-chart__axis-label[y="162"]'));
        expect(ticks.length).toBeGreaterThanOrEqual(3);
        for (const tick of ticks) {
            expect(tick.textContent).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
        // Real minimum pixel gap, same threshold as the date-only test —
        // the actual defect codex found (still colliding at 24 chars).
        const xPositions = ticks.map((el) => Number(el.getAttribute("x"))).sort((a, b) => a - b);
        const gaps = xPositions.slice(1).map((x, i) => x - xPositions[i]!);
        expect(Math.min(...gaps)).toBeGreaterThanOrEqual(100);
        // Full precision, including the time component, is still exact on
        // the mark's own accessible title — never lost, only summarized on
        // the tick.
        const marks = container.querySelectorAll(".fact-chart__mark-group title");
        expect(Array.from(marks).some((t) => t.textContent?.includes("12:34:56"))).toBe(true);
    });
});
