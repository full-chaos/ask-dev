import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { validateContract } from "@/lib/acr/validate";
import type { InvestigationResult } from "@/lib/contracts";
import { servedShapeScenarios } from "@/test/fixtures/served-shapes";

afterEach(cleanup);

// CHAOS-12570: Ask Dev draws each measure's served unit. The word is ACR's `measure_unit:<unit>`
// label; with no word map nothing is drawn, never the raw token. The fixtures are the contract
// example through ACR's real declared units, selector, labels and encoder at 4eb93cf9
// (`served-shapes/generate-units.go.txt`).

const declared = servedShapeScenarios["measure-units"];
const labelsOff = servedShapeScenarios["measure-units-labels-off"];
const undeclared = servedShapeScenarios["measure-units-undeclared"];
const repository = servedShapeScenarios["measure-units-repository"];

const show = (result: InvestigationResult) =>
    render(<DeterministicAnswerView offersPresentation="popup" result={result} />);
const panel = (name: RegExp) => screen.getByRole("group", { name });
const workloadPanel = () => panel(/^workload · backlog size/iu);
const units = (root: HTMLElement) =>
    [...root.querySelectorAll('[data-testid="measure-unit"]')].map((node) => node.textContent);
const headerOf = (root: HTMLElement, word: string) =>
    // The FactTable only: a trend's screen-reader table also heads a column with the series' word.
    [...root.querySelectorAll("table.fact-table thead th")].find(
        (th) => th.firstChild?.textContent === word,
    ) as HTMLElement | undefined;
const tileOf = (root: HTMLElement, word: string) =>
    [...root.querySelectorAll(".tile")].find(
        (tile) => tile.querySelector(".tile__label")?.textContent === word,
    ) as HTMLElement | undefined;

describe("the fixtures (CHAOS-12570)", () => {
    it.each([
        ["measure-units", declared],
        ["measure-units-labels-off", labelsOff],
        ["measure-units-undeclared", undeclared],
        ["measure-units-repository", repository],
    ])("%s passes the result contract", (_, result) => {
        const verdict = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            result,
        );
        expect(verdict.errors ?? []).toEqual([]);
        expect(verdict.valid).toBe(true);
    });

    it("are the cases: served units with words, units with no words, no units", () => {
        const table = (result: InvestigationResult) =>
            result.claimed_facts.find(
                (claim) => claim.claim_id === "claim_workload_ask_dev_backlog",
            )!.table!;
        expect(table(declared).measure_units).toEqual([
            { measure: "backlog_size", unit: "count" },
            { measure: "forecast_p50_days", unit: "days" },
        ]);
        expect(declared.vocabulary_labels?.["measure_unit:count"]).toBe("count");
        expect(table(labelsOff).measure_units).toEqual(table(declared).measure_units);
        expect(labelsOff.vocabulary_labels ?? {}).toEqual({});
        expect(table(undeclared).measure_units).toBeUndefined();
    });
});

describe("a fact table header (CHAOS-12570)", () => {
    it("puts the served word under the column word, for a declared measure only", () => {
        show(declared);
        const root = workloadPanel();
        const backlog = headerOf(root, "Backlog size");
        expect(backlog).toBeDefined();
        expect(within(backlog!).getByTestId("measure-unit").textContent).toBe("count");
        expect(within(backlog!).getByTestId("measure-unit").className).toContain(
            "fact-table__unit",
        );
        const throughput = headerOf(root, "Mean throughput");
        expect(throughput).toBeDefined();
        expect(within(throughput!).queryByTestId("measure-unit")).toBeNull();
        expect(within(headerOf(root, "Team ID")!).queryByTestId("measure-unit")).toBeNull();
    });
});

describe("a one-row tile (CHAOS-12570)", () => {
    it("puts the served word after the value, and the value stays as served", () => {
        show(declared);
        const tile = tileOf(workloadPanel(), "Backlog size");
        expect(tile).toBeDefined();
        const value = tile!.querySelector(".tile__value")!;
        expect(value.firstChild?.textContent).toBe("12");
        expect(value.lastElementChild?.getAttribute("data-testid")).toBe("measure-unit");
        expect(value.lastElementChild?.textContent).toBe("count");
        const throughput = tileOf(workloadPanel(), "Mean throughput");
        expect(throughput!.querySelector(".tile__value")!.textContent).toBe("4.2");
        expect(within(throughput!).queryByTestId("measure-unit")).toBeNull();
    });
});

describe("a served ratio (CHAOS-12570)", () => {
    it("stays the served number, never a percent", () => {
        const result = structuredClone(declared);
        const claim = result.claimed_facts.find(
            (fact) => fact.claim_id === "claim_workload_ask_dev_backlog",
        )!;
        claim.table!.measure_units = [{ measure: "throughput_mean", unit: "ratio" }];
        (result.vocabulary_labels as Record<string, string>)["measure_unit:ratio"] = "ratio";
        show(result);
        const value = tileOf(workloadPanel(), "Mean throughput")!.querySelector(".tile__value")!;
        expect(value.firstChild?.textContent).toBe("4.2");
        expect(within(value as HTMLElement).getByTestId("measure-unit").textContent).toBe("ratio");
    });
});

describe("a fact chart (CHAOS-12570)", () => {
    it("states the served word as its y-axis caption", () => {
        // The repository's daily metrics with no server trend: the panel draws its own chart.
        const result = structuredClone(repository);
        result.render_shapes = [];
        show(result);
        const root = panel(/^metrics · Commits/u);
        const caption = within(root).getByTestId("fact-chart-unit");
        expect(caption.textContent).toBe("count");
        expect(caption.closest(".fact-chart__cell")).not.toBeNull();
    });

    it("states no caption for a measure the table declares no unit for", () => {
        const result = structuredClone(undeclared);
        result.render_shapes = [];
        show(result);
        expect(screen.queryAllByTestId("fact-chart-unit")).toEqual([]);
    });
});

describe("a dated_fact_trend shape (CHAOS-12570)", () => {
    const figure = (title: RegExp) =>
        screen
            .getAllByRole("figure")
            .find((node) => title.test(node.textContent ?? "")) as HTMLElement;

    it("puts the served word after value_label, from the unit of the measure its points cite", () => {
        show(declared);
        const trend = figure(/^Backlog size over time/u);
        expect(within(trend).getByTestId("render-shape-unit").textContent).toBe("count");
        const svg = trend.querySelector("svg")!;
        expect(svg.getAttribute("aria-label")).toBe(
            "Backlog size over time — Ask Dev: Backlog size (count) over day",
        );
        const marks = [...trend.querySelectorAll('g[role="img"]')].map((mark) =>
            mark.getAttribute("aria-label"),
        );
        expect(marks.length).toBe(3);
        for (const mark of marks) expect(mark).toMatch(/: \d+ Backlog size \(count\)$/u);
    });

    it("draws no unit for a trend whose table declares none", () => {
        show(declared);
        const trend = figure(/^Commits count over time/u);
        expect(within(trend).queryByTestId("render-shape-unit")).toBeNull();
        expect(trend.querySelector("svg")!.getAttribute("aria-label")).not.toContain("(");
    });
});

describe("a panel that stands for several claims (CHAOS-12570, codex r1 P2)", () => {
    // Two claims with byte-identical rows share one panel (CHAOS-4672). The panel's numbers are
    // every claim's, so a unit shows only when every claim declares the same one.
    const grouped = (siblingUnits: { measure: string; unit: "count" | "days" }[]) => {
        const result = structuredClone(declared);
        const claim = result.claimed_facts.find(
            (fact) => fact.claim_id === "claim_workload_ask_dev_backlog",
        )!;
        const sibling = structuredClone(claim);
        sibling.claim_id = "claim_workload_ask_dev_backlog_again";
        sibling.field = "throughput_mean";
        sibling.table!.measure_units = siblingUnits;
        delete sibling.time_series_rows;
        delete sibling.time_series_table;
        result.claimed_facts.push(sibling);
        return result;
    };

    it("is a schema-valid answer that groups the two claims into one panel", () => {
        const result = grouped([{ measure: "backlog_size", unit: "days" }]);
        const verdict = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            result,
        );
        expect(verdict.errors ?? []).toEqual([]);
        show(result);
        expect(within(workloadPanel()).getByTestId("fact-also-referenced")).toBeDefined();
    });

    it("draws no unit where the claims declare different units for a measure", () => {
        show(grouped([{ measure: "backlog_size", unit: "days" }]));
        const root = workloadPanel();
        expect(within(headerOf(root, "Backlog size")!).queryByTestId("measure-unit")).toBeNull();
        expect(within(tileOf(root, "Backlog size")!).queryByTestId("measure-unit")).toBeNull();
    });

    it("draws no unit where one of the claims declares none", () => {
        show(grouped([]));
        const root = workloadPanel();
        expect(within(headerOf(root, "Backlog size")!).queryByTestId("measure-unit")).toBeNull();
    });

    it("draws the unit where every claim declares the same one", () => {
        show(grouped([{ measure: "backlog_size", unit: "count" }]));
        const root = workloadPanel();
        expect(
            within(headerOf(root, "Backlog size")!).getByTestId("measure-unit").textContent,
        ).toBe("count");
    });
});

describe("no word, no unit (CHAOS-12570)", () => {
    it("draws nothing for a unit when the answer has no word map, never the raw token", () => {
        show(labelsOff);
        expect(screen.queryAllByTestId("measure-unit")).toEqual([]);
        expect(screen.queryAllByTestId("render-shape-unit")).toEqual([]);
        const trend = screen
            .getAllByRole("figure")
            .find((node) => /Backlog size over time/u.test(node.textContent ?? ""))!;
        expect(trend.querySelector("svg")!.getAttribute("aria-label")).not.toMatch(/\(count\)/u);
        expect(units(workloadPanel())).toEqual([]);
        // What a reader sees, whatever the markup: the served value and the column word, alone.
        const root = workloadPanel();
        // With no word map the column word is the generic path: "backlog size".
        expect(tileOf(root, "backlog size")!.querySelector(".tile__value")!.textContent).toBe("12");
        expect(headerOf(root, "backlog size")!.textContent).toBe("backlog size");
        expect(trend.textContent).not.toMatch(/\bcount\b/u);
    });

    it("draws no unit anywhere when no measure declares one", () => {
        show(undeclared);
        expect(screen.queryAllByTestId("measure-unit")).toEqual([]);
        expect(screen.queryAllByTestId("render-shape-unit")).toEqual([]);
        expect(screen.queryAllByTestId("fact-chart-unit")).toEqual([]);
    });
});
