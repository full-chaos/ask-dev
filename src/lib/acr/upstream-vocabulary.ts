import commonSchema from "@/contracts/schemas/context_fabric_common.v1.schema.json";
import errorSchema from "@/contracts/schemas/error.v1.schema.json";

/**
 * Bounded handling of the two upstream fields the Workbench still carries.
 *
 * `error.message` is not carried at all. These two are, because both are
 * ACR-authored identifiers rather than generated prose — but "should be an
 * identifier" is not the same as "is one", and an upstream that put a sentence
 * in either would put it straight into the DOM. So both are constrained here
 * before anything renders them.
 */

/**
 * The allowlist is READ FROM THE PINNED SCHEMA, not hand-copied.
 *
 * `error.v1` declares `code` as a closed enum, so the contract already is the
 * vocabulary. Deriving it means a pin bump that adds a code picks it up
 * automatically, and a hand-maintained copy cannot drift out of date behind a
 * check that still looks green.
 */
const ACR_ERROR_CODES: ReadonlySet<string> = new Set(
    (errorSchema as { properties: { error: { properties: { code: { enum?: string[] } } } } })
        .properties.error.properties.code.enum ?? [],
);

/** A code outside the contract's vocabulary. Never the received value. */
export const UNRECOGNIZED_UPSTREAM_CODE = "unrecognized_upstream_code";

/**
 * Returns the code when it is one the contract declares, and a fixed marker
 * otherwise. The received value is dropped, never echoed: a `code` carrying a
 * sentence must not reach the DOM just because it arrived in a field that
 * usually holds an identifier.
 */
export function boundedUpstreamCode(code: string | undefined): string | undefined {
    if (code === undefined) return undefined;
    return ACR_ERROR_CODES.has(code) ? code : UNRECOGNIZED_UPSTREAM_CODE;
}

/**
 * `request_id` is OPAQUE — its only job is to be quoted back to an operator for
 * log matching, so it needs no interpretation, only a shape.
 *
 * The contract bounds its length but not its charset, so the charset is bounded
 * here: identifier characters only. Anything else is dropped rather than
 * truncated or escaped, because a request id that is not identifier-shaped is
 * not a request id, and rendering a partial one would invite quoting it.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/u;

export function boundedUpstreamRequestId(requestId: string | undefined): string | undefined {
    if (requestId === undefined) return undefined;
    return REQUEST_ID_PATTERN.test(requestId) ? requestId : undefined;
}

/** Exposed for tests, so the allowlist's source can be asserted rather than assumed. */
export const acrErrorCodeVocabulary: ReadonlySet<string> = ACR_ERROR_CODES;

/**
 * CHAOS-5107 (CHAOS-4735's client half): the planned-refusal continuation a
 * 413 budget refusal carries in `error.details`, an OPEN object (error.v1's
 * `details.additionalProperties: true` — see error.v1.schema.json), so none
 * of what follows is a schema change or needs a pin bump.
 *
 * `question_family` and `overrun` ARE declared in the pinned common schema
 * (`QuestionFamily`/`BudgetOverrun` `$defs`), so their allowlists are read
 * from it exactly as `ACR_ERROR_CODES` reads `error.code` above — a pin bump
 * that adds a member picks it up automatically. `narrower_continuation.axis`
 * has no schema of its own (CHAOS-4735 put it in the open object on purpose,
 * per chris's 2026-08-31 ruling that naming a structural axis is not a wire
 * widening); its vocabulary is hand-copied from ACR's own source of truth
 * (internal/contextfabric/chaos4632_question_family_registry.go) and
 * verified against a real fixture in client.test.ts. `none` is excluded on
 * purpose: the route OMITS `narrower_continuation` entirely rather than
 * sending `{"axis":"none"}` when no axis can be named, so a consumer never
 * sees that member on the wire.
 */
export type NarrowingContinuationAxis =
    "evidence_window" | "result_count" | "scope_anchor" | "group_selection" | "comparison_pair";

const NARROWING_CONTINUATION_AXES: ReadonlySet<string> = new Set<NarrowingContinuationAxis>([
    "evidence_window",
    "result_count",
    "scope_anchor",
    "group_selection",
    "comparison_pair",
]);

/** Exposed for tests, so the hand-copied vocabulary can be asserted directly. */
export const narrowingContinuationAxisVocabulary: ReadonlySet<string> = NARROWING_CONTINUATION_AXES;

/**
 * Returns the axis when it is a member of the closed vocabulary, `undefined`
 * otherwise. Unlike `boundedUpstreamCode`, there is no "unrecognized" marker
 * value: an axis outside the vocabulary has no entry in the copy table
 * either (`narrower-continuation-copy.ts`), so a marker would only let a
 * caller render half a claim. Absence is the honest encoding.
 */
export function boundedNarrowingContinuationAxis(
    axis: string | undefined,
): NarrowingContinuationAxis | undefined {
    if (axis === undefined) return undefined;
    return NARROWING_CONTINUATION_AXES.has(axis) ? (axis as NarrowingContinuationAxis) : undefined;
}

/**
 * `QuestionFamily`'s closed vocabulary, read from the pinned common schema —
 * see this section's header comment.
 */
const QUESTION_FAMILIES: ReadonlySet<string> = new Set(
    (commonSchema as { $defs: { QuestionFamily: { enum?: string[] } } }).$defs.QuestionFamily
        .enum ?? [],
);

/** Exposed for tests, so the allowlist's source can be asserted rather than assumed. */
export const questionFamilyVocabulary: ReadonlySet<string> = QUESTION_FAMILIES;

/**
 * Bounded like `boundedUpstreamCode`, but with no marker for an unrecognized
 * value: `question_family` inside `narrower_continuation` is carried for
 * diagnosis, never rendered as copy on its own, so dropping it silently is
 * enough — nothing downstream needs to know one arrived and was rejected.
 */
export function boundedQuestionFamily(family: string | undefined): string | undefined {
    if (family === undefined) return undefined;
    return QUESTION_FAMILIES.has(family) ? family : undefined;
}

/**
 * `BudgetOverrun`'s closed vocabulary (`fits`/`items`/`bytes`), read from the
 * pinned common schema — see this section's header comment. ACR only ever
 * sends `items` or `bytes` inside a refusal's `details.overrun` (`fits`
 * means the answer fit, so it is never the cause of a refusal), but the
 * bound accepts the schema's full enum rather than a hand-narrowed one.
 */
const BUDGET_OVERRUNS: ReadonlySet<string> = new Set(
    (commonSchema as { $defs: { BudgetOverrun: { enum?: string[] } } }).$defs.BudgetOverrun.enum ??
        [],
);

/** Exposed for tests, so the allowlist's source can be asserted rather than assumed. */
export const budgetOverrunVocabulary: ReadonlySet<string> = BUDGET_OVERRUNS;

export function boundedBudgetOverrun(overrun: string | undefined): string | undefined {
    if (overrun === undefined) return undefined;
    return BUDGET_OVERRUNS.has(overrun) ? overrun : undefined;
}

/**
 * `measured_items`/`max_items` are plain counts, not identifiers, but "should
 * be a non-negative integer" is not a guarantee any more than "should be an
 * identifier" was for `code`/`request_id` above — an upstream that put
 * something else there must not have it rendered as a count regardless.
 */
export function boundedNonNegativeInteger(value: unknown): number | undefined {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}
