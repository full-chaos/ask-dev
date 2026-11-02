import { afterEach, describe, expect, it, vi } from "vitest";

import { missingDayBreaks, shapeCadence, utcDayNumber } from "./cadence";
import type { InvestigationResult, RenderShape } from "./contracts";
import { servedShapeScenarios } from "@/test/fixtures/served-shapes";

// CHAOS-12571: with ACR's `cadence: "day"`, two served points more than one UTC day apart are not
// joined. Only what the render reads is mirrored: keys that do not keep the cadence join the line
// as before, and that is logged.

afterEach(() => {
    vi.restoreAllMocks();
});

const missingDay = servedShapeScenarios["cadence-missing-day"];
const trend = (result: InvestigationResult, title: string): RenderShape =>
    result.render_shapes!.find((shape) => shape.title.startsWith(title))!;

describe("utcDayNumber", () => {
    it("numbers a YYYY-MM-DD key by UTC day", () => {
        expect(utcDayNumber("2026-08-29")! - utcDayNumber("2026-08-28")!).toBe(1);
        expect(utcDayNumber("2026-03-01")! - utcDayNumber("2026-02-28")!).toBe(1);
        expect(utcDayNumber("2026-11-02")! - utcDayNumber("2026-10-31")!).toBe(2);
    });

    it("refuses anything that is not a calendar day written YYYY-MM-DD", () => {
        for (const key of [
            "2026-02-30",
            "2026-04-31",
            "2026-13-01",
            "2026-00-10",
            "0026-08-28",
            "2026-08-28T00:00:00Z",
            "2026-8-28",
            "x",
        ]) {
            expect(utcDayNumber(key)).toBeUndefined();
        }
    });
});

describe("missingDayBreaks", () => {
    const keys = ["2026-08-28", "2026-08-29", "2026-08-31"];

    it("joins as before with no cadence", () => {
        expect(missingDayBreaks(undefined, keys, "test")).toBeUndefined();
    });

    it("breaks between served days more than one UTC day apart, only there", () => {
        const breaks = missingDayBreaks("day", keys, "test")!;
        expect(breaks("2026-08-28", "2026-08-29")).toBe(false);
        expect(breaks("2026-08-29", "2026-08-31")).toBe(true);
        expect(breaks("2026-08-31", "2026-08-29")).toBe(true);
    });

    it.each([
        ["a key that is not YYYY-MM-DD", ["2026-08-28", "2026-08-29T00:00:00Z", "2026-08-31"]],
        ["a repeated day", ["2026-08-28", "2026-08-28", "2026-08-31"]],
        ["a day that does not exist", ["2026-02-28", "2026-02-30"]],
    ])("joins as before and logs it, for %s", (_, bad) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        expect(missingDayBreaks("day", bad, "the context")).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]![1]).toEqual({ context: "the context" });
    });

    it("logs nothing when the keys keep the cadence", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        missingDayBreaks("day", keys, "test");
        missingDayBreaks(undefined, ["not a day"], "test");
        expect(warn).not.toHaveBeenCalled();
    });
});

describe("shapeCadence", () => {
    it("reads the cadence of the table a trend's points cite", () => {
        expect(shapeCadence(trend(missingDay, "Backlog size"), missingDay)).toBe("day");
        expect(shapeCadence(trend(missingDay, "Commits count"), missingDay)).toBe("day");
    });

    it("reads the time_series table, not the claim's other table, for time_series_rows", () => {
        const result = structuredClone(missingDay);
        const claim = result.claimed_facts.find(
            (fact) => fact.claim_id === "claim_workload_ask_dev_backlog",
        )!;
        expect(claim.table!.cadence).toBeUndefined();
        expect(shapeCadence(trend(result, "Backlog size"), result)).toBe("day");
        delete claim.time_series_table!.cadence;
        claim.table!.cadence = "day";
        expect(shapeCadence(trend(result, "Backlog size"), result)).toBeUndefined();
    });

    it("gives none to a trend whose table states none", () => {
        const measureUnits = servedShapeScenarios["measure-units"];
        expect(shapeCadence(trend(measureUnits, "Commits count"), measureUnits)).toBeUndefined();
    });

    it("gives none to a shape a point of which is not a claimed-fact row", () => {
        const cohort = missingDay.render_shapes!.find(
            (shape) => shape.selected_by === "cohort_attention_score",
        )!;
        expect(shapeCadence(cohort, missingDay)).toBeUndefined();
    });
});
