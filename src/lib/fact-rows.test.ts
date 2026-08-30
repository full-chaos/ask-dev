import { describe, expect, it } from "vitest";

import type { ClaimedFact, ClaimedFactRow } from "@/lib/contracts";
import {
    cellText,
    cellValue,
    columnOrder,
    factRowTiles,
    factsWithRows,
    findRollupBasis,
    selectPresentation,
} from "@/lib/fact-rows";

function row(fields: ClaimedFactRow["fields"]): ClaimedFactRow {
    return { fields };
}

describe("cellValue / cellText", () => {
    it("unwraps every scalar variant", () => {
        expect(cellValue({ string: "x" })).toBe("x");
        expect(cellValue({ integer: 4 })).toBe(4);
        expect(cellValue({ number: 4.5 })).toBe(4.5);
        expect(cellValue({ boolean: true })).toBe(true);
        expect(cellValue({ null: true })).toBeNull();
    });

    it("renders a missing cell as an em dash, never a blank or 'undefined'", () => {
        expect(cellText(undefined)).toBe("—");
        expect(cellText({ null: true })).toBe("—");
        expect(cellText({ boolean: false })).toBe("false");
        expect(cellText({ integer: 7 })).toBe("7");
    });
});

describe("columnOrder", () => {
    it("returns first-seen order across rows that do not all share the same columns", () => {
        const rows = [row({ a: { integer: 1 }, b: { integer: 2 } }), row({ c: { integer: 3 } })];
        expect(columnOrder(rows)).toEqual(["a", "b", "c"]);
    });
});

describe("selectPresentation", () => {
    it("falls back to table for an empty row set", () => {
        expect(selectPresentation([])).toEqual({ mode: "table" });
    });

    it("falls back to table when no column is a usable axis (every column numeric)", () => {
        const rows = [
            row({ p50: { number: 12 }, p99: { number: 55 } }),
            row({ p50: { number: 14 }, p99: { number: 58 } }),
        ];
        expect(selectPresentation(rows)).toEqual({ mode: "table" });
    });

    it("falls back to table when there is an axis but no numeric column to plot", () => {
        const rows = [
            row({ team_name: { string: "Platform" } }),
            row({ team_name: { string: "Growth" } }),
        ];
        expect(selectPresentation(rows)).toEqual({ mode: "table" });
    });

    it("picks a LINE chart for an ISO-date axis plus a numeric column", () => {
        const rows = [
            row({ day: { string: "2026-08-20" }, pipelines_count: { integer: 38 } }),
            row({ day: { string: "2026-08-21" }, pipelines_count: { integer: 41 } }),
        ];
        const presentation = selectPresentation(rows);
        expect(presentation).toEqual({
            mode: "chart",
            chartKind: "line",
            axis: { column: "day", kind: "time" },
            seriesColumns: ["pipelines_count"],
            truncatedSeriesColumns: [],
        });
    });

    it("rejects a column that merely LOOKS like a date (shape matches, calendar does not)", () => {
        const rows = [
            row({ day: { string: "2026-99-99" }, count: { integer: 1 } }),
            row({ day: { string: "2026-13-40" }, count: { integer: 2 } }),
        ];
        // Neither `day` value is a real date, so it is not a time axis; it
        // is still a varying string column, so it falls back to ordinal —
        // but with only 2 rows and no other string column it still has an
        // axis to plot against.
        const presentation = selectPresentation(rows);
        expect(presentation.mode).toBe("chart");
        expect((presentation as { axis: { kind: string } }).axis.kind).toBe("ordinal");
    });

    it("rejects an out-of-range calendar date that Date.parse silently normalizes (2026-02-30)", () => {
        const rows = [
            // Date.parse("2026-02-30") normalizes to March 2 instead of
            // rejecting it — the round-trip check must catch this even
            // though shape and Date.parse both accept it (codex round 2).
            row({ day: { string: "2026-02-30" }, count: { integer: 1 } }),
            row({ day: { string: "2026-03-02" }, count: { integer: 2 } }),
        ];
        const presentation = selectPresentation(rows);
        expect(presentation.mode).toBe("chart");
        // Not a time axis: falls back to ordinal (the strings still vary).
        expect((presentation as { axis: { kind: string } }).axis.kind).toBe("ordinal");
    });

    it("rejects an out-of-range calendar date even inside a FULL timestamp (codex round 3)", () => {
        const rows = [
            // Date.parse("2026-02-30T10:00:00Z") ALSO silently normalizes to
            // March — round 2's fix only checked date-only values against
            // this failure mode; the time-suffixed shape needs the same
            // component-level validation.
            row({ day: { string: "2026-02-30T10:00:00Z" }, count: { integer: 1 } }),
            row({ day: { string: "2026-03-02T10:00:00Z" }, count: { integer: 2 } }),
        ];
        const presentation = selectPresentation(rows);
        expect(presentation.mode).toBe("chart");
        expect((presentation as { axis: { kind: string } }).axis.kind).toBe("ordinal");
    });

    it("accepts a real full timestamp with a non-UTC offset as a time axis", () => {
        const rows = [
            row({ day: { string: "2026-08-20T23:30:00-07:00" }, count: { integer: 1 } }),
            row({ day: { string: "2026-08-21T23:30:00-07:00" }, count: { integer: 2 } }),
        ];
        const presentation = selectPresentation(rows);
        expect(presentation.mode).toBe("chart");
        expect((presentation as { axis: { kind: string } }).axis.kind).toBe("time");
    });

    it("does not classify a column as a time axis when a row is missing the value entirely (falls back to ordinal, never index-spaced pseudo-time)", () => {
        const rows = [
            row({ day: { string: "2026-08-20" }, count: { integer: 1 } }),
            row({ count: { integer: 2 } }), // no `day` at all on this row
            row({ day: { string: "2026-08-22" }, count: { integer: 3 } }),
        ];
        // `day` fails the TIME classification (incomplete coverage), so it
        // is never plotted with index spacing under a false "elapsed time"
        // claim (codex round 2). It still varies across present rows, so
        // it remains usable as an honest ORDINAL/bar axis instead — the
        // same "blank label for a missing cell" behavior any other ordinal
        // column already has.
        const presentation = selectPresentation(rows);
        expect(presentation.mode).toBe("chart");
        expect((presentation as { axis: { column: string; kind: string } }).axis).toEqual({
            column: "day",
            kind: "ordinal",
        });
    });

    it("does not classify a column as a time axis when it mixes date-only and full-timestamp values (falls back to ordinal)", () => {
        const rows = [
            row({ day: { string: "2026-08-20" }, count: { integer: 1 } }),
            row({ day: { string: "2026-08-21T10:00:00Z" }, count: { integer: 2 } }),
        ];
        const presentation = selectPresentation(rows);
        expect(presentation.mode).toBe("chart");
        expect((presentation as { axis: { kind: string } }).axis.kind).toBe("ordinal");
    });

    it("still charts a numeric series that has an explicit null cell on some row (not a table fallback)", () => {
        const rows = [
            row({
                team_name: { string: "Platform" },
                commits_count: { integer: 61 },
            }),
            row({
                team_name: { string: "Growth" },
                commits_count: { null: true },
            }),
        ];
        const presentation = selectPresentation(rows);
        expect(presentation.mode).toBe("chart");
        expect((presentation as { seriesColumns: readonly string[] }).seriesColumns).toEqual([
            "commits_count",
        ]);
    });

    it("picks a BAR chart for a non-date string axis plus a numeric column", () => {
        const rows = [
            row({ team_name: { string: "Platform" }, commits_count: { integer: 61 } }),
            row({ team_name: { string: "Growth" }, commits_count: { integer: 24 } }),
        ];
        const presentation = selectPresentation(rows);
        expect(presentation).toEqual({
            mode: "chart",
            chartKind: "bar",
            axis: { column: "team_name", kind: "ordinal" },
            seriesColumns: ["commits_count"],
            truncatedSeriesColumns: [],
        });
    });

    it("prefers a human-readable *_name column over an opaque *_id column for the same dimension", () => {
        // Field order mirrors the real wire shape: Go's encoding/json sorts
        // map keys, so team_id reaches the client before team_name.
        const rows = [
            row({
                commits_count: { integer: 61 },
                team_id: { string: "team_platform_9f2a" },
                team_name: { string: "Platform" },
            }),
            row({
                commits_count: { integer: 24 },
                team_id: { string: "team_growth_c410" },
                team_name: { string: "Growth" },
            }),
        ];
        const presentation = selectPresentation(rows);
        expect(presentation.mode).toBe("chart");
        expect((presentation as { axis: { column: string } }).axis.column).toBe("team_name");
    });

    it("prefers a time axis over an ordinal one when both are present", () => {
        const rows = [
            row({
                team_name: { string: "Platform" },
                day: { string: "2026-08-20" },
                commits_count: { integer: 10 },
            }),
            row({
                team_name: { string: "Platform" },
                day: { string: "2026-08-21" },
                commits_count: { integer: 12 },
            }),
        ];
        const presentation = selectPresentation(rows);
        expect(presentation.mode).toBe("chart");
        expect((presentation as { axis: { column: string } }).axis.column).toBe("day");
    });

    it("treats an axis column that never varies as provenance, not an axis (falls back)", () => {
        const rows = [
            row({
                team_name: { string: "Platform" },
                day: { string: "2026-08-22" },
                commits_count: { integer: 61 },
            }),
            row({
                team_name: { string: "Growth" },
                day: { string: "2026-08-22" },
                commits_count: { integer: 24 },
            }),
        ];
        const presentation = selectPresentation(rows);
        // `day` is constant (a snapshot stamp) so it is skipped as an axis
        // candidate; `team_name` varies and wins instead — a BAR chart, not
        // a one-point line.
        expect(presentation).toEqual({
            mode: "chart",
            chartKind: "bar",
            axis: { column: "team_name", kind: "ordinal" },
            seriesColumns: ["commits_count"],
            truncatedSeriesColumns: [],
        });
    });

    it("caps charted series at MAX_CHART_SERIES (fixed hue order, never cycled) and reports the rest as truncated", () => {
        const rows = [
            row({
                team_name: { string: "Platform" },
                c1: { integer: 1 },
                c2: { integer: 2 },
                c3: { integer: 3 },
                c4: { integer: 4 },
                c5: { integer: 5 },
                c6: { integer: 6 },
                c7: { integer: 7 },
                c8: { integer: 8 },
                c9: { integer: 9 },
                c10: { integer: 10 },
            }),
            row({
                team_name: { string: "Growth" },
                c1: { integer: 1 },
                c2: { integer: 2 },
                c3: { integer: 3 },
                c4: { integer: 4 },
                c5: { integer: 5 },
                c6: { integer: 6 },
                c7: { integer: 7 },
                c8: { integer: 8 },
                c9: { integer: 9 },
                c10: { integer: 10 },
            }),
        ];
        const presentation = selectPresentation(rows);
        expect(presentation.mode).toBe("chart");
        const chart = presentation as {
            seriesColumns: readonly string[];
            truncatedSeriesColumns: readonly string[];
        };
        expect(chart.seriesColumns).toEqual(["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"]);
        expect(chart.truncatedSeriesColumns).toEqual(["c9", "c10"]);
    });

    it("plots every purely-numeric column as its own series, excluding the axis", () => {
        const rows = [
            row({
                day: { string: "2026-08-20" },
                pipelines_count: { integer: 38 },
                success_rate: { number: 0.86 },
            }),
            row({
                day: { string: "2026-08-21" },
                pipelines_count: { integer: 41 },
                success_rate: { number: 0.9 },
            }),
        ];
        const presentation = selectPresentation(rows);
        expect(presentation.mode).toBe("chart");
        expect((presentation as { seriesColumns: readonly string[] }).seriesColumns).toEqual([
            "pipelines_count",
            "success_rate",
        ]);
    });

    it("excludes a column with even one non-numeric value from the series set", () => {
        const rows = [
            row({
                day: { string: "2026-08-20" },
                note: { string: "rerun" },
                count: { integer: 1 },
            }),
            row({ day: { string: "2026-08-21" }, note: { integer: 2 }, count: { integer: 2 } }),
        ];
        const presentation = selectPresentation(rows);
        expect(presentation.mode).toBe("chart");
        expect((presentation as { seriesColumns: readonly string[] }).seriesColumns).toEqual([
            "count",
        ]);
    });
});

const SUBJECT = { kind: "project" as const, canonical_id: "project_ask_dev", label: "Ask Dev" };
const OTHER_SUBJECT = { kind: "project" as const, canonical_id: "project_atlas", label: "Atlas" };

function fact(overrides: Partial<ClaimedFact>): ClaimedFact {
    return {
        claim_id: "claim_default",
        kind: "metrics",
        subject: SUBJECT,
        field: "team_breakdown",
        value: { integer: 2 },
        ...overrides,
    };
}

describe("findRollupBasis", () => {
    it("finds the sibling rollup_basis claim on the same subject and kind", () => {
        const target = fact({ claim_id: "claim_breakdown" });
        const basis = fact({
            claim_id: "claim_basis",
            field: "rollup_basis",
            value: { string: "team_project_ownership_sum" },
        });
        expect(findRollupBasis([target, basis], target)).toBe("team_project_ownership_sum");
    });

    it("returns undefined when no sibling rollup_basis claim exists (an ordinary fact with rows)", () => {
        const target = fact({ claim_id: "claim_only" });
        expect(findRollupBasis([target], target)).toBeUndefined();
    });

    it("does not match a rollup_basis claim on a different subject", () => {
        const target = fact({ claim_id: "claim_breakdown" });
        const basisElsewhere = fact({
            claim_id: "claim_basis_other",
            field: "rollup_basis",
            subject: OTHER_SUBJECT,
            value: { string: "team_project_ownership_sum" },
        });
        expect(findRollupBasis([target, basisElsewhere], target)).toBeUndefined();
    });

    it("does not match a rollup_basis claim on a different kind", () => {
        const target = fact({ claim_id: "claim_breakdown" });
        const basisOtherKind = fact({
            claim_id: "claim_basis_other_kind",
            field: "rollup_basis",
            kind: "health",
            value: { string: "team_project_ownership_sum" },
        });
        expect(findRollupBasis([target, basisOtherKind], target)).toBeUndefined();
    });
});

describe("factsWithRows", () => {
    it("keeps only facts with a non-empty rows array", () => {
        const withRows = fact({ claim_id: "with_rows", rows: [row({ a: { integer: 1 } })] });
        const emptyRows = fact({ claim_id: "empty_rows", rows: [] });
        const noRows = fact({ claim_id: "no_rows" });
        expect(factsWithRows([withRows, emptyRows, noRows])).toEqual([withRows]);
    });
});

/**
 * CHAOS-4581: "key numbers as tiles" — the presentation-only pick of a
 * single-row fact's own numeric columns, never a computed value.
 */
describe("factRowTiles", () => {
    it("returns one tile per numeric column of a single-row fact, in column order", () => {
        const rows = [
            row({
                p50_duration_minutes: { number: 12.4 },
                team_name: { string: "Platform" },
                p99_duration_minutes: { number: 55.6 },
            }),
        ];
        expect(factRowTiles(rows)).toEqual([
            { label: "p50_duration_minutes", value: 12.4 },
            { label: "p99_duration_minutes", value: 55.6 },
        ]);
    });

    it("returns nothing for a multi-row fact — there is no single number to headline", () => {
        const rows = [
            row({ day: { string: "2026-08-01" }, count: { integer: 1 } }),
            row({ day: { string: "2026-08-02" }, count: { integer: 2 } }),
        ];
        expect(factRowTiles(rows)).toEqual([]);
    });

    it("returns nothing for an empty row set", () => {
        expect(factRowTiles([])).toEqual([]);
    });

    it("skips a non-numeric column even on a single-row fact", () => {
        const rows = [row({ team_name: { string: "Platform" } })];
        expect(factRowTiles(rows)).toEqual([]);
    });
});
