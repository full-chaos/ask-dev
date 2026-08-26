import "server-only";

import { randomUUID } from "node:crypto";

import { signWebAssertion } from "@/lib/acr/assertion";
import type { AcrRuntimeConfig } from "@/lib/acr/config";
import { AcrRequestError, type WorkbenchFailure } from "@/lib/acr/errors";
import { boundedUpstreamCode, boundedUpstreamRequestId } from "@/lib/acr/upstream-vocabulary";
import { validateContract } from "@/lib/acr/validate";
import { MAX_CONVERSATION_TURNS_ON_WIRE } from "@/lib/conversation";
import type {
    BoundStructureReceipt,
    ConversationTurn,
    InvestigationRequest,
    InvestigationResult,
} from "@/lib/contracts";

/**
 * Server-only client for ACR's Context Fabric investigation API.
 *
 * The Workbench calls the REAL investigation API — it never consumes a mock
 * result (CHAOS-3738 hard boundary). When ACR cannot answer, this surfaces the
 * failure honestly instead of substituting anything.
 *
 * Verified against the live local stack: signing, method/path binding, and
 * body-digest binding all pass; see `signWebAssertion` for the empty-scopes
 * trap that a first-time consumer will otherwise hit as an opaque 401.
 */

const INVESTIGATION_PATH = "/api/v1/context-fabric/investigations";
const RESULT_SCHEMA = "context_fabric_investigation_result.v1.schema.json";

/**
 * Upper bound on a result payload, in BYTES.
 *
 * It was compared against `text.length`, which is UTF-16 units — not bytes, so
 * the cap was both misnamed and looser than it read for any multibyte payload.
 * Measured properly now.
 *
 * Worth being precise about what it does and does not do, because the name
 * implies more than it delivers: the check runs AFTER `response.text()` has
 * materialised the body, so it cannot protect against the allocation. It is a
 * contract sanity bound — a payload this size is not an answer — not a memory
 * guard. Making it one would mean bounding the read itself.
 */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * Exported so the unit is testable.
 *
 * Left inline, the byte-vs-UTF-16 fix was unpinned: reverting it to `.length`
 * kept the whole suite green, which makes it indistinguishable from a fix that
 * was never made.
 */
export function exceedsResponseCap(text: string): boolean {
    return Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES;
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
    // Chat-surface conversation threading. See src/lib/conversation.ts's own
    // header: the Workbench never supplies this (it asks one independent
    // question at a time by design), so it defaults to empty below exactly
    // as it always has.
    readonly conversation?: readonly ConversationTurn[] | undefined;
    readonly signal?: AbortSignal;
};

function requestId(): string {
    return `request_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
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
    // absent key. `client.test.ts` pins this behavior.
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

    return {
        schema_version: "context_fabric_investigation_request.v1",
        request_id: requestId(),
        question,
        ...(conversationTurns.length > 0 ? { conversation: conversationTurns } : {}),
        prior_subject_receipts: receipts,
        ...structureFields,
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
};

function parseUpstreamError(payload: unknown): UpstreamError {
    if (typeof payload !== "object" || payload === null) return {};
    // `request_id` sits at the TOP level of error.v1, not inside `error`.
    const requestId = (payload as { request_id?: unknown }).request_id;
    const error = (payload as { error?: unknown }).error;
    const base = typeof requestId === "string" ? { requestId } : {};
    if (typeof error !== "object" || error === null) return base;
    // `message` is read past deliberately; see UpstreamError.
    const { code, retryable } = error as Record<string, unknown>;
    return {
        ...base,
        ...(typeof code === "string" ? { code } : {}),
        ...(typeof retryable === "boolean" ? { retryable } : {}),
    };
}

/**
 * Maps an upstream status onto the Workbench's failure vocabulary.
 *
 * 503 is called out on purpose: ACR serves a STATIC 503 from
 * `handleRuntimeUnavailable` when the investigator is not composed — which
 * happens when graph reads are disabled, the graph backend is unconfigured, or
 * no model runtime is configured. That is an operator state, not a transient
 * blip, and saying so saves the next person the hour it cost to find.
 */
function failureFor(status: number, upstream: UpstreamError): WorkbenchFailure {
    // Both upstream fields are bounded before they can be carried anywhere.
    // "Usually an identifier" is not a guarantee, and an upstream that put a
    // sentence in either would otherwise put it straight into the DOM.
    const code = boundedUpstreamCode(upstream.code);
    const upstreamRequestId = boundedUpstreamRequestId(upstream.requestId);
    const upstreamFields = {
        httpStatus: status,
        ...(code === undefined ? {} : { upstreamCode: code }),
        ...(upstreamRequestId === undefined ? {} : { upstreamRequestId }),
    };
    if (status === 401 || status === 403) {
        return {
            ...upstreamFields,
            code: "acr_unauthorized",
            message: "ACR rejected the Workbench credential for this organization.",
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
                "ACR derived an answer and its own validator rejected it. No answer was asserted.",
            retryable: upstream.retryable ?? true,
        };
    }
    if (status === 400 || status === 413) {
        return {
            ...upstreamFields,
            code: "acr_rejected_request",
            message: "ACR rejected the investigation request.",
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
                "ACR is reachable, but a dependency it needs (its graph store, model runtime, or its own persistence) is currently unavailable. Match the ACR request id below against ACR's logs for which one and why.",
            retryable: true,
        };
    }
    if (status === 429) {
        return {
            ...upstreamFields,
            code: "acr_rate_limited",
            message: "ACR is rate limiting the Workbench. Back off and retry later.",
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
                "ACR accepted the investigation but did not finish it within its request budget.",
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
                "ACR ran the investigation and it failed inside the engine. Match the ACR request id below against ACR's logs for the reason.",
            retryable: upstream.retryable ?? false,
        };
    }
    return {
        ...upstreamFields,
        code: "acr_unreachable",
        message: `ACR returned an unexpected status (${String(status)}).`,
        retryable: upstream.retryable ?? false,
    };
}

export async function investigate(
    config: AcrRuntimeConfig,
    options: InvestigationOptions,
): Promise<InvestigationResult> {
    const request = buildInvestigationRequest(
        options.question,
        options.priorSubjectReceipts ?? [],
        {
            priorKindReceipts: options.priorKindReceipts,
            priorAnchorReceipts: options.priorAnchorReceipts,
            priorHandleReceipts: options.priorHandleReceipts,
            priorWindowReceipts: options.priorWindowReceipts,
            priorCandidateReceipts: options.priorCandidateReceipts,
        },
        options.conversation ?? [],
    );
    const body = JSON.stringify(request);

    // The request is validated against the pinned schema BEFORE it is sent, so
    // a Workbench-side mistake surfaces here rather than as an opaque ACR 400.
    const requestValidation = validateContract(
        "context_fabric_investigation_request.v1.schema.json",
        request,
    );
    if (!requestValidation.valid) {
        throw new AcrRequestError({
            code: "acr_rejected_request",
            message: "The Workbench built an investigation request that violates the contract.",
            details: requestValidation.errors,
            retryable: false,
        });
    }

    const timeout = AbortSignal.timeout(config.timeoutMs);
    const signal =
        options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);

    // Sign OUTSIDE the fetch try/catch, deliberately.
    //
    // Signing inside it meant a configuration fault — an empty
    // `repository_scopes`, an unusable key — was caught by the transport
    // handler and reported as "ACR could not be reached". That sends whoever is
    // debugging to the network when the fault is local config, and the call was
    // never even attempted. A misconfiguration must never present as an
    // upstream problem.
    let assertion: string;
    try {
        assertion = signWebAssertion({
            body,
            config,
            method: "POST",
            orgId: config.orgId,
            path: INVESTIGATION_PATH,
            permissions: ["context:read", "evidence:read"],
            privateKey: config.privateKey,
            repositoryScopes: config.repositoryScopes,
            subject: config.subject,
        });
    } catch (error) {
        throw new AcrRequestError({
            code: "workbench_misconfigured",
            message:
                error instanceof Error
                    ? `The server could not sign the ACR assertion: ${error.message}`
                    : "The server could not sign the ACR assertion.",
            retryable: false,
        });
    }

    let response: Response;
    const fetchStartedAt = Date.now();
    try {
        response = await fetch(`${config.apiOrigin}${INVESTIGATION_PATH}`, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "X-ACR-Client-Version": "0.1.0",
                "X-Request-ID": randomUUID(),
                "X-ACR-Web-Assertion": assertion,
            },
            body,
            signal,
            cache: "no-store",
        });
    } catch (_error) {
        // `timeout.aborted` (the LOCAL AbortSignal.timeout instance, not
        // `error.name`) is the gate: `signal` above is `AbortSignal.any([
        // options.signal, timeout])` when a caller supplies its own signal
        // (the chat route forwards the incoming request's), and an external
        // abort can surface with the same "TimeoutError" name without our
        // own budget ever having fired -- checking the name alone would
        // misclassify that as a local timeout it was not (codex review).
        // A real `timeout.aborted` means no response ever arrived, which is
        // a DIFFERENT fact from the network being unreachable (a DNS/TCP
        // failure) and from ACR's own 504 (a real response saying the
        // pipeline was still running, handled separately below via
        // `parseUpstreamFailure`). Collapsing all three into
        // `acr_unreachable` is exactly what `acr_timeout`'s own doc comment
        // (errors.ts) warns against: a tester cannot tell "the Workbench
        // gave up waiting" from "the service could not be reached at all"
        // without this distinction.
        if (timeout.aborted) {
            throw new AcrRequestError({
                code: "acr_timeout",
                message: `ACR did not answer within the Workbench's ${String(config.timeoutMs)}ms budget (waited ${String(Date.now() - fetchStartedAt)}ms).`,
                retryable: true,
            });
        }
        throw new AcrRequestError({
            code: "acr_unreachable",
            message: "ACR could not be reached.",
            retryable: true,
        });
    }

    const text = await response.text();
    if (exceedsResponseCap(text)) {
        throw new AcrRequestError({
            code: "acr_contract_violation",
            message: "ACR returned a response larger than the Workbench accepts.",
            httpStatus: response.status,
            retryable: false,
        });
    }

    let payload: unknown;
    try {
        payload = JSON.parse(text);
    } catch {
        throw new AcrRequestError({
            code: "acr_contract_violation",
            message: "ACR returned a response that is not JSON.",
            httpStatus: response.status,
            retryable: false,
        });
    }

    if (!response.ok) {
        throw new AcrRequestError(failureFor(response.status, parseUpstreamError(payload)));
    }

    // The result must satisfy its own contract before the UI sees it. Anything
    // else is an upstream failure, reported as one.
    const validation = validateContract(RESULT_SCHEMA, payload);
    if (!validation.valid) {
        throw new AcrRequestError({
            code: "acr_contract_violation",
            message: "ACR returned a result that does not satisfy the investigation contract.",
            httpStatus: response.status,
            details: validation.errors,
            retryable: false,
        });
    }

    // The cast is honest: `validation` above proved `payload` satisfies the
    // pinned result schema, and that schema now declares `InvestigationResult`
    // itself (THE SEAM landed — see `@/lib/contracts`'s own header), so this
    // is the same validated-payload cast every other contract type in this
    // file already relies on.
    return payload as InvestigationResult;
}
