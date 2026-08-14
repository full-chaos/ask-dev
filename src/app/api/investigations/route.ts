import { NextResponse } from "next/server";

import { investigate } from "@/lib/acr/client";
import { AcrConfigError, loadAcrRuntimeConfig } from "@/lib/acr/config";
import { AcrRequestError, type WorkbenchFailure } from "@/lib/acr/errors";

/**
 * The Workbench's server hop to ACR.
 *
 * It exists because neither ACR credential can live in a browser: `bearerAuth`
 * is a client secret, and `webAssertionAuth` requires signing with an Ed25519
 * private key. This route holds the key, signs per request, and returns only
 * the investigation result.
 *
 * Interaction boundary (CHAOS-3738): submit a question. Nothing here mutates
 * product state, and the route exposes no ACR surface beyond investigations.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUESTION_LENGTH = 8_000;

type InvestigateBody = {
    readonly question?: unknown;
    readonly priorSubjectReceipts?: unknown;
};

/**
 * Receipts are validated, not trusted — and a malformed one REJECTS the
 * request rather than being filtered out of it.
 *
 * Filtering was the original behaviour and it was wrong for the same reason
 * OpenUI's silent `excess-args` drop is wrong: a discarded receipt means the
 * re-ask runs WITHOUT the tester's chosen subject, and they get a fresh
 * clarification with no indication their choice was thrown away. The
 * disambiguation flow silently not working looks exactly like it working.
 *
 * Identity is still ACR's to enforce — verified at pin 0ed4e1a that the result
 * lookup is org-scoped in SQL (`pginvestigation/store.go:202-203`) and that a
 * receipt must match a candidate of that same result (`engine.go:404-414`). The
 * route's job is shape only.
 */
function parseReceipts(value: unknown): readonly { result_id: string; receipt_id: string }[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new MalformedReceiptError();
    return value.map((entry) => {
        if (typeof entry !== "object" || entry === null) throw new MalformedReceiptError();
        const { result_id: resultId, receipt_id: receiptId } = entry as Record<string, unknown>;
        if (typeof resultId !== "string" || typeof receiptId !== "string") {
            throw new MalformedReceiptError();
        }
        // The contract's own minLength for both identifiers.
        if (resultId.length < 8 || receiptId.length < 8) throw new MalformedReceiptError();
        return { result_id: resultId, receipt_id: receiptId };
    });
}

class MalformedReceiptError extends Error {
    override readonly name = "MalformedReceiptError";
}

function failureResponse(failure: WorkbenchFailure, status: number): NextResponse {
    return NextResponse.json({ failure }, { status });
}

function statusFor(failure: WorkbenchFailure): number {
    switch (failure.code) {
        case "acr_unauthorized":
            // Deliberately NOT proxied as 401: the browser session is fine, the
            // SERVER's credential is not. A 401 here would invite a client-side
            // re-auth that cannot possibly help.
            return 502;
        case "acr_rejected_request":
            return 400;
        case "acr_answer_rejected":
            // 422 passes through: the request was fine, the derived answer was
            // rejected by ACR's own bounds. That is a real outcome to render,
            // not a client error to correct.
            return 422;
        case "acr_rate_limited":
            return 429;
        case "acr_runtime_unavailable":
            return 503;
        case "acr_timeout":
            return 504;
        case "acr_contract_violation":
        case "acr_investigation_failed":
        case "acr_unreachable":
            return 502;
        case "workbench_misconfigured":
            return 500;
    }
}

export async function POST(request: Request): Promise<NextResponse> {
    let body: InvestigateBody;
    try {
        const parsed: unknown = await request.json();
        // `JSON.parse("null")` is null, and a bare scalar body parses too — both
        // would crash on the first property read below. A malformed body must
        // be a controlled 400, never an unhandled throw.
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return failureResponse(
                {
                    code: "acr_rejected_request",
                    message: "The request body must be a JSON object.",
                    retryable: false,
                },
                400,
            );
        }
        // No assertion needed: the guard above already narrowed `parsed` to a
        // non-null, non-array object, and every InvestigateBody field is
        // optional and `unknown`.
        body = parsed;
    } catch {
        return failureResponse(
            {
                code: "acr_rejected_request",
                message: "The request body must be JSON.",
                retryable: false,
            },
            400,
        );
    }

    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (question === "" || question.length > MAX_QUESTION_LENGTH) {
        return failureResponse(
            {
                code: "acr_rejected_request",
                message: `A question is required and must be at most ${MAX_QUESTION_LENGTH} characters.`,
                retryable: false,
            },
            400,
        );
    }

    // Request validation runs BEFORE configuration loading, deliberately. A
    // malformed request is the caller's fault whatever the server's state, and
    // answering it with "the Workbench server is not configured" would
    // misattribute the fault — the same misdiagnosis as reporting a local
    // config fault as an unreachable service.
    let priorSubjectReceipts: readonly { result_id: string; receipt_id: string }[];
    try {
        priorSubjectReceipts = parseReceipts(body.priorSubjectReceipts);
    } catch {
        return failureResponse(
            {
                code: "acr_rejected_request",
                message:
                    "A supplied clarification receipt was malformed. The request was rejected rather than run without the chosen subject.",
                retryable: false,
            },
            400,
        );
    }

    let config;
    try {
        config = loadAcrRuntimeConfig();
    } catch (error) {
        // Configuration errors name the missing variable but never its value,
        // and never key material.
        return failureResponse(
            {
                code: "workbench_misconfigured",
                message:
                    error instanceof AcrConfigError
                        ? `The Workbench server is not configured: ${error.message}.`
                        : "The Workbench server is not configured.",
                retryable: false,
            },
            500,
        );
    }

    try {
        const result = await investigate(config, {
            question,
            priorSubjectReceipts,
            signal: request.signal,
        });
        return NextResponse.json({ result }, { status: 200 });
    } catch (error) {
        if (error instanceof AcrRequestError) {
            return failureResponse(error.failure, statusFor(error.failure));
        }
        // An unexpected throw must not leak a stack or a header value.
        console.error("investigation failed", error);
        return failureResponse(
            {
                code: "acr_unreachable",
                message: "The investigation failed for an unexpected reason.",
                retryable: true,
            },
            502,
        );
    }
}
