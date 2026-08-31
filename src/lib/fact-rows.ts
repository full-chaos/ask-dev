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
// ClickHouse `Date`), plus room for a full timestamp. Captures the
// calendar-date digits (year/month/day) so `parseIsoDate` can validate them
// directly, independent of any time/offset suffix.
const ISO_DATE_PATTERN =
    /^(\d{4})-(\d{2})-(\d{2})([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const AXIS_NAME_HINTS = new Set(["day", "date", "time", "timestamp", "period", "week", "month"]);

/**
 * A row column may carry both an opaque identifier and a human-readable
 * label for the same dimension (e.g. `devhealthfacts/metrics.go`'s
 * `readProjectMetrics` row carries both `team_id` and `team_name`). Go's
 * `encoding/json` marshals a map's keys in SORTED order, so `team_id`
 * reaches the wire BEFORE `team_name` — first-seen column order alone would
 * pick the opaque id as the chart axis. A `*_name`/`*_label` column is
 * preferred over any other ordinal candidate; a `*_id`/`id` column is
 * deprioritized below a neutral one, so an axis is never an opaque
 * identifier when a readable alternative exists in the same row set
 * (codex round 1, CHAOS-4355).
 */
function ordinalAxisPreferenceScore(column: string): number {
    const lower = column.toLowerCase();
    if (
        lower === "name" ||
        lower === "label" ||
        lower.endsWith("_name") ||
        lower.endsWith("_label")
    ) {
        return 2;
    }
    if (lower === "id" || lower.endsWith("_id")) return 0;
    return 1;
}

/**
 * True when (year, month, day) is a real calendar date — `Date.UTC` itself
 * normalizes an out-of-range value instead of rejecting it (day 30 of
 * February rolls forward into March), so the constructed date's own
 * component getters are read back and compared against the input.
 */
function isValidCalendarDate(year: number, month: number, day: number): boolean {
    const constructed = new Date(Date.UTC(year, month - 1, day));
    return (
        constructed.getUTCFullYear() === year &&
        constructed.getUTCMonth() === month - 1 &&
        constructed.getUTCDate() === day
    );
}

/**
 * Parses an ISO date/date-time to epoch millis, or null if it does not
 * represent a real calendar date. The year/month/day are validated as
 * literal digits from the string via `isValidCalendarDate` — never by
 * round-tripping `Date.parse`'s own output through a UTC-based
 * re-serialization, which `Date.parse` itself would silently normalize
 * (`2026-02-30` becomes March 2) and which breaks for a value that carries
 * a non-UTC offset (its UTC calendar day can legitimately differ from the
 * literal date it names) — codex rounds 2 and 3, CHAOS-4355. This makes the
 * check correct for a bare date AND a full offset timestamp alike, by
 * validating the calendar digits directly instead of anything timezone-
 * shifted.
 */
export function parseIsoDate(value: string): number | null {
    const match = ISO_DATE_PATTERN.exec(value);
    if (match === null) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isValidCalendarDate(year, month, day)) return null;
    const millis = Date.parse(value);
    return Number.isNaN(millis) ? null : millis;
}

/** True when `value` carries a time component (a "T" or space time separator), not just a bare date. */
function hasTimeComponent(value: string): boolean {
    return /[T ]\d{2}:\d{2}/.test(value);
}

function presentValues(rows: readonly ClaimedFactRow[], column: string): ScalarValue[] {
    const values: ScalarValue[] = [];
    for (const row of rows) {
        const cell = row.fields[column];
        if (cell !== undefined) values.push(cell);
    }
    return values;
}

/**
 * True when every NON-NULL present value in `column` is a number/integer.
 * Empty (or all-null) column is not numeric. An explicit `{null: true}`
 * cell does not disqualify the column — the renderer already treats a null
 * value as a gap (same as an absent one), so requiring every row to carry a
 * number would force an unnecessary table fallback for a series that
 * legitimately has a hole in it (codex round 2, CHAOS-4355).
 */
function isNumericColumn(rows: readonly ClaimedFactRow[], column: string): boolean {
    const values = presentValues(rows, column)
        .map((v) => cellValue(v))
        .filter((v) => v !== null);
    return values.length > 0 && values.every((v) => typeof v === "number");
}

/**
 * True when EVERY row (not just every present value) carries `column` as a
 * string that parses as a real calendar date/date-time, all in the SAME
 * shape (all date-only, or all carrying a time component — never mixed).
 *
 * Both requirements exist because a time axis is POSITIONED by elapsed
 * time, not just labeled: a row silently missing the axis value would
 * otherwise degrade the whole chart to index spacing with no signal that
 * happened, and mixing a date-only value with a full offset timestamp in
 * one column makes a single elapsed-time scale ill-defined (a date-only
 * value parses as UTC midnight; a zoned timestamp does not) — CHAOS-4355,
 * codex round 2. Shape alone is also not enough for any one value
 * (`2026-99-99` matches the ISO pattern but is not a date; `2026-02-30`
 * parses but is not Feb 30), so this also rejects via `parseIsoDate`
 * (round 1 + round 2).
 */
function isTimeColumn(rows: readonly ClaimedFactRow[], column: string): boolean {
    if (rows.length === 0) return false;
    let sawTimeComponent: boolean | null = null;
    for (const r of rows) {
        const cell = r.fields[column];
        if (cell === undefined) return false;
        const value = cellValue(cell);
        if (typeof value !== "string" || parseIsoDate(value) === null) return false;
        const rowHasTime = hasTimeComponent(value);
        if (sawTimeComponent === null) sawTimeComponent = rowHasTime;
        else if (sawTimeComponent !== rowHasTime) return false;
    }
    return true;
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
    /**
     * Numeric columns that qualified for charting but were dropped past the
     * `MAX_CHART_SERIES` cap (fixed hue order, never cycled — dataviz
     * skill). Always shown in the accompanying table, never silently
     * dropped from the fact entirely (CHAOS-4355, codex round 1).
     */
    readonly truncatedSeriesColumns: readonly string[];
};
export type TablePresentation = { readonly mode: "table" };
export type FactRowsPresentation = ChartPresentation | TablePresentation;

/** Fixed categorical hue slots (`--series-1`..`--series-8`, dataviz skill palette) — never cycled. */
export const MAX_CHART_SERIES = 8;

/**
 * Table by default. A chart only when the row set has a time or ordinal
 * axis column PLUS at least one purely-numeric column to plot against it
 * (CHAOS-4355). A time-shaped axis (every value parses as a real ISO
 * date/date-time) renders as a line; any other single-valued string axis
 * (e.g. a `team_name` breakdown) renders as a bar chart.
 *
 * Axis selection: an axis candidate that never varies across the row set
 * (see `hasVariation`) is skipped — it cannot discriminate rows, so it
 * reads as provenance, not an axis. Among ordinal candidates, a
 * human-readable `*_name`/`*_label` column is preferred over an opaque
 * `*_id`/`id` column for the SAME row set (a producer commonly emits both,
 * e.g. `team_id` + `team_name`, and Go's `encoding/json` sorts map keys —
 * `team_id` reaches the wire first — so first-seen order alone would pick
 * the opaque id; codex round 1). Remaining ties break toward the
 * axis-name hint list, then first-seen column order — both deterministic,
 * so the same rows always pick the same presentation.
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
    let axis = hinted ?? pool[0]!;
    if (hinted === undefined && pool[0]!.kind === "ordinal") {
        // Pick the highest-scoring ordinal candidate (name-like > neutral >
        // id-like), first-seen order as the tiebreak.
        axis = [...pool].sort(
            (a, b) => ordinalAxisPreferenceScore(b.column) - ordinalAxisPreferenceScore(a.column),
        )[0]!;
    }

    const eligibleSeriesColumns = columns.filter(
        (column) => column !== axis.column && isNumericColumn(rows, column),
    );
    if (eligibleSeriesColumns.length === 0) return { mode: "table" };

    return {
        mode: "chart",
        chartKind: axis.kind === "time" ? "line" : "bar",
        axis,
        seriesColumns: eligibleSeriesColumns.slice(0, MAX_CHART_SERIES),
        truncatedSeriesColumns: eligibleSeriesColumns.slice(MAX_CHART_SERIES),
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
    const bases: string[] = [];
    for (const candidate of allFacts) {
        if (
            candidate.claim_id !== fact.claim_id &&
            candidate.kind === fact.kind &&
            candidate.field === "rollup_basis" &&
            sameSubject(candidate.subject, fact.subject)
        ) {
            const value = cellValue(candidate.value);
            if (typeof value === "string") bases.push(value);
        }
    }
    // EXACTLY one, or none. Two sibling bases for one subject is an ambiguous
    // document, and returning the first made the caption depend on the order
    // the service happened to serialize its claims in -- the same answer
    // could caption a table two different ways.
    //
    // This is the fourth instance of one rule that the render-shape lib
    // states once (see `hasDuplicate` in render-shapes.ts): every identity
    // this view resolves BY must be unique, everywhere it is resolved. It
    // predates that lib, which is exactly why it was missed -- the rule was
    // applied where a reviewer pointed rather than everywhere it holds.
    return bases.length === 1 ? bases[0] : undefined;
}

/** The claimed facts a per-fact panel actually renders: non-empty `rows` only. */
export function factsWithRows(facts: readonly ClaimedFact[]): ClaimedFact[] {
    return facts.filter((fact) => fact.rows !== undefined && fact.rows.length > 0);
}

/**
 * CHAOS-4672: a table-identity fingerprint for a claimed fact's `rows`.
 *
 * The producer attaches the WHOLE row table to every claim that cites it —
 * one measure names the claim's own `field`, but `rows` carries every
 * numeric column regardless (`devhealthfacts`' rollup pattern, same one
 * `findRollupBasis` above reads). Two claims whose `subject` + `kind` +
 * `rows` all match byte-for-byte are the SAME table cited twice, not two
 * tables — there is no separate wire-level table id (that is CHAOS-4627's
 * job; this ticket is the client-side dedupe that composes with it, per the
 * ticket's own sequencing note). `rows` reaches the client from Go's
 * `encoding/json`, which marshals a map's keys in SORTED order (the same
 * fact `ordinalAxisPreferenceScore`'s doc comment relies on), so the SAME
 * underlying table serializes identically on every claim that carries it —
 * `JSON.stringify` is a safe content fingerprint here, not a heuristic.
 */
export function tableIdentity(fact: ClaimedFact): string {
    return JSON.stringify([fact.subject.kind, fact.subject.canonical_id, fact.kind, fact.rows]);
}

export type FactGroup = {
    /** The first claim (first-seen order) to cite this table — its `kind`/`field` titles the panel. */
    readonly primary: ClaimedFact;
    /** Every OTHER claim citing the same table, first-seen order — referenced, never re-plotted. */
    readonly alsoClaims: readonly ClaimedFact[];
};

/**
 * CHAOS-4672: groups claims that cite the SAME table (`tableIdentity`) so a
 * shared table renders its chart/table exactly ONCE, not once per claim.
 * The group's `primary` is whichever claim reached the table FIRST, in the
 * order `facts` was given (the order the service emitted them) — the same
 * first-seen tiebreak this module already uses elsewhere (`columnOrder`,
 * `selectPresentation`'s axis pick), so the panel a reader sees is
 * deterministic from the answer alone, never from iteration order of a Map.
 * Callers pass `factsWithRows(facts)` — a fact with no rows has no table to
 * group by.
 */
export function groupFactsByTable(facts: readonly ClaimedFact[]): readonly FactGroup[] {
    const order: string[] = [];
    const groups = new Map<string, ClaimedFact[]>();
    for (const candidate of facts) {
        const key = tableIdentity(candidate);
        const existing = groups.get(key);
        if (existing === undefined) {
            order.push(key);
            groups.set(key, [candidate]);
        } else {
            existing.push(candidate);
        }
    }
    return order.map((key) => {
        const [primary, ...alsoClaims] = groups.get(key)!;
        return { primary: primary!, alsoClaims };
    });
}

export type FactRowTile = { readonly label: string; readonly value: Cell };

/**
 * "Key numbers as tiles" (CHAOS-4581's pop-up-card reference: elevated
 * cards, a headline, key numbers as tiles, detail behind expand/click).
 *
 * Presentation-only, like the rest of this module: a single-row fact — the
 * common shape for a project-status rollup (health/flow) — already carries
 * its numeric columns verbatim; this only picks OUT the ones a table would
 * otherwise bury one-per-row, in the SAME first-seen column order the table
 * uses. Nothing is computed, aggregated, or re-derived, and a multi-row fact
 * (a real series) returns no tiles — there is no single "the" number to
 * headline, and the table/chart above already carries that shape.
 */
export function factRowTiles(rows: readonly ClaimedFactRow[]): readonly FactRowTile[] {
    if (rows.length !== 1) return [];
    const row = rows[0]!;
    return columnOrder(rows)
        .filter((column) => isNumericColumn(rows, column))
        .map((column) => ({ label: column, value: cellValue(row.fields[column]!) }));
}
