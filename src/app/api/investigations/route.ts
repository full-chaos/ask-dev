import { NextResponse } from "next/server";

import { investigate } from "@/lib/acr/client";
import { AcrConfigError, loadAcrRuntimeConfig } from "@/lib/acr/config";
import { AcrRequestError, type WorkbenchFailure } from "@/lib/acr/errors";
import { STRUCTURE_RECEIPT_PREFIX, type BoundStructureReceipt } from "@/lib/contracts";

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

/**
 * Counts CODE POINTS, not UTF-16 units.
 *
 * ACR bounds the question at 8000 runes (Go's RuneCountInString, which is also
 * what JSON Schema's `maxLength` means, and what Ajv implements via ucs2length
 * — verified against the pinned dependency rather than assumed). JavaScript's
 * `.length` counts UTF-16 units, so an astral character counts twice: a
 * question of exactly 8000 astral code points measures 16000 and was rejected
 * here while ACR would have accepted it.
 *
 * That is the same class as validating before configuration — a guard that
 * answers before the authoritative check, and answers differently — with the
 * added harm that the Workbench blamed the tester's input for its own defect.
 * Origin: a question from lane-3746 about Ajv; Ajv was correct, this was not.
 */
function codePointLength(value: string): number {
    return [...value].length;
}

type InvestigateBody = {
    readonly question?: unknown;
    readonly priorSubjectReceipts?: unknown;
    // CHAOS-3927 P2 (pivot-intent design brief §2.1/§2.2). Four NEW, PARALLEL
    // fields, following `priorSubjectReceipts`'s own precedent exactly — each
    // names a different offer set (StructureNeeds.kind_options/anchor_options/
    // handle_options/window_options) and is validated against its OWN closed
    // receipt-id namespace (kindr_/ancr_/handr_/winr_), never against
    // priorSubjectReceipts' unconstrained shape.
    readonly priorKindReceipts?: unknown;
    readonly priorAnchorReceipts?: unknown;
    readonly priorHandleReceipts?: unknown;
    readonly priorWindowReceipts?: unknown;
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
/**
 * `expectedPrefix` extends this to the four CHAOS-3927 structure-receipt
 * fields (kindr_/ancr_/handr_/winr_, design brief §2.1's closed namespace
 * set): "none of the four ... may ever accept another's namespace." Absent
 * (the `priorSubjectReceipts` call site) means no namespace constraint,
 * matching that field's own contract shape (`BoundSubjectReceipt`) exactly —
 * unchanged behavior for the existing path.
 */
function parseReceipts(value: unknown, expectedPrefix?: string): readonly BoundStructureReceipt[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new MalformedReceiptError();
    return value.map((entry) => {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
            throw new MalformedReceiptError();
        }
        const record = entry as Record<string, unknown>;
        // FULL contract shape, not just presence. The contract's
        // BoundSubjectReceipt sets additionalProperties:false and bounds both
        // ids to 8..256 — checking only type and minimum length let an
        // over-long id through stage 1 and fail later, which is the same
        // stage-misattribution class as validating after configuration.
        const keys = Object.keys(record);
        if (keys.length !== 2 || !keys.includes("result_id") || !keys.includes("receipt_id")) {
            throw new MalformedReceiptError();
        }
        const { result_id: resultId, receipt_id: receiptId } = record;
        for (const identifier of [resultId, receiptId]) {
            if (typeof identifier !== "string") throw new MalformedReceiptError();
            // Code points here too. Receipt ids are ACR-generated ASCII today,
            // so this is not reachable in practice — but what makes it safe is
            // a property of today's ACR, not of this code, and that is not a
            // reason to measure the wrong thing.
            const length = codePointLength(identifier);
            if (length < 8 || length > 256) throw new MalformedReceiptError();
        }
        if (expectedPrefix !== undefined && !(receiptId as string).startsWith(expectedPrefix)) {
            throw new MalformedReceiptError();
        }
        return { result_id: resultId as string, receipt_id: receiptId as string };
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
    if (question === "" || codePointLength(question) > MAX_QUESTION_LENGTH) {
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
    let priorSubjectReceipts: readonly BoundStructureReceipt[];
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

    // CHAOS-3927 P2: same discipline as priorSubjectReceipts above, extended
    // to the four structure-receipt namespaces (§2.1) — a malformed entry
    // rejects the WHOLE request rather than being silently dropped, because a
    // dropped structure receipt means the re-ask runs without the tester's
    // selection and looks exactly like it working (the same C5/Item-1 class
    // this route already closes for subject receipts).
    const STRUCTURE_RECEIPT_FIELDS = [
        ["priorKindReceipts", STRUCTURE_RECEIPT_PREFIX.expected_kind, "kind"],
        ["priorAnchorReceipts", STRUCTURE_RECEIPT_PREFIX.subject_anchor, "repository/project/team"],
        ["priorHandleReceipts", STRUCTURE_RECEIPT_PREFIX.subject_handle, "handle"],
        ["priorWindowReceipts", STRUCTURE_RECEIPT_PREFIX.window, "time window"],
    ] as const;

    const structureReceipts: Record<string, readonly BoundStructureReceipt[]> = {};
    for (const [field, prefix, label] of STRUCTURE_RECEIPT_FIELDS) {
        try {
            structureReceipts[field] = parseReceipts(body[field], prefix);
        } catch {
            return failureResponse(
                {
                    code: "acr_rejected_request",
                    message: `A supplied ${label} structure receipt was malformed. The request was rejected rather than run without the chosen selection.`,
                    retryable: false,
                },
                400,
            );
        }
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
                        ? `The server is not configured: ${error.message}.`
                        : "The server is not configured.",
                retryable: false,
            },
            500,
        );
    }

    try {
        const result = await investigate(config, {
            question,
            priorSubjectReceipts,
            priorKindReceipts: structureReceipts.priorKindReceipts,
            priorAnchorReceipts: structureReceipts.priorAnchorReceipts,
            priorHandleReceipts: structureReceipts.priorHandleReceipts,
            priorWindowReceipts: structureReceipts.priorWindowReceipts,
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
