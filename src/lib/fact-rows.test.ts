import { describe, expect, it } from "vitest";

import type { ClaimedFact, ClaimedFactRow } from "@/lib/contracts";
import {
    cellText,
    cellValue,
    columnOrder,
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
        });
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
        });
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
        });
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
