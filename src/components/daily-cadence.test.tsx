import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { RenderShapeChart } from "@/components/RenderShapeChart";
import { validateContract } from "@/lib/acr/validate";
import type { InvestigationResult, RenderShape } from "@/lib/contracts";
import { servedShapeScenarios } from "@/test/fixtures/served-shapes";

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

// CHAOS-12571: with `cadence: "day"`, a missing day breaks the line. Each served point keeps its
// marker, and the missing day is never a point or a zero (North Star check 12). The fixtures are
// the contract example through ACR's real declared cadence, selector and encoder at 4eb93cf9
// (`served-shapes/generate-units.go.txt`): 28, 29 and 31 August, and 28, 29 and 30 August.

const missingDay = servedShapeScenarios["cadence-missing-day"];
const everyDay = servedShapeScenarios["cadence-every-day"];

const show = (result: InvestigationResult) =>
    render(<DeterministicAnswerView offersPresentation="popup" result={result} />);
const figure = (title: RegExp) =>
    screen.getAllByRole("figure").find((node) => title.test(node.textContent ?? "")) as HTMLElement;
/** Each drawn line, as the number of points it joins. */
const lines = (root: HTMLElement) =>
    [...root.querySelectorAll("polyline")].map(
        (line) => (line.getAttribute("points") ?? "").trim().split(/\s+/u).length,
    );
const markers = (root: HTMLElement) =>
    [...root.querySelectorAll('g[role="img"]')].map((mark) => mark.getAttribute("aria-label"));
/** The repository's daily metrics with no server trend: the panel draws its own chart. */
const panelChart = (result: InvestigationResult) => {
    const copy = structuredClone(result);
    copy.render_shapes = [];
    show(copy);
    return screen.getByRole("group", { name: /^metrics · commits/iu });
};
const metricsDays = (result: InvestigationResult, days: readonly string[]) => {
    const copy = structuredClone(result);
    const claim = copy.claimed_facts.find(
        (fact) => fact.claim_id === "claim_metrics_ask_dev_commits",
    )!;
    claim.rows!.forEach((row, index) => {
        row.fields["day"] = { string: days[index]! };
    });
    return copy;
};

describe("the fixtures (CHAOS-12571)", () => {
    it.each([
        ["cadence-missing-day", missingDay],
        ["cadence-every-day", everyDay],
    ])("%s passes the result contract", (_, result) => {
        const verdict = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            result,
        );
        expect(verdict.errors ?? []).toEqual([]);
        expect(verdict.valid).toBe(true);
    });

    it("are the cases: a daily table with 30 August missing, and one with every day", () => {
        const days = (result: InvestigationResult) => {
            const claim = result.claimed_facts.find(
                (fact) => fact.claim_id === "claim_workload_ask_dev_backlog",
            )!;
            expect(claim.time_series_table!.cadence).toBe("day");
            return claim.time_series_rows!.map((row) => row.fields["day"]!.string);
        };
        expect(days(missingDay)).toEqual(["2026-08-28", "2026-08-29", "2026-08-31"]);
        expect(days(everyDay)).toEqual(["2026-08-28", "2026-08-29", "2026-08-30"]);
    });
});

describe("a dated_fact_trend with cadence day (CHAOS-12571)", () => {
    it("breaks the line at the missing day, and every served point keeps its marker", () => {
        show(missingDay);
        const trend = figure(/^Backlog size over time/u);
        expect(lines(trend)).toEqual([2, 1]);
        const marks = markers(trend);
        expect(marks).toHaveLength(3);
        expect(marks.some((mark) => mark?.startsWith("2026-08-30"))).toBe(false);
    });

    it("never makes the missing day a row of the value table", () => {
        show(missingDay);
        const rows = [...figure(/^Backlog size over time/u).querySelectorAll("tbody tr")];
        expect(rows.map((row) => row.querySelector("th")?.textContent)).toEqual([
            "2026-08-28",
            "2026-08-29",
            "2026-08-31",
        ]);
    });

    it("joins every day when no day is missing", () => {
        show(everyDay);
        expect(lines(figure(/^Backlog size over time/u))).toEqual([3]);
    });

    it("joins as before with no cadence, whatever the gap", () => {
        // 3, 18 and 30 August, from a table that states no cadence.
        const noCadence = servedShapeScenarios["measure-units"];
        show(noCadence);
        expect(lines(figure(/^Commits count over time/u))).toEqual([3]);
    });
});

describe("a time line with a label one series has no point for (CHAOS-12571 keeps it)", () => {
    // Two series over three days, in the order ACR proves (the full series first); the second has
    // no point on the middle day. Its line breaks there, with or without a cadence: a missing
    // observation is a gap, never a join.
    const point = (label: string, value: number) => ({
        label,
        value,
        source: { kind: "claimed_fact_row" as const, claim_id: "c", row_index: 0, field: "f" },
    });
    const shape = {
        shape_id: "rs_gap",
        kind: "series",
        presentation: "line",
        selected_by: "dated_fact_trend",
        title: "Two series",
        axis_kind: "time",
        axis_label: "day",
        value_label: "value",
        series: [
            {
                key: "full",
                label: "Full",
                points: [point("2026-08-28", 2), point("2026-08-29", 2), point("2026-08-30", 2)],
            },
            { key: "gap", label: "Gap", points: [point("2026-08-28", 1), point("2026-08-30", 3)] },
        ],
    } as unknown as RenderShape;

    it.each([undefined, "day" as const])(
        "breaks the second line at the day it lacks, cadence %s",
        (cadence) => {
            const { container } = render(<RenderShapeChart cadence={cadence} shape={shape} />);
            const groups = [...container.querySelectorAll("svg > g")].filter(
                (group) => group.querySelector("polyline") !== null,
            ) as HTMLElement[];
            expect(groups.map(lines)).toEqual([[3], [1, 1]]);
        },
    );
});

describe("the fact panel chart with cadence day (CHAOS-12571)", () => {
    it("breaks the line at the missing day, and every served point keeps its marker", () => {
        const root = panelChart(missingDay);
        expect(lines(root)).toEqual([2, 1]);
        expect(markers(root)).toHaveLength(3);
    });

    it("joins every day when no day is missing", () => {
        expect(lines(panelChart(everyDay))).toEqual([3]);
    });

    it("joins as before and logs it when the rows do not keep the cadence", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const repeated = metricsDays(missingDay, ["2026-08-28", "2026-08-28", "2026-08-31"]);
        expect(lines(panelChart(repeated))).toEqual([3]);
        expect(warn).toHaveBeenCalled();
    });
});
