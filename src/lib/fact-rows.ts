/**
 * CHAOS-4355: table/chart selection for a claimed fact's OPTIONAL renderable
 * table (`ClaimedFact.rows`, CHAOS-4347).
 *
 * Pure functions only — no rendering, no I/O. The workbench never re-derives
 * a fact's own numbers; this module only decides HOW the rows the service
 * already sent should be laid out (table vs. chart) and reads the
 * `rollup_basis` sibling claim the producer emits alongside a rollup
 * (`devhealthfacts/metrics.go`'s project rollup), never computes one.
 */
import type { ClaimedFact, ClaimedFactRow, ScalarValue, SubjectRef } from "@/lib/contracts";

export type Cell = string | number | boolean | null;

/** Unwraps a closed-vocabulary `ScalarValue` to its JS primitive. */
export function cellValue(value: ScalarValue): Cell {
    if (value.string !== undefined) return value.string;
    if (value.integer !== undefined) return value.integer;
    if (value.number !== undefined) return value.number;
    if (value.boolean !== undefined) return value.boolean;
    return null;
}

/** Renders a cell for the table view. Never throws on a missing/null value. */
export function cellText(value: ScalarValue | undefined): string {
    if (value === undefined) return "—";
    const cell = cellValue(value);
    if (cell === null) return "—";
    if (typeof cell === "boolean") return cell ? "true" : "false";
    return String(cell);
}

/** Column names, first-seen order across every row (rows may not share every column). */
export function columnOrder(rows: readonly ClaimedFactRow[]): string[] {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const row of rows) {
        for (const key of Object.keys(row.fields)) {
            if (!seen.has(key)) {
                seen.add(key);
                order.push(key);
            }
        }
    }
    return order;
}

// ISO 8601 date or date-time — the shape every producer in this codebase
// emits for a "day" column (devhealthfacts, e.g. `toString(day)` off a
// ClickHouse `Date`), plus room for a full timestamp.
const ISO_DATE_PATTERN =
    /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const AXIS_NAME_HINTS = new Set(["day", "date", "time", "timestamp", "period", "week", "month"]);

function presentValues(rows: readonly ClaimedFactRow[], column: string): ScalarValue[] {
    const values: ScalarValue[] = [];
    for (const row of rows) {
        const cell = row.fields[column];
        if (cell !== undefined) values.push(cell);
    }
    return values;
}

/** True when every present value in `column` is a number/integer. Empty column is not numeric. */
function isNumericColumn(rows: readonly ClaimedFactRow[], column: string): boolean {
    const values = presentValues(rows, column);
    return values.length > 0 && values.every((v) => typeof cellValue(v) === "number");
}

/** True when every present value in `column` is a string matching an ISO date/date-time. */
function isTimeColumn(rows: readonly ClaimedFactRow[], column: string): boolean {
    const values = presentValues(rows, column);
    return (
        values.length > 0 &&
        values.every((v) => {
            const cell = cellValue(v);
            return typeof cell === "string" && ISO_DATE_PATTERN.test(cell);
        })
    );
}

/** True when every present value in `column` is a string (time-shaped or not). */
function isStringColumn(rows: readonly ClaimedFactRow[], column: string): boolean {
    const values = presentValues(rows, column);
    return values.length > 0 && values.every((v) => typeof cellValue(v) === "string");
}

/**
 * True when `column` takes at least two distinct present values. A column
 * pinned to one value (e.g. every row in a same-day snapshot repeating
 * `day: "2026-08-22"`) cannot discriminate rows, so it is provenance, not a
 * usable chart axis — plotting against it would collapse every point onto
 * one x position.
 */
function hasVariation(rows: readonly ClaimedFactRow[], column: string): boolean {
    const values = presentValues(rows, column).map((v) => cellValue(v));
    return new Set(values).size >= 2;
}

export type ChartAxis = { readonly column: string; readonly kind: "time" | "ordinal" };
export type ChartPresentation = {
    readonly mode: "chart";
    readonly chartKind: "line" | "bar";
    readonly axis: ChartAxis;
    readonly seriesColumns: readonly string[];
};
export type TablePresentation = { readonly mode: "table" };
export type FactRowsPresentation = ChartPresentation | TablePresentation;

/**
 * Table by default. A chart only when the row set has a time or ordinal
 * axis column PLUS at least one purely-numeric column to plot against it
 * (CHAOS-4355). A time-shaped axis (every value an ISO date/date-time)
 * renders as a line; any other single-valued string axis (e.g. a
 * `team_name` breakdown) renders as a bar chart. An axis candidate that
 * never varies across the row set (see `hasVariation`) is skipped — it
 * cannot discriminate rows, so it reads as provenance, not an axis. Ties
 * break toward the axis-name hint list, then first-seen column order —
 * both deterministic, so the same rows always pick the same presentation.
 */
export function selectPresentation(rows: readonly ClaimedFactRow[]): FactRowsPresentation {
    if (rows.length === 0) return { mode: "table" };
    const columns = columnOrder(rows);

    const candidates: ChartAxis[] = [];
    for (const column of columns) {
        if (!hasVariation(rows, column)) continue;
        if (isTimeColumn(rows, column)) {
            candidates.push({ column, kind: "time" });
        } else if (isStringColumn(rows, column)) {
            candidates.push({ column, kind: "ordinal" });
        }
    }
    if (candidates.length === 0) return { mode: "table" };

    const timeCandidates = candidates.filter((c) => c.kind === "time");
    const pool = timeCandidates.length > 0 ? timeCandidates : candidates;
    const hinted = pool.find((c) => AXIS_NAME_HINTS.has(c.column.toLowerCase()));
    const axis = hinted ?? pool[0]!;

    const seriesColumns = columns.filter(
        (column) => column !== axis.column && isNumericColumn(rows, column),
    );
    if (seriesColumns.length === 0) return { mode: "table" };

    return {
        mode: "chart",
        chartKind: axis.kind === "time" ? "line" : "bar",
        axis,
        seriesColumns,
    };
}

function sameSubject(a: SubjectRef, b: SubjectRef): boolean {
    return a.kind === b.kind && a.canonical_id === b.canonical_id;
}

/**
 * A rollup fact (e.g. a project's per-team metrics breakdown) carries its
 * `rollup_basis` as a SIBLING claim on the same subject/kind — never a
 * property of the fact itself (`devhealthfacts/metrics.go`'s
 * `readProjectMetrics`: `field: "rollup_basis"` alongside `field:
 * "team_breakdown"`). Returns undefined when no sibling exists, which is
 * expected for a non-rollup fact with rows (e.g. a straightforward daily
 * series) — the caption falls back to provenance in that case, it never
 * fabricates a basis string.
 */
export function findRollupBasis(
    allFacts: readonly ClaimedFact[],
    fact: ClaimedFact,
): string | undefined {
    for (const candidate of allFacts) {
        if (
            candidate.claim_id !== fact.claim_id &&
            candidate.kind === fact.kind &&
            candidate.field === "rollup_basis" &&
            sameSubject(candidate.subject, fact.subject)
        ) {
            const value = cellValue(candidate.value);
            if (typeof value === "string") return value;
        }
    }
    return undefined;
}

/** The claimed facts a per-fact panel actually renders: non-empty `rows` only. */
export function factsWithRows(facts: readonly ClaimedFact[]): ClaimedFact[] {
    return facts.filter((fact) => fact.rows !== undefined && fact.rows.length > 0);
}
