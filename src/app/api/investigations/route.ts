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
};

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
        case "acr_runtime_unavailable":
            return 503;
        case "acr_timeout":
            return 504;
        case "acr_contract_violation":
        case "acr_unreachable":
            return 502;
        case "workbench_misconfigured":
            return 500;
    }
}

export async function POST(request: Request): Promise<NextResponse> {
    let body: InvestigateBody;
    try {
        body = (await request.json()) as InvestigateBody;
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
        const result = await investigate(config, { question, signal: request.signal });
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
