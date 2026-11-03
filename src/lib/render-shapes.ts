/**
 * CHAOS-4415: reading the service's own conditional render shapes.
 *
 * acr now DECIDES which chart an answer warrants
 * (`internal/contextfabric/render_shapes.go`) and states the decision on the
 * wire as `result.render_shapes`. This module does not repeat that decision
 * and does not compute a single number: the Workbench is a read-only
 * consumer (README, "What this is"), and every value here is one acr already
 * put in the answer.
 *
 * What it DOES do is check. Each point names where in the same answer its
 * number came from, and `verifyRenderShape` resolves that source locally and
 * compares. acr validates the same thing before it serves, so a mismatch
 * here is not an expected condition — it means the answer disagrees with
 * itself, and this view is the last place to catch it. AGENTS.md's closing
 * line makes that a fail-closed obligation: this is the deterministic view
 * that must fail closed rather than mask an answer-quality failure. A shape
 * that fails is DROPPED, and `renderShapesFor` reports the drop so the panel
 * can say a chart was withheld rather than silently showing nothing.
 */
import type {
    ClaimedFact,
    ClaimedFactRow,
    Cohort,
    CohortMember,
    InvestigationResult,
    RenderShape,
    ScalarValue,
} from "./contracts";
import { aboutNoPerson, cellValue, parseIsoDate } from "./fact-rows";
import { nonBlank } from "./presentation";
import { isServedWordOrUnserved, type VocabularyLabels } from "./vocabulary-labels";

/** The selection rule that produced a shape (acr's closed vocabulary). */
export type RenderShapeRule = RenderShape["selected_by"];

/** Shapes the cohort ranking panel owns: the score bars and their breakdown. */
export const COHORT_SHAPE_RULES: readonly RenderShapeRule[] = [
    "cohort_attention_score",
    "cohort_driver_contribution",
];

/**
 * True when ACR selected a cohort chart for this answer. ACR selects on the question's frame, which
 * is not on the wire, so a real cohort answer can read `open` (CHAOS-11986 problem 1). A served
 * shape is ACR's own statement that a ranking is the answer, so it counts as intent. A shape that
 * then fails its check still counts: the panel says it was withheld, never a silent absence.
 */
export function servesCohortShape(
    result: Pick<InvestigationResult, "render_shapes"> | undefined,
): boolean {
    return (result?.render_shapes ?? []).some((shape) =>
        COHORT_SHAPE_RULES.includes(shape.selected_by),
    );
}

export type VerifiedShapes = {
    /** Shapes whose every number resolved to the value its source names. */
    readonly shapes: readonly RenderShape[];
    /**
     * Count of shapes dropped because a number disagreed with its cited
     * source, or cited something this answer does not carry. Non-zero is an
     * answer-quality failure, never a routine outcome — it is surfaced, not
     * swallowed.
     */
    readonly withheld: number;
};

function numericCell(value: ScalarValue | undefined): number | undefined {
    if (value === undefined) return undefined;
    const cell = cellValue(value);
    return typeof cell === "number" ? cell : undefined;
}

/**
 * CHAOS-4682 (§5.1 P2 dual-read cutover): which array a `claimed_fact_row`
 * point resolves against. Mirrors acr's own `ContextFabricClaimedFact.
 * renderableRows` exactly — the additive `time_series_rows` pair whenever
 * non-empty (the only array acr's `datedFactTrendShape` ever addresses on a
 * dual-table fact), falling back to the legacy `rows` otherwise. This is not
 * a per-shape choice: it is the one deterministic rule every
 * `claimed_fact_row`-sourced point in the system already follows, so
 * resolving a `row_index` any other way would disagree with the answer that
 * cited it.
 */
export type RenderableRowsSource = "time_series_rows" | "rows";

export function renderableRowsSource(fact: ClaimedFact): RenderableRowsSource {
    return (fact.time_series_rows?.length ?? 0) > 0 ? "time_series_rows" : "rows";
}

function renderableRows(fact: ClaimedFact): readonly ClaimedFactRow[] {
    return renderableRowsSource(fact) === "time_series_rows"
        ? fact.time_series_rows!
        : (fact.rows ?? []);
}

/**
 * The rows of the ONE fact carrying `claimId`, or undefined.
 *
 * A duplicate claim id is a malformed document — acr rejects one outright —
 * and resolving it by picking a winner is how two readers of the same answer
 * see different numbers: this view took the first match while acr's own
 * resolver builds a map and would take the last (codex round 2). Neither is
 * more correct, which is the point: it is refused instead.
 */
function rowsFor(
    facts: readonly ClaimedFact[],
    claimId: string,
): readonly ClaimedFactRow[] | undefined {
    const matches = facts.filter((fact) => fact.claim_id === claimId);
    return matches.length === 1 ? renderableRows(matches[0]!) : undefined;
}

/**
 * Resolves ONE point source against the answer, returning the number the
 * source names, or undefined when it names nothing this answer carries.
 *
 * Mirrors acr's `renderShapeSources.resolve` case for case. It is
 * deliberately a resolver and not a validator of address shape: acr already
 * rejects a malformed address, and duplicating that rule here would create a
 * second place for it to drift.
 */
/**
 * True when a source's ADDRESS fields match its own kind.
 *
 * Mirrors acr's `validateRenderPointSourceShape`, which rejects e.g. a
 * `cohort_member_score` carrying a driver `signal`. The published JSON Schema
 * requires only `kind`, so a payload acr would never emit still validates
 * upstream and reaches here; the address IS the provenance, so a
 * contradictory one is refused rather than resolved on the fields that
 * happen to be usable (codex round 1, P2).
 */
function sourceAddressMatchesKind(
    source: RenderShape["series"][number]["points"][number]["source"],
): boolean {
    const has = (value: string | number | undefined) => value !== undefined;
    switch (source.kind) {
        case "cohort_member_score":
            return (
                has(source.subject_canonical_id) &&
                !has(source.signal) &&
                !has(source.claim_id) &&
                !has(source.row_index) &&
                !has(source.field)
            );
        case "cohort_driver_weight_contributed":
            return (
                has(source.subject_canonical_id) &&
                has(source.signal) &&
                !has(source.claim_id) &&
                !has(source.row_index) &&
                !has(source.field)
            );
        case "claimed_fact_row":
        case "claimed_fact_table_row":
            return (
                has(source.claim_id) &&
                has(source.row_index) &&
                has(source.field) &&
                !has(source.subject_canonical_id) &&
                !has(source.signal)
            );
        case "claimed_fact_value":
        case "claimed_fact_forecast_summary":
            return (
                has(source.claim_id) &&
                has(source.field) &&
                !has(source.row_index) &&
                !has(source.subject_canonical_id) &&
                !has(source.signal)
            );
        default:
            return false;
    }
}

/**
 * The largest magnitude a plotted number may carry, mirroring acr's
 * `ContextFabricRenderPointExactIntegerBound`.
 *
 * Past 2^53 a double cannot tell adjacent integers apart, so a wire value of
 * 9007199254740993 is already 9007199254740992 by the time JSON.parse
 * returns — the original is unrecoverable here. acr refuses to emit such a
 * point; refusing to render one keeps the two ends agreeing instead of this
 * view silently showing a number the answer never carried (codex round 2).
 */
const EXACT_INTEGER_BOUND = 2 ** 53;

/** The most series a shape may hold, mirroring acr's `ContextFabricRenderSeriesMaxCount`. */
const SERIES_MAX_COUNT = 8;

/**
 * The one duplicate-identity rule, in one place.
 *
 * Everything this view resolves BY must be unique: a cohort member's
 * canonical id, a claim id, a shape id, a series key, a point label within a
 * series. acr rejects a duplicate of any of them, and a duplicate here is
 * worse than a rejection — it is a silent choice. This view took the FIRST
 * match while acr's resolvers build maps and take the last, so the same
 * answer could show two readers different numbers.
 *
 * It exists as a shared helper because the alternative kept failing: this
 * lane fixed duplicate CLAIM ids and left duplicate MEMBERS; fixed duplicate
 * shape ids on the cohort selector and left the trend selector; checked
 * duplicate point labels and left series keys. Three separate reviews, the
 * same defect each time, because each fix was applied to exactly the case
 * that was named. A rule that lives in one function cannot be half-applied.
 */
function hasDuplicate(values: readonly string[]): boolean {
    return new Set(values).size !== values.length;
}

/**
 * True when every label is a REAL calendar date, not merely one `Date.parse`
 * accepts.
 *
 * `Date.parse("2026-02-30")` succeeds and silently becomes 2026-03-02, which
 * reorders a line and can reverse its apparent direction (codex round 2).
 * `parseIsoDate` validates the calendar digits themselves — the same check
 * `fact-rows.ts` already applies before it will call an axis a time axis, so
 * the two selection paths cannot disagree about what a date is.
 */
/** True when every series' points are in strictly ascending time order. */
function everySeriesAscendsInTime(shape: RenderShape): boolean {
    for (const series of shape.series) {
        let previous: number | null = null;
        for (const point of series.points) {
            const at = parseIsoDate(point.label);
            if (at === null) return false;
            if (previous !== null && at <= previous) return false;
            previous = at;
        }
    }
    return true;
}

function everyLabelIsADate(shape: RenderShape): boolean {
    for (const series of shape.series) {
        for (const point of series.points) {
            if (parseIsoDate(point.label) === null) return false;
        }
    }
    return true;
}

/**
 * Every axis position in the shape.
 *
 * Deliberately derived from the SERIES rather than assumed: a series with no point at a label has a
 * real gap there (acr never emits a zero for an unmeasured member or family), so the axis is the
 * union of what the series actually carry, in the order acr sent them.
 *
 * Given the cohort, a label that cites a member takes that member's served `attention_rank`
 * (CHAOS-11986 problem 4). First-seen order alone moves a member down the axis when the first driver
 * family has no point for it. A label with no served rank keeps its place after the ranked ones. A
 * time axis cites no member, so it stays in the order acr proved.
 */
export function axisLabels(shape: RenderShape, cohort?: Cohort): readonly string[] {
    const ranks = new Map(
        (cohort?.members ?? []).map((member) => [
            member.subject.canonical_id,
            member.attention_rank,
        ]),
    );
    const rankOfLabel = new Map<string, number>();
    for (const series of shape.series) {
        for (const point of series.points) {
            if (rankOfLabel.has(point.label)) continue;
            const rank = ranks.get(point.source.subject_canonical_id ?? "");
            rankOfLabel.set(point.label, rank ?? Number.MAX_SAFE_INTEGER);
        }
    }
    return [...rankOfLabel.keys()].sort(
        (left, right) => rankOfLabel.get(left)! - rankOfLabel.get(right)!,
    );
}

/** The rule of a fact's part-of-whole chart: its panel draws it, through the host (CHAOS-12496). */
export const THEME_SHARE_RULE: RenderShapeRule = "investment_theme_share";

/** The rule of a completion curve: its fact's panel draws it, through the host (CHAOS-4613). */
export const COMPLETION_FORECAST_RULE: RenderShapeRule = "completion_forecast";

/** The rules whose shape belongs to the panel of a fact it cites. */
export const FACT_PANEL_RULES: readonly RenderShapeRule[] = [
    "dated_fact_trend",
    THEME_SHARE_RULE,
    "investment_repository_flow",
    COMPLETION_FORECAST_RULE,
];

/**
 * The rule of the forecast percentiles table: its own panel draws it, with no host chart. acr serves
 * it only when no curve is drawn (CHAOS-4613).
 */
export const FORECAST_PERCENTILES_RULE: RenderShapeRule = "completion_forecast_percentiles";

/** The rule of a side-by-side table: its own panel draws it, with no host chart (CHAOS-12513). */
export const COMPARISON_RULE: RenderShapeRule = "comparison_side_by_side";

/** The one claim an id names. Two claims of one id name none (see `hasDuplicate`). */
function claimFor(facts: readonly ClaimedFact[], claimId: string | undefined) {
    const matches = facts.filter((fact) => fact.claim_id === claimId);
    return matches.length === 1 ? matches[0] : undefined;
}

/**
 * True when a table compares: mirrors acr's `validateComparisonShape`. Each series is one subject
 * and holds only that subject's claims, the subjects are of one kind, a label is one measure on
 * every side, and at least one measure stands on every side. A measure a side lacks has no point,
 * so its cell stays empty, never zero. Rows mix measures, so the shape declares no unit.
 *
 * Two clauses differ from acr's:
 * - A label is the served word of its field. ask-dev keeps no copy of acr's word map (CHAOS-4690),
 *   so a label is held to the answer's own `fact_field` word where the answer serves one
 *   (`isServedWordOrUnserved`, CHAOS-12697), and is otherwise trusted to acr's validator. It also
 *   holds one label, one field, on every side. The series words (subject labels) and the axis
 *   words are not vocabulary words, so they are not checked here.
 * - No side is a person: individual views are single-person (AGENTS.md).
 */
function isSideBySide(
    shape: RenderShape,
    facts: readonly ClaimedFact[],
    labels: VocabularyLabels,
): boolean {
    if (shape.kind !== "table" || shape.axis_kind !== "category") return false;
    if (shape.presentation !== undefined || shape.value_unit !== undefined) return false;
    if (shape.series.length < 2) return false;
    const subjectKinds = new Set<string>();
    const measures = new Map<string, string>();
    const sides = new Map<string, number>();
    for (const series of shape.series) {
        // The label names the column. With none, a reader cannot tell whose the values are.
        if (nonBlank(series.label) === undefined) return false;
        for (const { label, source } of series.points) {
            if (source.kind !== "claimed_fact_value") return false;
            const claim = claimFor(facts, source.claim_id);
            if (claim === undefined || claim.subject.canonical_id !== series.key) return false;
            if (!aboutNoPerson(claim)) return false;
            if (!isServedWordOrUnserved(labels, "fact_field", claim.field, label)) return false;
            subjectKinds.add(claim.subject.kind);
            const measure = JSON.stringify([claim.kind, claim.field]);
            if ((measures.get(label) ?? measure) !== measure) return false;
            measures.set(label, measure);
            sides.set(label, (sides.get(label) ?? 0) + 1);
        }
    }
    return subjectKinds.size === 1 && [...sides.values()].includes(shape.series.length);
}

/** A claim's completion forecast summary (CHAOS-4613): set by acr, never by the model. */
export type CompletionForecastSummary = NonNullable<ClaimedFact["completion_forecast"]>;

/** The forecast's table, mirroring acr's `ContextFabricRenderForecast*Field`. */
const FORECAST_TABLE_FIELD = "completion_distribution";
const FORECAST_AXIS_FIELD = "completion_days";
const FORECAST_SHARE_FIELD = "cumulative_share";
const FORECAST_RUNS_FIELD = "runs";

/** The summary's numeric fields a point may cite, mirroring acr's `ClaimedCompletionForecast.Number`. */
const SUMMARY_NUMBER_FIELDS = [
    "forecast_p50_days",
    "forecast_p85_days",
    "forecast_p95_days",
    "simulation_count",
    "horizon_days",
    "unfinished_runs",
] as const;
type SummaryNumberField = (typeof SUMMARY_NUMBER_FIELDS)[number];

/** The percentiles a percentiles table states, mirroring acr's `ContextFabricForecastPercentileLabel`. */
const PERCENTILE_FIELDS: readonly string[] = [
    "forecast_p50_days",
    "forecast_p85_days",
    "forecast_p95_days",
];

/** A summary's number for a field, or undefined when it carries none. An absent value is not 0. */
function summaryNumber(
    summary: CompletionForecastSummary | undefined,
    field: string | undefined,
): number | undefined {
    if (summary === undefined || !SUMMARY_NUMBER_FIELDS.includes(field as SummaryNumberField)) {
        return undefined;
    }
    const value = summary[field as SummaryNumberField];
    return typeof value === "number" ? value : undefined;
}

/** True when a claim's `rows` are its declared completion distribution: acr's `holdsCompletionDistribution`. */
function holdsCompletionDistribution(fact: ClaimedFact): boolean {
    const table = fact.table;
    return (
        table?.field === FORECAST_TABLE_FIELD &&
        table.shape === "distribution" &&
        table.key.length === 1 &&
        table.key[0] === FORECAST_AXIS_FIELD &&
        (table.measures ?? []).includes(FORECAST_SHARE_FIELD)
    );
}

/**
 * True when a forecast is the WHOLE completion distribution of ONE claim, in order. Mirrors acr's
 * `validateForecastShape` clause by clause: a category axis and a `ratio` unit; one series,
 * `cumulative_share`; a claim whose rows are its declared distribution and whose summary says the
 * distribution is `available` and gives the horizon; not every share 0 (no run finished is no curve,
 * never a flat 0% line); every row once, in row order, each point labelled with its own row's
 * completion day; and a day at or past the horizon only as the last point.
 */
function isCompletionCurve(shape: RenderShape, facts: readonly ClaimedFact[]): boolean {
    // A category axis: a time axis needs the line presentation (`verifyRenderShape`'s own check),
    // and a forecast has none.
    if (shape.kind !== "forecast" || shape.presentation !== undefined) return false;
    if (shape.value_unit !== "ratio") return false;
    if (shape.series.length !== 1 || shape.series[0].key !== FORECAST_SHARE_FIELD) return false;
    const points = shape.series[0].points;
    const claimId = points[0]?.source.claim_id;
    const fact = claimFor(facts, claimId);
    if (fact === undefined || !holdsCompletionDistribution(fact)) return false;
    const summary = fact.completion_forecast;
    if (summary?.state !== "available") return false;
    const horizon = summary.horizon_days;
    if (horizon === undefined) return false;
    if (points.every((point) => point.value === 0)) return false;
    const rows = fact.rows ?? [];
    if (points.length !== rows.length) return false;
    return points.every(({ label, source }, index) => {
        if (source.kind !== "claimed_fact_table_row" || source.claim_id !== claimId) return false;
        if (source.field !== FORECAST_SHARE_FIELD || source.row_index !== index) return false;
        const day = rows[index]?.fields[FORECAST_AXIS_FIELD]?.integer;
        if (day === undefined || label !== String(day)) return false;
        return day < horizon || index === points.length - 1;
    });
}

/**
 * The stored forecast a claim states: its team and its summary's work scope. Mirrors acr's
 * `ContextFabricForecastScope`. Two claims of one fact state one forecast.
 */
function forecastScope(fact: ClaimedFact, summary: CompletionForecastSummary): string {
    return `${fact.subject.canonical_id}\u0000${summary.work_scope_id ?? ""}`;
}

/**
 * True when a percentiles table restates its forecasts' P50/P85/P95 days: mirrors acr's
 * `validateForecastPercentilesShape`. Each series restates one claim, which carries a forecast
 * summary; each point is one of that claim's percentiles cited to its summary; and one stored
 * forecast (team and work scope) has one series, whichever of its claims it cites. A percentile the
 * summary does not carry is no point. A table declares no unit and no presentation.
 *
 * A label is the served word of its percentile. ask-dev keeps no copy of acr's word map
 * (CHAOS-4690), so a label is held to the answer's own `fact_field` word where the answer serves one
 * (`isServedWordOrUnserved`, CHAOS-12697). acr serves words only for the fields an answer uses, so
 * today that is the P50 word; a P85 or P95 word, or any word with the labels flag off, stays
 * trusted to acr's validator. The series word (the subject's label) and the axis words are not
 * vocabulary words, so they are not checked here.
 */
function isForecastPercentiles(
    shape: RenderShape,
    facts: readonly ClaimedFact[],
    labels: VocabularyLabels,
): boolean {
    // A category axis, as for the curve: a time axis is refused by `verifyRenderShape`'s own check.
    if (shape.kind !== "table") return false;
    if (shape.presentation !== undefined || shape.value_unit !== undefined) return false;
    const scopes = new Set<string>();
    for (const series of shape.series) {
        let claimId: string | undefined;
        for (const { label, source } of series.points) {
            if (source.kind !== "claimed_fact_forecast_summary") return false;
            if (source.field === undefined || !PERCENTILE_FIELDS.includes(source.field)) {
                return false;
            }
            if (!isServedWordOrUnserved(labels, "fact_field", source.field, label)) return false;
            claimId ??= source.claim_id;
            if (source.claim_id !== claimId) return false;
        }
        const fact = claimFor(facts, claimId);
        const summary = fact?.completion_forecast;
        if (fact === undefined || summary === undefined) return false;
        const scope = forecastScope(fact, summary);
        if (scopes.has(scope)) return false;
        scopes.add(scope);
    }
    return true;
}

/**
 * What a host needs beside a verified forecast to draw it as the capacity page does (CHAOS-4613):
 * the claim's served summary and, for each point in order, its row's completion day, run count and
 * share. Every value is served on the claim the curve cites; nothing is computed. A run count the row
 * does not carry is absent, never 0.
 */
export type ForecastShapeDetail = {
    readonly kind: "forecast";
    readonly summary: CompletionForecastSummary;
    readonly rows: ReadonlyArray<{
        readonly day: number;
        readonly runs?: number;
        readonly cumulativeShare: number;
    }>;
};

/** The detail of a shape kind that needs one, for the host's slot. */
export type ShapeDetail = ForecastShapeDetail;

/**
 * The detail of a VERIFIED shape, or undefined when its kind needs none. Call it only on a shape
 * `verifyRenderShape` admitted: it reads the cells that check already proved.
 */
export function shapeDetail(
    shape: RenderShape,
    facts: readonly ClaimedFact[],
): ShapeDetail | undefined {
    if (shape.selected_by !== COMPLETION_FORECAST_RULE) return undefined;
    const fact = claimFor(facts, shape.series[0]?.points[0]?.source.claim_id);
    const summary = fact?.completion_forecast;
    if (fact === undefined || summary === undefined) return undefined;
    const rows = fact.rows ?? [];
    const detailRows: Array<ForecastShapeDetail["rows"][number]> = [];
    for (const [index, point] of shape.series[0].points.entries()) {
        const fields = rows[index]?.fields;
        const day = fields?.[FORECAST_AXIS_FIELD]?.integer;
        // Not a verified curve: no detail, so the host draws nothing it cannot cite.
        if (day === undefined) return undefined;
        const runs = fields?.[FORECAST_RUNS_FIELD]?.integer;
        detailRows.push({
            day,
            ...(runs === undefined ? {} : { runs }),
            cumulativeShare: point.value,
        });
    }
    return { kind: "forecast", summary, rows: detailRows };
}

/** The canonical themes are fixed (AGENTS.md), so a whole table holds this many rows. */
const INVESTMENT_THEME_COUNT = 5;

/**
 * True when a treemap is ALL the parts of ONE whole: one claim's declared `theme_breakdown` table,
 * every row once, every theme, the same measure, and a real split. Mirrors acr's
 * `validateTreemapShape`. A row left out makes it a different claim, a table with fewer themes was
 * cut by a budget, and one part above 0 says nothing the sentence does not.
 * `verifyRenderShape`'s own checks cover the rest of acr's clauses: a kind with no rule here, a time
 * axis, a point of another source kind, and a share below 0, which the `ratio` unit refuses.
 *
 * A label is the served word of its row's theme. ask-dev keeps no copy of acr's word map
 * (`ContextFabricInvestmentThemeLabel`, CHAOS-4690), so a label is held to the answer's own
 * `investment_theme` word where the answer serves one (`isServedWordOrUnserved`, CHAOS-12697), and
 * is otherwise trusted to acr's validator. The series word ("Share of effort") and the axis words
 * are not vocabulary words, so they are not checked here.
 */
function isThemeShareWhole(
    shape: RenderShape,
    facts: readonly ClaimedFact[],
    labels: VocabularyLabels,
): boolean {
    if (shape.kind !== "treemap" || shape.presentation !== undefined) return false;
    if (shape.series.length !== 1 || shape.value_unit !== "ratio") return false;
    const points = shape.series[0].points;
    const claimId = points[0]?.source.claim_id;
    const fact = claimFor(facts, claimId);
    if (fact === undefined) return false;
    // A claim with a time series resolves its rows to the series, not to this table.
    if (fact.table?.field !== "theme_breakdown" || (fact.time_series_rows?.length ?? 0) > 0) {
        return false;
    }
    const rows = fact.rows ?? [];
    if (points.length !== rows.length || rows.length !== INVESTMENT_THEME_COUNT) return false;
    const seen = new Set<number>();
    let above = 0;
    for (const { label, source, value } of points) {
        if (source.field !== "share") return false;
        if (source.claim_id !== claimId || source.row_index === undefined) return false;
        if (seen.has(source.row_index)) return false;
        seen.add(source.row_index);
        const theme = rows[source.row_index]?.fields.theme;
        const token = theme === undefined ? undefined : cellValue(theme);
        if (typeof token !== "string") return false;
        if (!isServedWordOrUnserved(labels, "investment_theme", token, label)) return false;
        if (value > 0) above += 1;
    }
    return above >= 2;
}

/** The rule of one team's repository → theme flow (CHAOS-12578): its fact's panel draws it, through the host. */
export const REPOSITORY_FLOW_RULE: RenderShapeRule = "investment_repository_flow";

/**
 * How far parts may add up from their whole, relative to the larger: acr's
 * `ContextFabricRenderShareSumTolerance`, the one number both ends hold a sum to.
 */
export const SHARE_SUM_TOLERANCE = 1e-12;

/** A sankey draws 2 to 64 repositories with effort: past 64 it is refused, never an "other" node. */
const REPOSITORY_FLOW_MIN_REPOSITORIES = 2;
const REPOSITORY_FLOW_MAX_REPOSITORIES = 64;

/** acr's `ContextFabricRepositoryCanonicalIDPrefix`: a sankey's left node is a repository, never a person. */
const REPOSITORY_ID_PREFIX = "repository:";

function partsSumToWhole(sum: number, whole: number): boolean {
    return Math.abs(sum - whole) <= SHARE_SUM_TOLERANCE * Math.max(Math.abs(sum), Math.abs(whole));
}

/** A claim's declared `repository_theme_breakdown` table: acr's `holdsRepositoryFlowTable`. */
function holdsRepositoryFlowTable(fact: ClaimedFact): boolean {
    const table = fact.table;
    if (table === undefined || (fact.time_series_rows?.length ?? 0) > 0) return false;
    if (table.field !== "repository_theme_breakdown" || table.shape !== "breakdown") return false;
    if (table.key.length !== 2 || table.key[0] !== "repository" || table.key[1] !== "theme") {
        return false;
    }
    return (
        (table.measures ?? []).includes("weighted_effort") &&
        (table.measures ?? []).includes("theme_weighted_effort") &&
        (table.observations ?? []).includes("repository_label")
    );
}

type FlowLink = { readonly word: string; readonly theme: string };

/**
 * True when a sankey is one team's effort flowing from its repositories to the themes: mirrors acr's
 * `validateSankeyShape` and `sankeyFlowsOf`. The points are ALL the links of ONE team claim's
 * declared table that carry effort, each under its own theme's series and labelled with its
 * repository's served word. A theme's links add up to the team's effort in that theme within
 * `SHARE_SUM_TOLERANCE`, and between 2 and 64 repositories carry effort.
 *
 * A theme left out leaves its links out, so the count of plotted links refuses it.
 *
 * A series label is the served word of its theme. ask-dev keeps no copy of acr's word map
 * (CHAOS-4690), so a label is held to the answer's own `investment_theme` word where the answer
 * serves one (`isServedWordOrUnserved`, CHAOS-12697), and is otherwise trusted to acr's validator.
 * A point's word is its row's served `repository_label` cell, held above; the axis words are not
 * vocabulary words, so they are not checked here. Each link is drawn once because a series holds one point per label and a point must sit
 * under its own theme. `verifyRenderShape`'s own checks cover the rest: exact values, the source's
 * address, and one label per position.
 */
function isRepositoryFlow(
    shape: RenderShape,
    facts: readonly ClaimedFact[],
    labels: VocabularyLabels,
): boolean {
    if (shape.kind !== "sankey" || shape.axis_kind !== "category") return false;
    if (shape.presentation !== undefined || shape.value_unit !== undefined) return false;
    const claimId = shape.series[0]?.points[0]?.source.claim_id;
    const fact = claimFor(facts, claimId);
    if (fact === undefined || !holdsRepositoryFlowTable(fact)) return false;
    // The flows are a team's investment: the table alone does not say what was measured, so a
    // claim of another kind carrying it is refused (codex r1 on #164).
    if (fact.kind !== "investment" || fact.subject.kind !== "team") return false;
    const words = new Map<string, string>();
    const themeEffort = new Map<string, number>();
    const linkedThemes = new Set<string>();
    const repositories = new Set<string>();
    const links: FlowLink[] = [];
    let linksWithEffort = 0;
    for (const { fields } of fact.rows ?? []) {
        const cell = (name: string) =>
            fields[name] === undefined ? undefined : cellValue(fields[name]);
        const [repository, word, theme] = [
            cell("repository"),
            cell("repository_label"),
            cell("theme"),
        ];
        const [effort, total] = [cell("weighted_effort"), cell("theme_weighted_effort")];
        if (
            typeof repository !== "string" ||
            typeof word !== "string" ||
            typeof theme !== "string"
        ) {
            return false;
        }
        if (typeof effort !== "number" || typeof total !== "number") return false;
        // No person node: every left node is a repository.
        if (!repository.startsWith(REPOSITORY_ID_PREFIX) || repository === REPOSITORY_ID_PREFIX) {
            return false;
        }
        if (nonBlank(word) === undefined) return false;
        if ((words.get(repository) ?? word) !== word) return false;
        words.set(repository, word);
        if (!(effort >= 0) || !(total >= 0)) return false;
        if ((themeEffort.get(theme) ?? total) !== total) return false;
        themeEffort.set(theme, total);
        links.push({ word, theme });
        if (effort > 0) {
            linksWithEffort += 1;
            linkedThemes.add(theme);
            repositories.add(repository);
        }
    }
    for (const [theme, total] of themeEffort) {
        if (total > 0 && !linkedThemes.has(theme)) return false;
    }
    if (
        repositories.size < REPOSITORY_FLOW_MIN_REPOSITORIES ||
        repositories.size > REPOSITORY_FLOW_MAX_REPOSITORIES
    ) {
        return false;
    }
    // No self link: no two nodes, repositories or themes, share a word.
    const nodeWords = new Set<string>();
    for (const repository of repositories) {
        const word = words.get(repository)!;
        if (nodeWords.has(word)) return false;
        nodeWords.add(word);
    }
    let plotted = 0;
    for (const series of shape.series) {
        if (!linkedThemes.has(series.key) || nonBlank(series.label) === undefined) return false;
        if (!isServedWordOrUnserved(labels, "investment_theme", series.key, series.label)) {
            return false;
        }
        if (nodeWords.has(series.label)) return false;
        nodeWords.add(series.label);
        let sum = 0;
        for (const { label, source, value } of series.points) {
            // The address check in `verifyRenderShape` holds the source's kind: a row index
            // belongs only to a claimed fact row.
            if (source.field !== "weighted_effort") return false;
            if (source.claim_id !== claimId || source.row_index === undefined) return false;
            const link = links[source.row_index];
            if (link === undefined || link.theme !== series.key || link.word !== label)
                return false;
            if (!(value > 0)) return false;
            sum += value;
            plotted += 1;
        }
        if (!partsSumToWhole(sum, themeEffort.get(series.key)!)) return false;
    }
    return plotted === linksWithEffort;
}

/** The rule of where teams stand on two landscape measures on one day (CHAOS-12623): its own panel draws it, through the host. */
export const LANDSCAPE_POSITION_RULE: RenderShapeRule = "landscape_position";

/**
 * The quadrant's one allowed field pair and its row (acr's `ContextFabricRenderLandscape*Field`):
 * raw values only, never a normalized coordinate, percentile or score.
 */
const LANDSCAPE_X_FIELD = "churn_loc_30d";
const LANDSCAPE_Y_FIELD = "delivery_units_30d";
const LANDSCAPE_TABLE_FIELD = "area_breakdown";
const LANDSCAPE_DAY_FIELD = "as_of_day";

/**
 * A quadrant point's team and day, when its claim is one a quadrant may plot: a stated landscape
 * claim of the series' field, about a team, whose one declared `area_breakdown` row (keyed
 * `as_of_day`) holds the point's value as its raw integer cell, and whose label is the point's.
 * Mirrors acr's `quadrantPointClaim` and `landscapeAreaRow`: the rows are the claim's `rows`, as acr
 * reads them.
 */
function landscapePointClaim(
    point: RenderShape["series"][number]["points"][number],
    field: string,
    facts: readonly ClaimedFact[],
): { readonly team: string; readonly day: string } | undefined {
    const { source } = point;
    if (source.kind !== "claimed_fact_value") return undefined;
    const claim = claimFor(facts, source.claim_id);
    if (claim === undefined || claim.field !== field) return undefined;
    if (claim.kind !== "landscape" || claim.subject.kind !== "team") return undefined;
    if (!(point.value >= 0)) return undefined;
    const { table } = claim;
    const rows = claim.rows ?? [];
    if (table?.field !== LANDSCAPE_TABLE_FIELD || rows.length !== 1) return undefined;
    if (table.key.length !== 1 || table.key[0] !== LANDSCAPE_DAY_FIELD) return undefined;
    const day = rows[0]!.fields[LANDSCAPE_DAY_FIELD]?.string;
    if (day === undefined || day === "") return undefined;
    // A field the table does not declare has no cell. The landscape measures are counts, so a cell
    // that is not an integer is refused, and the value is that cell, not only the claim's scalar.
    if (!(table.measures ?? []).includes(field)) return undefined;
    const cell = rows[0]!.fields[field]?.integer;
    if (typeof cell !== "number" || !Number.isInteger(cell) || cell !== point.value) {
        return undefined;
    }
    // The wire requires a subject label, so the team's label is its word: a chart never shows a
    // team's numbers under another name.
    if (point.label !== claim.subject.label) return undefined;
    return { team: claim.subject.canonical_id, day };
}

/**
 * True when a quadrant places teams on one day: mirrors acr's `validateQuadrantShape`. Two series, x
 * then y, keyed by the one allowed field pair; the same labels in the same order on both, at least 2
 * of them; each point a team claim's own raw cell; the x and y of one label about one team, and no
 * team two points; and every cited row names one `as_of_day`. A quadrant of different days places
 * teams that were never measured together.
 *
 * A series label is its field's served word, and is its axis's word. ask-dev keeps no copy of acr's
 * word map (CHAOS-4690), so each series word is held to the answer's own `fact_field` word where
 * the answer serves one (`isServedWordOrUnserved`, CHAOS-12697), and is otherwise trusted to acr's
 * validator. A point's word is its team's label, held in `landscapePointClaim`.
 * `verifyRenderShape`'s own checks cover the rest: exact values, the source's address, one
 * label per position, and a claim that is not derived.
 */
function isLandscapePosition(
    shape: RenderShape,
    facts: readonly ClaimedFact[],
    labels: VocabularyLabels,
): boolean {
    // A category axis: a time axis needs the line presentation (`verifyRenderShape`'s own check),
    // and a quadrant has none.
    if (shape.kind !== "quadrant") return false;
    if (shape.presentation !== undefined || shape.value_unit !== undefined) return false;
    const [x, y, ...more] = shape.series;
    if (x === undefined || y === undefined || more.length > 0) return false;
    if (x.key !== LANDSCAPE_X_FIELD || y.key !== LANDSCAPE_Y_FIELD) return false;
    if (nonBlank(x.label) === undefined || nonBlank(y.label) === undefined) return false;
    if (shape.axis_label !== x.label || shape.value_label !== y.label) return false;
    // The axis words equal the series words (above), so this holds all four.
    if (!isServedWordOrUnserved(labels, "fact_field", x.key, x.label)) return false;
    if (!isServedWordOrUnserved(labels, "fact_field", y.key, y.label)) return false;
    if (x.points.length < 2 || x.points.length !== y.points.length) return false;
    const placed = new Set<string>();
    let day: string | undefined;
    for (const [index, xPoint] of x.points.entries()) {
        const yPoint = y.points[index]!;
        if (xPoint.label !== yPoint.label) return false;
        const xClaim = landscapePointClaim(xPoint, x.key, facts);
        const yClaim = landscapePointClaim(yPoint, y.key, facts);
        if (xClaim === undefined || yClaim === undefined) return false;
        if (xClaim.team !== yClaim.team || placed.has(xClaim.team)) return false;
        placed.add(xClaim.team);
        day ??= xClaim.day;
        if (xClaim.day !== day || yClaim.day !== day) return false;
    }
    return true;
}

/**
 * True when a score bar stands on a ranking row: the member was ranked, has an outcome, and has at
 * least one driver to explain the score (check 8: never a bare score). The table withholds a score
 * with no driver, so the chart must not draw it (CHAOS-11986 problem 2). The score itself is
 * `resolvePointSource`'s check. ACR's validator refuses a score with no driver, so this guards an
 * answer ACR would never serve: a restored one, which is not validated.
 */
function standsOnRankingRow(member: CohortMember | undefined): boolean {
    return (
        member?.ranking_computed === true &&
        member.outcome !== undefined &&
        (member.drivers?.length ?? 0) > 0
    );
}

function everyScoreStandsOnARankingRow(shape: RenderShape, cohort: Cohort | undefined): boolean {
    return shape.series.every((series) =>
        series.points.every((point) =>
            standsOnRankingRow(
                cohort?.members.find(
                    (member) => member.subject.canonical_id === point.source.subject_canonical_id,
                ),
            ),
        ),
    );
}

function resolvePointSource(
    source: RenderShape["series"][number]["points"][number]["source"],
    cohort: Cohort | undefined,
    facts: readonly ClaimedFact[],
): number | undefined {
    switch (source.kind) {
        case "cohort_member_score": {
            const matches = (cohort?.members ?? []).filter(
                (candidate) => candidate.subject.canonical_id === source.subject_canonical_id,
            );
            if (matches.length !== 1) return undefined;
            const member = matches[0];
            // `score` is nullable on the wire and `null` is a real value
            // meaning "ranked, no score" — distinct from an absent member.
            // Neither can back a plotted bar.
            return member?.score ?? undefined;
        }
        case "cohort_driver_weight_contributed": {
            const members = (cohort?.members ?? []).filter(
                (candidate) => candidate.subject.canonical_id === source.subject_canonical_id,
            );
            if (members.length !== 1) return undefined;
            const drivers = (members[0]!.drivers ?? []).filter(
                (candidate) => candidate.signal === source.signal,
            );
            return drivers.length === 1 ? drivers[0]!.weight_contributed : undefined;
        }
        case "claimed_fact_row": {
            if (source.claim_id === undefined || source.row_index === undefined) return undefined;
            const rows = rowsFor(facts, source.claim_id);
            if (rows === undefined) return undefined;
            const row = rows[source.row_index];
            if (row === undefined || source.field === undefined) return undefined;
            return numericCell(row.fields[source.field]);
        }
        case "claimed_fact_table_row": {
            // Always the claim's `rows`, never its time series (acr's `tableRows`).
            if (source.row_index === undefined || source.field === undefined) return undefined;
            const row = claimFor(facts, source.claim_id)?.rows?.[source.row_index];
            return row === undefined ? undefined : numericCell(row.fields[source.field]);
        }
        case "claimed_fact_forecast_summary":
            return summaryNumber(
                claimFor(facts, source.claim_id)?.completion_forecast,
                source.field,
            );
        case "claimed_fact_value": {
            const fact = claimFor(facts, source.claim_id);
            if (fact === undefined || fact.field !== source.field) return undefined;
            // A derived claim holds no stored value to copy.
            if ((fact.derived_from?.length ?? 0) > 0) return undefined;
            return numericCell(fact.value);
        }
        default:
            return undefined;
    }
}

/**
 * True when every point in `shape` equals the number its own source names.
 *
 * Exact equality, matching acr's own rule: a copy always passes, and
 * rounding, rescaling or re-deriving always fails. There is no tolerance to
 * choose here, because there is no arithmetic a renderer is allowed to do —
 * see acr's `validateRenderShapes`.
 */
export function verifyRenderShape(shape: RenderShape, result: InvestigationResult): boolean {
    const labels = result.vocabulary_labels;
    // Structure first, then values. acr enforces every rule below before it
    // serves, and the published JSON Schema cannot express any of them, so
    // this is the last place a payload acr would never emit can be refused
    // (codex round 1, P1/P2). Each one, left unchecked, lets a chart draw
    // while saying something the answer does not.
    // A kind this view has no renderer for is REFUSED, not admitted.
    //
    // Verification used to check `presentation` only for "series", so a
    // sankey passed, was admitted, and RenderShapeChart returned null for it:
    // no chart AND no withheld notice. The reader saw nothing and was told
    // nothing — the exact silent absence the notice exists to prevent
    // (CHAOS-4641).
    //
    // The list is deliberately what this file can DRAW, not what the contract
    // declares. acr's vocabulary declares eight kinds so a consumer can
    // switch exhaustively; seven have no renderer here yet, and the honest
    // response to one arriving is "withheld", not a blank space. When a
    // renderer lands, its kind joins this list in the same change.
    if (shape.selected_by === THEME_SHARE_RULE) {
        if (!isThemeShareWhole(shape, result.claimed_facts, labels)) return false;
    } else if (shape.selected_by === COMPARISON_RULE) {
        if (!isSideBySide(shape, result.claimed_facts, labels)) return false;
    } else if (shape.selected_by === REPOSITORY_FLOW_RULE) {
        if (!isRepositoryFlow(shape, result.claimed_facts, labels)) return false;
    } else if (shape.selected_by === LANDSCAPE_POSITION_RULE) {
        if (!isLandscapePosition(shape, result.claimed_facts, labels)) return false;
    } else if (shape.selected_by === COMPLETION_FORECAST_RULE) {
        if (!isCompletionCurve(shape, result.claimed_facts)) return false;
    } else if (shape.selected_by === FORECAST_PERCENTILES_RULE) {
        if (!isForecastPercentiles(shape, result.claimed_facts, labels)) return false;
    } else if (shape.kind !== "series") {
        return false;
    }
    // The renderer's own "nothing to draw": with no point there is no chart, so the shape cannot be
    // admitted as drawn.
    if (axisLabels(shape).length === 0) return false;
    if (shape.series.length > SERIES_MAX_COUNT) return false;
    // A time axis is drawn by elapsed time only on a line; every other
    // presentation routes through category (index) spacing, which would place
    // a January and a December point one band apart. acr only ever emits
    // `line` for a time axis.
    if (shape.axis_kind === "time" && shape.presentation !== "line") return false;
    // An encoding this view cannot read is not a default to guess at:
    // rendering an unspecified presentation as bars picks one of three
    // meanings on the reader's behalf.
    if (
        shape.kind === "series" &&
        shape.presentation !== "bars" &&
        shape.presentation !== "stacked_bars" &&
        shape.presentation !== "line"
    ) {
        return false;
    }
    // A time axis is POSITIONED by elapsed time. Falling back to index
    // spacing would draw evenly-spaced samples the observations do not have.
    if (shape.axis_kind === "time" && !everyLabelIsADate(shape)) return false;
    // ...and its points must ASCEND. Every value in an out-of-order series is
    // correctly sourced and verifies individually; the LINE BETWEEN THEM is
    // the lie, drawing April -> January -> March and inventing transitions
    // that never happened (CHAOS-4641). Same class as CHAOS-4616, reached
    // through segment order rather than through the axis.
    //
    // Refused rather than sorted. acr emits a trend in chronological order,
    // so a document that violates it is malformed, and quietly reordering
    // would hide a producer bug exactly the way drawing it hides a data one.
    if (shape.axis_kind === "time" && !everySeriesAscendsInTime(shape)) return false;
    if (
        shape.selected_by === "cohort_attention_score" &&
        !everyScoreStandsOnARankingRow(shape, result.cohort)
    ) {
        return false;
    }

    if (hasDuplicate(shape.series.map((series) => series.key))) return false;
    for (const series of shape.series) {
        // One axis position, one value. Two points at one label is a table
        // drawn as a chart that silently overwrites itself — and the
        // renderer, which draws by label, would keep only the first.
        const seen = new Set<string>();
        for (const point of series.points) {
            if (seen.has(point.label)) return false;
            seen.add(point.label);
            if (!sourceAddressMatchesKind(point.source)) return false;
            // `>=`, one notch STRICTER than acr's `>`, and deliberately so:
            // acr refuses to EMIT a magnitude past 2^53, but by the time
            // JSON.parse has run here a wire value of 9007199254740993 is
            // already 9007199254740992 and the two are indistinguishable. At
            // exactly the bound this view cannot prove which number it is
            // holding, so it declines to plot it.
            if (!Number.isFinite(point.value) || Math.abs(point.value) >= EXACT_INTEGER_BOUND) {
                return false;
            }
            // The unit is a claim about the numbers, and a host formats by it.
            if (shape.value_unit === "ratio" && (point.value < 0 || point.value > 1)) return false;
            const resolved = resolvePointSource(point.source, result.cohort, result.claimed_facts);
            if (resolved === undefined || resolved !== point.value) return false;
        }
    }
    return true;
}

/**
 * The verified shapes an answer carries whose `selected_by` is one of
 * `rules`, plus the count withheld.
 *
 * Filtering by RULE rather than by kind is deliberate: `kind` says how to
 * READ the payload, and several rules can produce the same kind (all three
 * slice-1 rules produce `series`). Which panel a chart belongs in is a
 * question about WHY it was selected, not about its payload shape.
 */
export function renderShapesFor(
    result: InvestigationResult,
    rules: readonly RenderShapeRule[],
): VerifiedShapes {
    const candidates = (result.render_shapes ?? []).filter((shape) =>
        rules.includes(shape.selected_by),
    );
    return admit(candidates, result);
}

/**
 * The shared admission step for EVERY selector: a shape is drawn only if its
 * id is unique across the whole answer and it verifies. Both copies of a
 * duplicated id are withheld rather than one arbitrarily preferred — a React
 * key collision would otherwise make the second silently replace the first,
 * and a reader would lose a chart with no notice.
 */
function admit(candidates: readonly RenderShape[], result: InvestigationResult): VerifiedShapes {
    const duplicated = new Set(
        (result.render_shapes ?? [])
            .map((shape) => shape.shape_id)
            .filter((id, index, ids) => ids.indexOf(id) !== index),
    );
    const shapes = candidates.filter(
        (shape) => !duplicated.has(shape.shape_id) && verifyRenderShape(shape, result),
    );
    return { shapes, withheld: candidates.length - shapes.length };
}

/**
 * The verified trend shapes drawn from ONE claimed fact's rows.
 *
 * A trend belongs beside the table it was derived from, so it is matched by
 * the claim its points cite rather than being rendered in a panel of its
 * own. Matching on the points' own `claim_id` (not on some separate shape
 * field) keeps a single source of truth for what a trend is about.
 */
export function trendShapesForClaim(result: InvestigationResult, claimId: string): VerifiedShapes {
    return factShapesForClaim(result, claimId, "dated_fact_trend");
}

/** `trendShapesForClaim` for any rule whose chart sits on its fact's panel. */
export function factShapesForClaim(
    result: InvestigationResult,
    claimId: string,
    rule: RenderShapeRule,
): VerifiedShapes {
    // A shape is a CANDIDATE for this claim if it cites the claim anywhere,
    // and is admitted only if it cites nothing else and verifies. Filtering
    // by "cites only this claim" FIRST was the round-2 defect: a trend
    // spanning claims A and B matched neither, so both panels reported
    // `shapes:[] withheld:0` — indistinguishable from "acr selected nothing"
    // — and the client-side heuristic chart drew instead. A malformed shape
    // must be visibly withheld by whichever fact it names, never silently
    // absent from all of them.
    const candidates = (result.render_shapes ?? []).filter(
        (shape) => shape.selected_by === rule && shapeMentionsClaim(shape, claimId),
    );
    // Candidacy is "mentions this claim"; ownership is "cites only this
    // claim". A shape that mentions the claim but cites another too is a
    // candidate that fails admission, so it is WITHHELD here rather than
    // silently absent from every panel — the round-2 defect.
    const owned = candidates.filter((shape) => shapeCitesClaim(shape, claimId));
    const { shapes } = admit(owned, result);
    return { shapes, withheld: candidates.length - shapes.length };
}

/** True when ANY point of `shape` cites `claimId` — candidacy, not ownership. */
export function shapeMentionsClaim(shape: RenderShape, claimId: string): boolean {
    return shape.series.some((series) =>
        series.points.some((point) => point.source.claim_id === claimId),
    );
}

/**
 * CHAOS-4682 telemetry (standing order: telemetry baked into new logic, same
 * PR): for every trend chart a fact's own panel actually DRAWS, which array
 * its points resolved against. Content-safe by construction — a count per
 * closed-vocabulary source, never a claim id, field name, or value.
 *
 * Counts only shapes a panel actually draws — value-verified (`admit`'s
 * `verifyRenderShape` gate) AND single-claim-owned (`trendShapesForClaim`'s
 * own `shapeCitesClaim` gate). `renderShapesFor`'s admission checks value
 * correctness only, not ownership: a value-valid `dated_fact_trend` whose
 * points span two claims passes it, but is drawn by NEITHER claim's panel
 * (`trendShapesForClaim` requires EVERY point cite the one claim it was
 * asked about). Counting by the first point's claim id there attributes a
 * source to a chart nobody saw — codex round 1, P3. A shape is therefore
 * counted only when every point cites the SAME claim id, mirroring the
 * panel's own ownership rule exactly.
 */
export type TrendChartSourceCounts = {
    readonly dualTableTrendChartCount: number;
    readonly legacyTrendChartCount: number;
};

/** The single claim id every point of `shape` cites, or undefined if none/mixed. */
function soleOwningClaimId(shape: RenderShape): string | undefined {
    const claimId = shape.series[0]?.points[0]?.source.claim_id;
    return claimId !== undefined && shapeCitesClaim(shape, claimId) ? claimId : undefined;
}

export function trendChartSourceCounts(result: InvestigationResult): TrendChartSourceCounts {
    const { shapes } = renderShapesFor(result, ["dated_fact_trend"]);
    let dualTableTrendChartCount = 0;
    let legacyTrendChartCount = 0;
    for (const shape of shapes) {
        const claimId = soleOwningClaimId(shape);
        const fact =
            claimId === undefined
                ? undefined
                : result.claimed_facts.find((candidate) => candidate.claim_id === claimId);
        if (fact === undefined) continue;
        if (renderableRowsSource(fact) === "time_series_rows") dualTableTrendChartCount += 1;
        else legacyTrendChartCount += 1;
    }
    return { dualTableTrendChartCount, legacyTrendChartCount };
}

/**
 * True when EVERY point of `shape` cites `claimId`.
 *
 * `some()` was wrong (codex round 1, P2): a trend whose points span claims A
 * and B would render under both panels — one chart shown twice — and a
 * tampered B would be reported as A's rows disagreeing, which is a false
 * statement about the data in front of the reader. acr only ever builds a
 * trend from a single fact, so requiring all points is exactly the shape it
 * emits and refuses anything else.
 */
function shapeCitesClaim(shape: RenderShape, claimId: string): boolean {
    return shape.series.every((series) =>
        series.points.every((point) => point.source.claim_id === claimId),
    );
}
