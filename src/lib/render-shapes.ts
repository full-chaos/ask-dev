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
    InvestigationResult,
    RenderShape,
    ScalarValue,
} from "@/lib/contracts";
import { cellValue } from "@/lib/fact-rows";

/** The selection rule that produced a shape (acr's closed vocabulary). */
export type RenderShapeRule = RenderShape["selected_by"];

/** Shapes the cohort ranking panel owns: the score bars and their breakdown. */
export const COHORT_SHAPE_RULES: readonly RenderShapeRule[] = [
    "cohort_attention_score",
    "cohort_driver_contribution",
];

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

function rowsFor(facts: readonly ClaimedFact[], claimId: string): readonly ClaimedFactRow[] {
    for (const fact of facts) {
        if (fact.claim_id === claimId) return fact.rows ?? [];
    }
    return [];
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
            return (
                has(source.claim_id) &&
                has(source.row_index) &&
                has(source.field) &&
                !has(source.subject_canonical_id) &&
                !has(source.signal)
            );
        default:
            return false;
    }
}

/** True when every label parses as a real calendar date/date-time. */
function everyLabelIsADate(shape: RenderShape): boolean {
    for (const series of shape.series) {
        for (const point of series.points) {
            if (Number.isNaN(Date.parse(point.label))) return false;
        }
    }
    return true;
}

function resolvePointSource(
    source: RenderShape["series"][number]["points"][number]["source"],
    cohort: Cohort | undefined,
    facts: readonly ClaimedFact[],
): number | undefined {
    switch (source.kind) {
        case "cohort_member_score": {
            const member = cohort?.members.find(
                (candidate) => candidate.subject.canonical_id === source.subject_canonical_id,
            );
            // `score` is nullable on the wire and `null` is a real value
            // meaning "ranked, no score" — distinct from an absent member.
            // Neither can back a plotted bar.
            return member?.score ?? undefined;
        }
        case "cohort_driver_weight_contributed": {
            const member = cohort?.members.find(
                (candidate) => candidate.subject.canonical_id === source.subject_canonical_id,
            );
            const driver = member?.drivers?.find((candidate) => candidate.signal === source.signal);
            return driver?.weight_contributed;
        }
        case "claimed_fact_row": {
            if (source.claim_id === undefined || source.row_index === undefined) return undefined;
            const row = rowsFor(facts, source.claim_id)[source.row_index];
            if (row === undefined || source.field === undefined) return undefined;
            return numericCell(row.fields[source.field]);
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
    // Structure first, then values. acr enforces every rule below before it
    // serves, and the published JSON Schema cannot express any of them, so
    // this is the last place a payload acr would never emit can be refused
    // (codex round 1, P1/P2). Each one, left unchecked, lets a chart draw
    // while saying something the answer does not.
    if (shape.kind === "series") {
        // An encoding this view cannot read is not a default to guess at:
        // rendering an unspecified presentation as bars picks one of three
        // meanings on the reader's behalf.
        if (
            shape.presentation !== "bars" &&
            shape.presentation !== "stacked_bars" &&
            shape.presentation !== "line"
        ) {
            return false;
        }
    }
    // A time axis is POSITIONED by elapsed time. Falling back to index
    // spacing would draw evenly-spaced samples the observations do not have.
    if (shape.axis_kind === "time" && !everyLabelIsADate(shape)) return false;

    for (const series of shape.series) {
        // One axis position, one value. Two points at one label is a table
        // drawn as a chart that silently overwrites itself — and the
        // renderer, which draws by label, would keep only the first.
        const seen = new Set<string>();
        for (const point of series.points) {
            if (seen.has(point.label)) return false;
            seen.add(point.label);
            if (!sourceAddressMatchesKind(point.source)) return false;
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
    const shapes = candidates.filter((shape) => verifyRenderShape(shape, result));
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
    const candidates = (result.render_shapes ?? []).filter(
        (shape) => shape.selected_by === "dated_fact_trend" && shapeCitesClaim(shape, claimId),
    );
    const shapes = candidates.filter((shape) => verifyRenderShape(shape, result));
    return { shapes, withheld: candidates.length - shapes.length };
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
