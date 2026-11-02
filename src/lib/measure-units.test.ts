import { describe, expect, it } from "vitest";

import type { InvestigationResult, RenderShape } from "./contracts";
import { declaredUnit, shapeMeasureUnit } from "./measure-units";
import { servedShapeScenarios } from "@/test/fixtures/served-shapes";

// CHAOS-12570: the unit of a measure is what ACR declared for it, on the table that holds the
// measure's rows. Nothing else gives one: not the field's name, not a neighbour's unit.

const declared = servedShapeScenarios["measure-units"];
const workload = (result: InvestigationResult) =>
    result.claimed_facts.find((claim) => claim.claim_id === "claim_workload_ask_dev_backlog")!;
const trend = (result: InvestigationResult, title: string): RenderShape =>
    result.render_shapes!.find((shape) => shape.title.startsWith(title))!;

describe("declaredUnit", () => {
    const table = workload(declared).table!;

    it("reads the unit a table declares for a measure", () => {
        expect(declaredUnit(table, "backlog_size")).toBe("count");
        expect(declaredUnit(table, "forecast_p50_days")).toBe("days");
    });

    it("gives no unit to a measure the table names but declares no unit for", () => {
        expect(table.measures).toContain("throughput_mean");
        expect(declaredUnit(table, "throughput_mean")).toBeUndefined();
    });

    it("gives no unit to a column that is not a declared measure, even with a unit entry", () => {
        const odd = structuredClone(table);
        odd.measure_units = [...(odd.measure_units ?? []), { measure: "team_id", unit: "count" }];
        expect(odd.key).toContain("team_id");
        expect(declaredUnit(odd, "team_id")).toBeUndefined();
    });

    it("gives no unit to a measure the table declares twice, even with one unit (codex r3 P2)", () => {
        const twice = structuredClone(table);
        twice.measure_units = [
            { measure: "backlog_size", unit: "count" },
            { measure: "backlog_size", unit: "days" },
        ];
        expect(declaredUnit(twice, "backlog_size")).toBeUndefined();
        twice.measure_units = [
            { measure: "backlog_size", unit: "count" },
            { measure: "backlog_size", unit: "count" },
        ];
        expect(declaredUnit(twice, "backlog_size")).toBeUndefined();
        expect(declaredUnit(twice, "forecast_p50_days")).toBeUndefined();
    });

    it("gives no unit with no table or no units", () => {
        expect(declaredUnit(undefined, "backlog_size")).toBeUndefined();
        expect(
            declaredUnit(
                workload(servedShapeScenarios["measure-units-undeclared"]).table,
                "backlog_size",
            ),
        ).toBeUndefined();
    });
});

describe("shapeMeasureUnit", () => {
    it("reads a trend's unit from the declaration of the table its points cite", () => {
        // `Backlog size` plots the time_series_rows, which time_series_table declares.
        const shape = trend(declared, "Backlog size");
        expect(shape.selected_by).toBe("dated_fact_trend");
        expect(shapeMeasureUnit(shape, declared)).toBe("count");
    });

    it("reads the time_series table, not the claim's other table, for time_series_rows", () => {
        const result = structuredClone(declared);
        const claim = workload(result);
        claim.table!.measure_units = [{ measure: "backlog_size", unit: "days" }];
        expect(shapeMeasureUnit(trend(result, "Backlog size"), result)).toBe("count");
        claim.time_series_table!.measure_units = [];
        expect(shapeMeasureUnit(trend(result, "Backlog size"), result)).toBeUndefined();
    });

    it("gives no unit to a trend whose table declares none", () => {
        expect(shapeMeasureUnit(trend(declared, "Commits count"), declared)).toBeUndefined();
    });

    it("gives no unit when two points of the shape cite measures of different units", () => {
        const result = structuredClone(declared);
        const shape = trend(result, "Backlog size");
        const claim = workload(result);
        claim.time_series_table!.measures = [
            ...(claim.time_series_table!.measures ?? []),
            "forecast_p50_days",
        ];
        claim.time_series_table!.measure_units = [
            { measure: "backlog_size", unit: "count" },
            { measure: "forecast_p50_days", unit: "days" },
        ];
        shape.series[0].points[0].source.field = "forecast_p50_days";
        expect(shapeMeasureUnit(shape, result)).toBeUndefined();
    });

    it("gives no unit to a shape a point of which is not a claimed-fact row", () => {
        const cohort = declared.render_shapes!.find(
            (shape) => shape.selected_by === "cohort_attention_score",
        )!;
        expect(shapeMeasureUnit(cohort, declared)).toBeUndefined();
    });

    it("gives no unit when one point cites a measure with no unit and the others one with a unit", () => {
        const result = structuredClone(declared);
        const shape = trend(result, "Backlog size");
        const table = workload(result).time_series_table!;
        expect(table.measures).toContain("throughput_mean");
        expect(table.measure_units?.map((entry) => entry.measure)).not.toContain("throughput_mean");
        shape.series[0].points[0].source.field = "throughput_mean";
        expect(shapeMeasureUnit(shape, result)).toBeUndefined();
    });

    it("gives no unit to a point that cites a claim's value, not one of its rows", () => {
        const result = structuredClone(declared);
        const shape = trend(result, "Backlog size");
        for (const point of shape.series[0].points) {
            (point.source as { kind: string }).kind = "claimed_fact_value";
        }
        expect(shapeMeasureUnit(shape, result)).toBeUndefined();
    });

    it("gives no unit to a shape with no points", () => {
        const shape = structuredClone(trend(declared, "Backlog size"));
        (shape as { series: unknown[] }).series = [];
        expect(shapeMeasureUnit(shape, declared)).toBeUndefined();
    });
});
