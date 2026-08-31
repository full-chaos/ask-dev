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
import { cellValue, parseIsoDate } from "@/lib/fact-rows";

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
    return matches.length === 1 ? (matches[0]!.rows ?? []) : undefined;
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
function everyLabelIsADate(shape: RenderShape): boolean {
    for (const series of shape.series) {
        for (const point of series.points) {
            if (parseIsoDate(point.label) === null) return false;
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
        // A time axis is drawn by elapsed time only on a line; every other
        // presentation routes through category (index) spacing, which would
        // place a January and a December point one band apart (codex round
        // 2). acr only ever emits `line` for a time axis.
        if (shape.axis_kind === "time" && shape.presentation !== "line") return false;
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
    // A shape is a CANDIDATE for this claim if it cites the claim anywhere,
    // and is admitted only if it cites nothing else and verifies. Filtering
    // by "cites only this claim" FIRST was the round-2 defect: a trend
    // spanning claims A and B matched neither, so both panels reported
    // `shapes:[] withheld:0` — indistinguishable from "acr selected nothing"
    // — and the client-side heuristic chart drew instead. A malformed shape
    // must be visibly withheld by whichever fact it names, never silently
    // absent from all of them.
    const candidates = (result.render_shapes ?? []).filter(
        (shape) => shape.selected_by === "dated_fact_trend" && shapeMentionsClaim(shape, claimId),
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
function shapeMentionsClaim(shape: RenderShape, claimId: string): boolean {
    return shape.series.some((series) =>
        series.points.some((point) => point.source.claim_id === claimId),
    );
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
