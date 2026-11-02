import {
    createAcrCalls,
    getAcrAccessToken,
    reportAcrTokenRejected,
    RUN_TIMEOUT_DEFAULT_MS,
    TransportFailure,
    TransportRefusal,
    type AcrCalls,
    type TransportFailureReason,
} from "@/acr-client";
import {
    acrClientConfig,
    authorizeByRedirect,
    isInvestigationResult,
} from "@/lib/acr/browser-host";
import { type WorkbenchFailure } from "@/lib/acr/errors";
import { REFUSAL_COPY } from "@/lib/acr/narrower-continuation-copy";
import {
    boundedBudgetOverrun,
    boundedModelRefusalReason,
    type ModelRefusalReason,
    boundedNarrowingContinuationAxis,
    boundedNonNegativeInteger,
    boundedQuestionFamily,
    boundedUpstreamCode,
    boundedUpstreamRequestId,
    type NarrowingContinuationAxis,
} from "@/lib/acr/upstream-vocabulary";
import { loadStreamValidators, streamEnvelopeValidators } from "@/lib/acr/stream-validators";
import { validateContract, type ContractSchemaName } from "@/lib/acr/validate";
import { MAX_CONVERSATION_TURNS_ON_WIRE, MAX_SUBJECT_HINTS_ON_WIRE } from "@/lib/conversation";
import { CHAT_STATUS_COPY, NOT_RUN_COPY } from "@/render/chat-copy";
import {
    STRUCTURE_RECEIPT_PREFIX,
    type BoundStructureReceipt,
    type ConversationTurn,
    type InvestigationRequest,
    type InvestigationResult,
    type StructureSubjectKind,
    type SubjectHint,
} from "@/lib/contracts";

/**
 * The Workbench's investigation, run from the browser (CHAOS-12106). The page is a browser OAuth
 * client of ACR, as the web app is: it builds the request, validates it, and reads ACR's event
 * stream through the shared client (`@/acr-client`). No key, assertion or identity of its own
 * exists anywhere in this app.
 *
 * The Workbench calls the REAL investigation API: it never consumes a mock result (CHAOS-3738 hard
 * boundary). When ACR cannot answer, this surfaces the failure honestly instead of substituting
 * anything.
 */

/**
 * Result schema by the payload's own `schema_version` (CHAOS-11906). acr serves v2 whenever it
 * minted a membership-verify anchor option; v1 results are never reinterpreted. An unlisted version
 * is a contract violation, never a guess.
 *
 * The `result` event carries the investigation RESPONSE: the result's fields plus an optional
 * `synthesis_input`, under the same `schema_version`. The result schemas close their properties, so
 * they would refuse that extra field; the response schemas are the result schemas plus it.
 * The bounded answer projection (`context_fabric_answer_projection.v1`) has no entry: this app has
 * no view for it.
 */
const RESULT_SCHEMAS = {
    "context_fabric_investigation_result.v1":
        "context_fabric_investigation_response.v1.schema.json",
    "context_fabric_investigation_result.v2":
        "context_fabric_investigation_response.v2.schema.json",
} as const satisfies Record<string, ContractSchemaName>;

export function resultSchemaFor(payload: unknown): ContractSchemaName | undefined {
    if (typeof payload !== "object" || payload === null) return undefined;
    const version = (payload as { schema_version?: unknown }).schema_version;
    if (typeof version !== "string" || !Object.hasOwn(RESULT_SCHEMAS, version)) return undefined;
    return RESULT_SCHEMAS[version as keyof typeof RESULT_SCHEMAS];
}

const MAX_QUESTION_LENGTH = 8_000;

/**
 * Counts CODE POINTS, not UTF-16 units. ACR bounds the question at 8000 runes, which is also what
 * JSON Schema's `maxLength` means; an astral character counts once there.
 */
function codePointLength(value: string): number {
    return [...value].length;
}

/**
 * A subject the tester chose from a clarification result.
 *
 * The contract's own re-ask mechanism: `prior_subject_receipts` binds a
 * previous result's candidate receipt to a new investigation, so the choice is
 * carried as ACR's OWN identifier rather than as a re-typed subject name. The
 * Workbench therefore never names a subject on the tester's behalf — it hands
 * back a receipt ACR issued.
 */
export type BoundReceipt = {
    readonly result_id: string;
    readonly receipt_id: string;
};

export type InvestigationOptions = {
    readonly question: string;
    readonly priorSubjectReceipts?: readonly BoundReceipt[] | undefined;
    // CHAOS-3927 P2 (design brief §2.1/§2.2). See buildInvestigationRequest's
    // own comment: attached to the outbound wire object when non-empty.
    readonly priorKindReceipts?: readonly BoundStructureReceipt[] | undefined;
    readonly priorAnchorReceipts?: readonly BoundStructureReceipt[] | undefined;
    readonly priorHandleReceipts?: readonly BoundStructureReceipt[] | undefined;
    readonly priorWindowReceipts?: readonly BoundStructureReceipt[] | undefined;
    // CHAOS-4012's own addition to the four above, same shape.
    readonly priorCandidateReceipts?: readonly BoundStructureReceipt[] | undefined;
    /**
     * CHAOS-4343 item 3: the caller's own explicit `expected_kind` guess(es),
     * derived from a literal kind noun in the question text (see
     * `@/lib/kind-nouns`). A plain request field, not a receipt — legal on a
     * FRESH question with no prior result to redeem one from.
     */
    readonly expectedKinds?: readonly StructureSubjectKind[] | undefined;
    // Chat-surface conversation threading. See src/lib/conversation.ts's own
    // header: the Workbench never supplies this (it asks one independent
    // question at a time by design), so it defaults to empty below exactly
    // as it always has.
    readonly conversation?: readonly ConversationTurn[] | undefined;
    /**
     * CHAOS-5837: same-conversation carry. `@/lib/conversation`'s
     * `deriveParentReference` is the chat surface's own producer of both —
     * undefined/empty on a first turn, set together on a follow-up whose
     * immediately preceding turn answered.
     */
    readonly parentResultId?: string | undefined;
    readonly subjectHints?: readonly SubjectHint[] | undefined;
    readonly signal?: AbortSignal | undefined;
};

function requestId(): string {
    return `request_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

/**
 * Builds the wire request. `consumer` names this surface exactly as the
 * canonical contract example does, so ACR-side telemetry can attribute
 * Workbench traffic without guessing.
 */
/** The contract's own bound on `prior_subject_receipts`. */
const MAX_PRIOR_SUBJECT_RECEIPTS = 20;
/** The contract's own bound on every `prior_*_receipts` structure field (§2.1). */
const MAX_STRUCTURE_RECEIPTS = 20;
/** The contract's own bound on `expected_kinds` (CHAOS-3972 P3 §2.3/2.0/DP12(b)). */
const MAX_EXPECTED_KINDS = 15;

/** Deduplicates by `(result_id, receipt_id)` and caps at `limit`, matching the contract's `uniqueItems`/`maxItems`. */
function dedupeAndCap<T extends BoundStructureReceipt>(
    receipts: readonly T[],
    limit: number,
): readonly T[] {
    return [
        ...new Map(
            receipts.map((receipt) => [`${receipt.result_id}|${receipt.receipt_id}`, receipt]),
        ).values(),
    ].slice(0, limit);
}

export function buildInvestigationRequest(
    question: string,
    priorSubjectReceipts: readonly BoundReceipt[] = [],
    structureReceipts: {
        readonly priorKindReceipts?: readonly BoundStructureReceipt[] | undefined;
        readonly priorAnchorReceipts?: readonly BoundStructureReceipt[] | undefined;
        readonly priorHandleReceipts?: readonly BoundStructureReceipt[] | undefined;
        readonly priorWindowReceipts?: readonly BoundStructureReceipt[] | undefined;
        readonly priorCandidateReceipts?: readonly BoundStructureReceipt[] | undefined;
    } = {},
    conversation: readonly ConversationTurn[] = [],
    expectedKinds: readonly StructureSubjectKind[] = [],
    parentResultId: string | undefined = undefined,
    subjectHints: readonly SubjectHint[] = [],
): InvestigationRequest {
    // Deduplicated (the contract requires uniqueItems) and capped at the
    // contract's maxItems, so an over-long or repeated selection fails here
    // rather than as an opaque ACR 400.
    //
    // The cast is unavoidable: json-schema-to-typescript renders `maxItems: 20`
    // as a union of twenty-one fixed-length tuple types, which no runtime array
    // can satisfy structurally. The slice above is what actually enforces the
    // bound, and the request is schema-validated before it is sent.
    const receipts = dedupeAndCap(priorSubjectReceipts, MAX_PRIOR_SUBJECT_RECEIPTS) as NonNullable<
        InvestigationRequest["prior_subject_receipts"]
    >;

    // CHAOS-3927 P2 (design brief §2.1's four `prior_*_receipts` structure
    // fields). THE SEAM landed (acr 7d275c2e; see `@/lib/contracts`'s own
    // header): `InvestigationRequest` now DECLARES these four fields itself,
    // so attaching them is legal on the wire unconditionally. Still attached
    // ONLY WHEN NON-EMPTY, but that is wire minimization now, not a
    // correctness requirement — an empty array is just as schema-valid as an
    // absent key. `investigate.test.ts` pins this behavior.
    // Same "unavoidable cast" reasoning as `receipts` above, applied per
    // field: each of the four generated properties is its OWN maxItems-20
    // tuple-union type (`KindBoundReceipt`/etc., not a plain array). `Pick`
    // keeps `structureFields`'s own type exactly aligned with the four
    // request properties it spreads into, one cast per field rather than
    // one for the whole object.
    const structureFields: Partial<
        Pick<
            InvestigationRequest,
            | "prior_kind_receipts"
            | "prior_anchor_receipts"
            | "prior_handle_receipts"
            | "prior_window_receipts"
            | "prior_candidate_receipts"
        >
    > = {};
    const kindReceipts = dedupeAndCap(
        structureReceipts.priorKindReceipts ?? [],
        MAX_STRUCTURE_RECEIPTS,
    );
    if (kindReceipts.length > 0)
        structureFields.prior_kind_receipts = kindReceipts as NonNullable<
            InvestigationRequest["prior_kind_receipts"]
        >;
    const anchorReceipts = dedupeAndCap(
        structureReceipts.priorAnchorReceipts ?? [],
        MAX_STRUCTURE_RECEIPTS,
    );
    if (anchorReceipts.length > 0)
        structureFields.prior_anchor_receipts = anchorReceipts as NonNullable<
            InvestigationRequest["prior_anchor_receipts"]
        >;
    const handleReceipts = dedupeAndCap(
        structureReceipts.priorHandleReceipts ?? [],
        MAX_STRUCTURE_RECEIPTS,
    );
    if (handleReceipts.length > 0)
        structureFields.prior_handle_receipts = handleReceipts as NonNullable<
            InvestigationRequest["prior_handle_receipts"]
        >;
    const windowReceipts = dedupeAndCap(
        structureReceipts.priorWindowReceipts ?? [],
        MAX_STRUCTURE_RECEIPTS,
    );
    if (windowReceipts.length > 0)
        structureFields.prior_window_receipts = windowReceipts as NonNullable<
            InvestigationRequest["prior_window_receipts"]
        >;
    const candidateReceipts = dedupeAndCap(
        structureReceipts.priorCandidateReceipts ?? [],
        MAX_STRUCTURE_RECEIPTS,
    );
    if (candidateReceipts.length > 0)
        structureFields.prior_candidate_receipts = candidateReceipts as NonNullable<
            InvestigationRequest["prior_candidate_receipts"]
        >;

    // Wire-minimized the same way the four structure fields are (attached
    // only when non-empty): `conversation` is optional on the pinned
    // contract, and an absent key is just as valid as an empty array. Capped
    // to the wire's own bound here too — defense in depth, since
    // `buildConversationTurns` (the chat surface's only caller) already caps
    // lower — so a future caller that skips that cap still cannot build a
    // request the contract rejects.
    const conversationTurns = conversation.slice(-MAX_CONVERSATION_TURNS_ON_WIRE);

    // CHAOS-4343 item 3: deduplicated and capped the same way every other
    // array field above is — `uniqueItems`/`maxItems: 15` on the pinned
    // contract — then attached only when non-empty (wire minimization,
    // same as the four structure-receipt fields and `conversation`).
    const dedupedExpectedKinds = [...new Set(expectedKinds)].slice(
        0,
        MAX_EXPECTED_KINDS,
    ) as NonNullable<InvestigationRequest["expected_kinds"]>;

    // Capped to the wire's own bound here too — defense in
    // depth, same reasoning as `conversationTurns` above, since
    // `deriveParentReference` (the chat surface's only caller) already caps
    // lower. Attached only when non-empty; `parent_result_id` is attached
    // whenever supplied, independent of whether any hint came with it (a
    // prior result with nothing committed still names a parent).
    const boundedSubjectHints = subjectHints.slice(0, MAX_SUBJECT_HINTS_ON_WIRE);

    return {
        schema_version: "context_fabric_investigation_request.v1",
        request_id: requestId(),
        question,
        ...(conversationTurns.length > 0 ? { conversation: conversationTurns } : {}),
        prior_subject_receipts: receipts,
        ...structureFields,
        ...(dedupedExpectedKinds.length > 0 ? { expected_kinds: dedupedExpectedKinds } : {}),
        ...(parentResultId !== undefined ? { parent_result_id: parentResultId } : {}),
        ...(boundedSubjectHints.length > 0
            ? { requested_scope: { subject_hints: boundedSubjectHints } }
            : {}),
        time_context: { axis: "current" },
        options: {
            max_subject_candidates: 10,
            max_cohort_members: 50,
            max_relationship_paths: 50,
            max_drivers: 10,
            max_evidence_refs: 100,
            max_serialized_bytes: 262_144,
            allow_clarification: true,
            include_debug: false,
        },
        consumer: {
            name: "context-fabric-workbench",
            version: "0.1.0",
            surface: "workbench",
        },
    } satisfies InvestigationRequest;
}

/**
 * The parsed upstream error.
 *
 * `message` is deliberately ABSENT. ACR's `error.message` can carry text that
 * originated with a model or provider, and the hard constraint is that such
 * text never reaches the UI, an error, or a log. Omitting the field from the
 * type — rather than parsing it and remembering not to use it — is what makes
 * reintroducing it a compile error instead of a review catch.
 */
type UpstreamError = {
    readonly code?: string;
    readonly retryable?: boolean;
    readonly requestId?: string;
    /**
     * CHAOS-5107/CHAOS-4735: the planned refusal's continuation, present only
     * when a 413 budget refusal named an axis. Read from `error.details` (an
     * OPEN object — see upstream-vocabulary.ts's header comment on this
     * section), so this is not a schema change. `axis` is always a member of
     * the closed vocabulary when this field is present at all — see
     * `parseNarrowerContinuation`.
     */
    readonly narrowerContinuation?: {
        readonly axis: NarrowingContinuationAxis;
        readonly family?: string;
    };
    readonly overrun?: string;
    readonly measuredItems?: number;
    readonly maxItems?: number;
    readonly measuredBytes?: number;
    readonly maxBytes?: number;
    readonly nothingLeftToCut?: true;
    /** CHAOS-10343: `details.reason`, kept only when it is a documented model-refusal member. */
    readonly refusalReason?: ModelRefusalReason;
};

export function parseUpstreamError(payload: unknown): UpstreamError {
    if (typeof payload !== "object" || payload === null) return {};
    // `request_id` sits at the TOP level of error.v1, not inside `error`.
    const requestId = (payload as { request_id?: unknown }).request_id;
    const error = (payload as { error?: unknown }).error;
    const base = typeof requestId === "string" ? { requestId } : {};
    if (typeof error !== "object" || error === null) return base;
    // `message` is read past deliberately; see UpstreamError.
    const { code, retryable, details } = error as Record<string, unknown>;
    return {
        ...base,
        ...(typeof code === "string" ? { code } : {}),
        ...(typeof retryable === "boolean" ? { retryable } : {}),
        ...parseUpstreamErrorDetails(details),
    };
}

/**
 * CHAOS-5107: reads the CHAOS-4735 planned-refusal fields out of
 * `error.details`. `details` is an open object (error.v1.schema.json:
 * `details.additionalProperties: true`), so none of this is a schema change
 * or needs a pin bump — the same fact ACR's own routes.go comment records
 * about this exact field set.
 *
 * Every field is bounded against a closed vocabulary or a shape before it is
 * carried anywhere, the same discipline `boundedUpstreamCode`/
 * `boundedUpstreamRequestId` already apply two levels up in `failureFor`.
 * Nothing here reads `error.message`, `question_text`, or any other free-text
 * field — the corpus/tester's question never appears in this file.
 */
export function parseUpstreamErrorDetails(
    details: unknown,
): Pick<
    UpstreamError,
    | "maxBytes"
    | "maxItems"
    | "measuredBytes"
    | "measuredItems"
    | "narrowerContinuation"
    | "nothingLeftToCut"
    | "overrun"
    | "refusalReason"
> {
    if (typeof details !== "object" || details === null) return {};
    const record = details as Record<string, unknown>;
    const overrun = boundedBudgetOverrun(
        typeof record.overrun === "string" ? record.overrun : undefined,
    );
    const measuredItems = boundedNonNegativeInteger(record.measured_items);
    const maxItems = boundedNonNegativeInteger(record.max_items);
    const measuredBytes = boundedNonNegativeInteger(record.measured_bytes);
    const maxBytes = boundedNonNegativeInteger(record.max_serialized_bytes);
    const narrowerContinuation = parseNarrowerContinuation(record.narrower_continuation);
    const refusalReason = boundedModelRefusalReason(record.reason);
    return {
        ...(refusalReason === undefined ? {} : { refusalReason }),
        ...(overrun === undefined ? {} : { overrun }),
        ...(measuredItems === undefined ? {} : { measuredItems }),
        ...(maxItems === undefined ? {} : { maxItems }),
        ...(measuredBytes === undefined ? {} : { measuredBytes }),
        ...(maxBytes === undefined ? {} : { maxBytes }),
        ...(record.nothing_left_to_cut === true ? { nothingLeftToCut: true } : {}),
        ...(narrowerContinuation === undefined ? {} : { narrowerContinuation }),
    };
}

/**
 * `axis` gates the whole object: an axis outside the closed vocabulary (or
 * missing) has no entry in the copy table either
 * (`@/lib/acr/narrower-continuation-copy`), so keeping a continuation around
 * without one would only let a caller render half a claim. `family` is
 * optional even when present on the wire — it is carried for diagnosis, not
 * rendered as copy, so an unrecognized value is dropped rather than sinking
 * the whole continuation.
 */
function parseNarrowerContinuation(value: unknown): UpstreamError["narrowerContinuation"] {
    if (typeof value !== "object" || value === null) return undefined;
    const record = value as Record<string, unknown>;
    const axis = boundedNarrowingContinuationAxis(
        typeof record.axis === "string" ? record.axis : undefined,
    );
    if (axis === undefined) return undefined;
    const family = boundedQuestionFamily(
        typeof record.family === "string" ? record.family : undefined,
    );
    return { axis, ...(family === undefined ? {} : { family }) };
}

/**
 * Maps an upstream status onto the Workbench's failure vocabulary.
 *
 * 503 is called out on purpose: it is ACR's ONE wire signal
 * (upstream_unavailable) for every `contextfabric.ErrUnavailable`/
 * `ErrModelUnavailable` cause its error envelope has no room to
 * distinguish — confirmed live (CHAOS-4333) that the identical code+status
 * fires both for the investigator genuinely not being composed (graph
 * reads disabled, graph backend unconfigured, no model runtime) AND for an
 * unrelated Postgres persistence failure with nothing to do with any of
 * those. Naming ONE specific cause here would be confidently wrong for the
 * others, so the message below states only what's actually known and
 * points at the request id for the rest.
 */
const modelRefusalMessages: Readonly<Record<ModelRefusalReason, string>> = {
    own_model_gate_closed:
        "This organization's own model is saved, but its plan does not include it right now. No model was used.",
    ai_features_turned_off: "AI features are turned off for this organization. No model was used.",
    byo_no_investigate_config:
        "This organization's saved model keys are not set for investigations. An organization admin must set one. No model was used.",
    own_model_turned_off:
        "An organization admin turned this organization's own model off. No model was used.",
};

export function failureFor(status: number, upstream: UpstreamError): WorkbenchFailure {
    // Both upstream fields are bounded before they can be carried anywhere.
    // "Usually an identifier" is not a guarantee, and an upstream that put a
    // sentence in either would otherwise put it straight into the DOM.
    const code = boundedUpstreamCode(upstream.code);
    const upstreamRequestId = boundedUpstreamRequestId(upstream.requestId);
    // CHAOS-5107 (codex review round 2, P2): ACR only ever puts a budget
    // continuation in `error.details` on a 413 -- carrying it forward
    // regardless of status meant a 503/401/whatever-else response with a
    // details object that happened to carry these same key names would
    // render a "narrower re-ask" under an UNRELATED failure. Gating on the
    // status code the continuation is actually defined for closes that.
    const budgetRefusalFields =
        status === 413
            ? {
                  ...(upstream.narrowerContinuation === undefined
                      ? {}
                      : { narrowerContinuation: upstream.narrowerContinuation }),
                  ...(upstream.overrun === undefined ? {} : { overrun: upstream.overrun }),
                  ...(upstream.measuredItems === undefined
                      ? {}
                      : { measuredItems: upstream.measuredItems }),
                  ...(upstream.maxItems === undefined ? {} : { maxItems: upstream.maxItems }),
                  ...(upstream.measuredBytes === undefined
                      ? {}
                      : { measuredBytes: upstream.measuredBytes }),
                  ...(upstream.maxBytes === undefined ? {} : { maxBytes: upstream.maxBytes }),
                  ...(upstream.nothingLeftToCut === undefined
                      ? {}
                      : { nothingLeftToCut: upstream.nothingLeftToCut }),
              }
            : {};
    const upstreamFields = {
        httpStatus: status,
        ...(code === undefined ? {} : { upstreamCode: code }),
        ...(upstreamRequestId === undefined ? {} : { upstreamRequestId }),
        ...budgetRefusalFields,
    };
    // CHAOS-10343: a 403 feature_not_enabled with a documented reason is the
    // organization's own model setup refusing the turn, not a bad credential.
    // Both the code and the reason are bounded above, so anything else here
    // (an unknown reason, service_model_not_entitled) stays a credential-class
    // failure. All four refuse before the caller's own synthesis is considered
    // (acr gate, executed per reason), so no message offers a way around them.
    if (status === 403 && code === "feature_not_enabled" && upstream.refusalReason !== undefined) {
        return {
            ...upstreamFields,
            code: "acr_model_refused",
            refusalReason: upstream.refusalReason,
            message: modelRefusalMessages[upstream.refusalReason],
            retryable: false,
        };
    }
    // CHAOS-12202: the R1 refusals each have their own failure. Each is matched
    // on its documented status AND code, so the same code under another status
    // keeps the status's own mapping.
    if (status === 403 && code === "access_denied") {
        return {
            ...upstreamFields,
            code: "acr_access_denied",
            // One code for every reason, so the words name none of them.
            message: NOT_RUN_COPY.access_denied,
            retryable: false,
        };
    }
    if (status === 409 && code === "no_repository") {
        return {
            ...upstreamFields,
            code: "acr_no_repository",
            message: `${NOT_RUN_COPY.no_repository} A repository that is not synced yet cannot be read until it is.`,
            retryable: false,
        };
    }
    if (status === 409 && code === "canceled") {
        return {
            ...upstreamFields,
            code: "acr_canceled",
            message: "The investigation was canceled before it finished. No answer was stored.",
            retryable: false,
        };
    }
    if (status === 503 && code === "budget_exhausted") {
        return {
            ...upstreamFields,
            code: "acr_budget_exhausted",
            message: CHAT_STATUS_COPY.deadline.budget_exhausted,
            retryable: true,
        };
    }
    if (status === 401 || status === 403) {
        return {
            ...upstreamFields,
            code: "acr_unauthorized",
            message: "Ask Dev did not accept your access.",
            retryable: false,
        };
    }
    if (status === 422) {
        // ACR reserves 422 for ITS OWN derived artifact failing ITS OWN v1
        // bounds -- deliberately not 502 (provider misbehaving) and not 500
        // (an ACR bug). That is a classified non-answer, and ACR marks it
        // retryable because an independent model call may produce compliant
        // output. Folding it in with "your request was bad" would blame the
        // tester for the engine declining to assert something it could not
        // bind to canonical facts.
        return {
            ...upstreamFields,
            code: "acr_answer_rejected",
            message:
                "Ask Dev derived an answer and its own check rejected it. No answer was asserted.",
            retryable: upstream.retryable ?? true,
        };
    }
    if (status === 400 || status === 413) {
        return {
            ...upstreamFields,
            code: "acr_rejected_request",
            message:
                status === 413 ? REFUSAL_COPY.lead : "Ask Dev rejected the investigation request.",
            retryable: false,
        };
    }
    if (status === 503) {
        // CHAOS-4333: this one wire signal (503 + upstream_unavailable) covers
        // EVERY contextfabric.ErrUnavailable/ErrModelUnavailable cause ACR's
        // own ErrorEnvelope has no room to distinguish -- confirmed live: the
        // exact same code+status fired both for a genuinely uncomposed
        // graph/model runtime AND for an unrelated Postgres CHECK-constraint
        // violation during result persistence (failure_stage=persistence,
        // never sent to the client -- ACR's own pginvestigation.sanitizeError
        // deliberately keeps it off the wire). A message naming ONE specific
        // cause is confidently wrong for the others; the honest thing is the
        // same discipline acr_investigation_failed already uses below --
        // state what's known (ACR answered, a dependency behind it is down)
        // and point at the request id for the rest.
        return {
            ...upstreamFields,
            code: "acr_runtime_unavailable",
            message:
                "Ask Dev is reachable, but something it needs (its graph data, its model, or its own storage) is unavailable right now. Quote the reference below to find out which and why.",
            retryable: true,
        };
    }
    if (status === 429) {
        return {
            ...upstreamFields,
            code: "acr_rate_limited",
            message: NOT_RUN_COPY.rate_limited,
            retryable: true,
        };
    }
    if (status === 504 || status === 408) {
        // Observed live: ACR's global ACR_REQUEST_TIMEOUT (15s by default) can
        // fire before its own model call finishes (45s by default), so a real
        // model-backed investigation times out at the HTTP layer while the
        // pipeline is still running. Naming this separately from "unreachable"
        // is what makes that diagnosable from the UI.
        return {
            ...upstreamFields,
            code: "acr_timeout",
            message:
                "Ask Dev accepted the investigation but did not finish it within its time budget.",
            retryable: true,
        };
    }
    if (status >= 500) {
        // ACR answered, so this is not a reachability problem — the engine ran
        // and failed. It deliberately keeps the underlying reason off the wire,
        // so the honest thing to show is the failure plus ACR's request id for
        // log matching, not a guess at the cause.
        return {
            ...upstreamFields,
            code: "acr_investigation_failed",
            message:
                "Ask Dev ran the investigation and it failed before an answer. Quote the reference below to find out why.",
            retryable: upstream.retryable ?? false,
        };
    }
    return {
        ...upstreamFields,
        code: "acr_unreachable",
        message: "Ask Dev returned an unexpected response.",
        retryable: upstream.retryable ?? false,
    };
}

export type InvestigateOutcome =
    | { kind: "answered"; result: InvestigationResult }
    | { kind: "failed"; failure: WorkbenchFailure };

const failed = (failure: WorkbenchFailure): InvestigateOutcome => ({ kind: "failed", failure });

/**
 * Why the transport ended a run itself, in the Workbench's failure vocabulary. Short, plain words;
 * none names an internal service.
 */
export const TRANSPORT_FAILURES: Readonly<Record<TransportFailureReason, WorkbenchFailure>> = {
    stalled: {
        code: "acr_timeout",
        message: "Ask Dev stopped answering before it finished.",
        retryable: true,
    },
    admission_timeout: {
        code: "acr_timeout",
        message: "Ask Dev did not answer in time.",
        retryable: true,
    },
    budget_exhausted: {
        code: "acr_timeout",
        message: "Ask Dev had too little time left to run this.",
        retryable: true,
    },
    invalid_upstream: {
        code: "acr_contract_violation",
        message: "Ask Dev sent an answer this app could not read.",
        retryable: false,
    },
    authorization_required: {
        code: "acr_sign_in_required",
        message: "Signing you in to Ask Dev.",
        retryable: true,
    },
    session_ended: {
        code: "acr_sign_in_required",
        message: "Signing you in to Ask Dev.",
        retryable: true,
    },
    authorization_failed: {
        code: "acr_rejected_request",
        message: "Ask Dev could not sign you in.",
        retryable: false,
    },
    not_entitled: {
        code: "acr_rejected_request",
        message: "Your organization does not have Ask Dev.",
        retryable: false,
    },
    impersonating: {
        code: "acr_rejected_request",
        message: "Ask Dev is not available while you act as another user.",
        retryable: false,
    },
    authorization_limited: {
        code: "acr_rate_limited",
        message: "Too many sign-in attempts. Try again soon.",
        retryable: true,
    },
};

/**
 * The result must satisfy its own contract before the UI sees it. Anything else is an upstream
 * failure, reported as one.
 */
export function resultOutcome(payload: unknown): InvestigateOutcome {
    const form = (payload as { schema_version?: unknown } | null)?.schema_version;
    if (form === "context_fabric_answer_projection.v1") {
        return failed({
            code: "acr_answer_too_large",
            message: "This answer is too large to show here. Ask about a narrower scope.",
            retryable: false,
        });
    }
    const schema = resultSchemaFor(payload);
    if (schema === undefined) {
        const seen = (payload as { schema_version?: unknown } | null)?.schema_version;
        console.error("acr result carries an unsupported schema_version", {
            schema_version: typeof seen === "string" ? seen.slice(0, 80) : typeof seen,
        });
        return failed({
            code: "acr_contract_violation",
            message: "Ask Dev returned a result in a version this app does not accept.",
            retryable: false,
        });
    }
    const validation = validateContract(schema, payload);
    if (!validation.valid) {
        return failed({
            code: "acr_contract_violation",
            message: "Ask Dev returned a result that does not meet the required format.",
            details: validation.errors,
            retryable: false,
        });
    }
    // The cast is honest: the response schema declares the result's fields, and it just passed.
    return { kind: "answered", result: payload as InvestigationResult };
}

let cached:
    { readonly key: string; readonly calls: AcrCalls<InvestigationResult, unknown> } | undefined;

/** Tests only: drop the calls made for the page. */
export function resetInvestigateCallsForTest(): void {
    cached = undefined;
}

/** One set of calls per page, made on the first question. */
function callsFor(config: NonNullable<ReturnType<typeof acrClientConfig>>) {
    const key = `${config.issuer}|${config.clientId}|${config.redirectUri}`;
    if (cached?.key !== key) {
        cached = {
            key,
            calls: createAcrCalls<InvestigationResult, unknown>(config, {
                fetch: (input, init) => globalThis.fetch(input, init),
                now: () => Date.now(),
                token: getAcrAccessToken,
                rejected: reportAcrTokenRejected,
                authorize: authorizeByRedirect,
                envelope: streamEnvelopeValidators,
                validators: loadStreamValidators,
                isResult: isInvestigationResult,
            }),
        };
    }
    return cached.calls;
}

/**
 * The five structure-receipt fields, each with the id namespace its offers use (design brief
 * §2.1: none may accept another's). A wrong one REJECTS the request rather than being filtered:
 * a dropped receipt would run the re-ask without the tester's choice, and look exactly like it
 * working.
 */
const STRUCTURE_RECEIPT_FIELDS = [
    ["priorKindReceipts", STRUCTURE_RECEIPT_PREFIX.expected_kind],
    ["priorAnchorReceipts", STRUCTURE_RECEIPT_PREFIX.subject_anchor],
    ["priorHandleReceipts", STRUCTURE_RECEIPT_PREFIX.subject_handle],
    ["priorWindowReceipts", STRUCTURE_RECEIPT_PREFIX.window],
    ["priorCandidateReceipts", STRUCTURE_RECEIPT_PREFIX.subject_candidate],
] as const;

function hasForeignReceipt(options: InvestigationOptions): boolean {
    return STRUCTURE_RECEIPT_FIELDS.some(([field, prefix]) =>
        (options[field] ?? []).some((receipt) => !receipt.receipt_id.startsWith(prefix)),
    );
}

/** Asks one question of ACR from this page, and reads the stream to its terminal. */
export async function investigateFromBrowser(
    options: InvestigationOptions,
): Promise<InvestigateOutcome> {
    const question = options.question.trim();
    if (question === "" || codePointLength(question) > MAX_QUESTION_LENGTH) {
        return failed({
            code: "acr_rejected_request",
            message: `A question is required and must be at most ${MAX_QUESTION_LENGTH} characters.`,
            retryable: false,
        });
    }
    if (hasForeignReceipt(options)) {
        return failed({
            code: "acr_rejected_request",
            message:
                "A supplied choice was malformed. The request was rejected rather than run without the chosen selection.",
            retryable: false,
        });
    }
    const request = buildInvestigationRequest(
        question,
        options.priorSubjectReceipts ?? [],
        {
            priorKindReceipts: options.priorKindReceipts,
            priorAnchorReceipts: options.priorAnchorReceipts,
            priorHandleReceipts: options.priorHandleReceipts,
            priorWindowReceipts: options.priorWindowReceipts,
            priorCandidateReceipts: options.priorCandidateReceipts,
        },
        options.conversation ?? [],
        options.expectedKinds ?? [],
        options.parentResultId,
        options.subjectHints ?? [],
    );
    // Validated BEFORE it is sent, so a mistake in this app surfaces here, not as an opaque 400.
    const requestValidation = validateContract(
        "context_fabric_investigation_request.v1.schema.json",
        request,
    );
    if (!requestValidation.valid) {
        return failed({
            code: "acr_rejected_request",
            message: "This app built an investigation request in the wrong format.",
            details: requestValidation.errors,
            retryable: false,
        });
    }
    const config = acrClientConfig();
    if (config === undefined) {
        return failed({
            code: "workbench_misconfigured",
            message: "Ask Dev is not configured here.",
            retryable: false,
        });
    }

    const timeout = AbortSignal.timeout(RUN_TIMEOUT_DEFAULT_MS);
    const signal =
        options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);
    try {
        const events = callsFor(config).investigate({
            request,
            submissionId: crypto.randomUUID(),
            threadId: crypto.randomUUID(),
            deadline: Date.now() + RUN_TIMEOUT_DEFAULT_MS,
            signal,
        });
        for await (const event of events) {
            if (event.type === "result") return resultOutcome(event.result);
            if (event.type === "error") {
                return failed(
                    failureFor(event.error.error.http_status, parseUpstreamError(event.error)),
                );
            }
        }
        // The stream ended with no terminal event: it was interrupted, which is neither an
        // answer nor a failure ACR reported.
        return failed({
            code: "acr_unreachable",
            message: "Ask Dev could not be reached.",
            retryable: true,
        });
    } catch (error) {
        if (error instanceof TransportRefusal) {
            return failed(failureFor(error.status, parseUpstreamError(error.error)));
        }
        if (error instanceof TransportFailure) return failed(TRANSPORT_FAILURES[error.reason]);
        // Only the local timer counts as a timeout: an abort by the caller is not one.
        if (timeout.aborted) {
            return failed({
                code: "acr_timeout",
                message: "Ask Dev did not answer in time.",
                retryable: true,
            });
        }
        return failed({
            code: "acr_unreachable",
            message: "Ask Dev could not be reached.",
            retryable: true,
        });
    }
}
