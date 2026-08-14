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
