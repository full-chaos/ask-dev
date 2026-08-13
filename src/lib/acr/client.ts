import "server-only";

import { randomUUID } from "node:crypto";

import { signWebAssertion } from "@/lib/acr/assertion";
import type { AcrRuntimeConfig } from "@/lib/acr/config";
import { AcrRequestError, type WorkbenchFailure } from "@/lib/acr/errors";
import { validateContract } from "@/lib/acr/validate";
import type { InvestigationRequest, InvestigationResult } from "@/lib/contracts";

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

/** Response cap. A result that exceeds it is a contract violation, not an answer. */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export type InvestigationOptions = {
    readonly question: string;
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
export function buildInvestigationRequest(question: string): InvestigationRequest {
    return {
        schema_version: "context_fabric_investigation_request.v1",
        request_id: requestId(),
        question,
        conversation: [],
        prior_subject_receipts: [],
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

type UpstreamError = {
    readonly code?: string;
    readonly message?: string;
    readonly retryable?: boolean;
};

function parseUpstreamError(payload: unknown): UpstreamError {
    if (typeof payload !== "object" || payload === null) return {};
    const error = (payload as { error?: unknown }).error;
    if (typeof error !== "object" || error === null) return {};
    const { code, message, retryable } = error as Record<string, unknown>;
    return {
        ...(typeof code === "string" ? { code } : {}),
        ...(typeof message === "string" ? { message } : {}),
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
    const upstreamFields = {
        httpStatus: status,
        ...(upstream.code === undefined ? {} : { upstreamCode: upstream.code }),
    };
    if (status === 401 || status === 403) {
        return {
            ...upstreamFields,
            code: "acr_unauthorized",
            message:
                upstream.message ?? "ACR rejected the Workbench credential for this organization.",
            retryable: false,
        };
    }
    if (status === 400 || status === 413 || status === 422) {
        return {
            ...upstreamFields,
            code: "acr_rejected_request",
            message: upstream.message ?? "ACR rejected the investigation request.",
            retryable: false,
        };
    }
    if (status === 503) {
        return {
            ...upstreamFields,
            code: "acr_runtime_unavailable",
            message:
                "ACR is reachable but its investigation runtime is not composed. This needs graph reads enabled, a configured graph backend, and a configured model runtime.",
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
    return {
        ...upstreamFields,
        code: "acr_unreachable",
        message: upstream.message ?? `ACR returned an unexpected status (${status}).`,
        retryable: upstream.retryable ?? status >= 500,
    };
}

export async function investigate(
    config: AcrRuntimeConfig,
    options: InvestigationOptions,
): Promise<InvestigationResult> {
    const request = buildInvestigationRequest(options.question);
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
                    ? `The Workbench could not sign the ACR assertion: ${error.message}`
                    : "The Workbench could not sign the ACR assertion.",
            retryable: false,
        });
    }

    let response: Response;
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
    } catch (error) {
        throw new AcrRequestError({
            code: "acr_unreachable",
            message:
                error instanceof Error && error.name === "TimeoutError"
                    ? "ACR did not answer before the Workbench timeout."
                    : "ACR could not be reached.",
            retryable: true,
        });
    }

    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
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

    return payload as InvestigationResult;
}
