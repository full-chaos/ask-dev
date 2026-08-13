import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildInvestigationRequest, investigate } from "@/lib/acr/client";
import type { AcrRuntimeConfig } from "@/lib/acr/config";
import { AcrRequestError, type WorkbenchFailure } from "@/lib/acr/errors";
import { validateContract } from "@/lib/acr/validate";
import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";

const { privateKey } = generateKeyPairSync("ed25519");

const config: AcrRuntimeConfig = {
    apiOrigin: "http://acr.test",
    audience: "dev-health-acr",
    issuer: "dev-health-web",
    keyId: "acr-dev-web",
    orgId: "70d529e0-3c06-4597-8480-794fd02328b6",
    privateKey,
    repositoryScopes: ["full.chaos/dev-health-ops"],
    subject: "context-fabric-workbench",
    timeoutMs: 5_000,
};

function respondWith(body: unknown, status = 200): void {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
        }),
    );
}

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Asserts the call fails and returns the failure.
 *
 * Written as a helper rather than `.catch(e => e.failure)` on purpose: if
 * `investigate` unexpectedly SUCCEEDS, the catch never runs and the assertions
 * below would silently compare against a result object instead of a failure.
 * This turns that into an explicit, readable failure.
 */
async function failureOf(call: Promise<unknown>): Promise<WorkbenchFailure> {
    try {
        await call;
    } catch (error) {
        if (error instanceof AcrRequestError) return error.failure;
        throw error;
    }
    throw new Error("expected the investigation to fail, but it resolved");
}

function requestUrl(input: string | URL | Request): string {
    if (typeof input === "string") return input;
    return input instanceof URL ? input.href : input.url;
}

describe("buildInvestigationRequest", () => {
    it("builds a request that satisfies the pinned request contract", () => {
        const request = buildInvestigationRequest("What is the status of dev-health-ops?");
        const validation = validateContract(
            "context_fabric_investigation_request.v1.schema.json",
            request,
        );
        expect(validation.valid, validation.errors.join("; ")).toBe(true);
    });

    it("identifies the Workbench as the consumer so ACR can attribute the traffic", () => {
        expect(buildInvestigationRequest("q").consumer).toEqual({
            name: "context-fabric-workbench",
            version: "0.1.0",
            surface: "workbench",
        });
    });
});

describe("investigate", () => {
    it("sends a signed assertion bound to the investigation path", async () => {
        respondWith(canonicalResult);
        await investigate(config, { question: "status?" });

        const call = vi.mocked(globalThis.fetch).mock.calls[0]!;
        expect(requestUrl(call[0])).toBe("http://acr.test/api/v1/context-fabric/investigations");
        const headers = (call[1]?.headers ?? {}) as Record<string, string>;
        const assertion = headers["X-ACR-Web-Assertion"];
        expect(assertion).toBeDefined();
        const claims = JSON.parse(
            Buffer.from(assertion!.split(".")[1]!, "base64url").toString("utf8"),
        ) as Record<string, unknown>;
        expect(claims["path"]).toBe("/api/v1/context-fabric/investigations");
        expect(claims["repository_scopes"]).toEqual(["full.chaos/dev-health-ops"]);
    });

    it("returns a contract-valid result unchanged", async () => {
        respondWith(canonicalResult);
        await expect(investigate(config, { question: "status?" })).resolves.toEqual(
            canonicalResult,
        );
    });

    /**
     * The live 503 this milestone actually hit. It is an operator state, not a
     * blip, so the message has to say what must be true rather than "try again".
     */
    it("maps ACR's static 503 to acr_runtime_unavailable with an actionable message", async () => {
        respondWith(
            {
                schema_version: "error.v1",
                error: {
                    code: "upstream_unavailable",
                    message: "Hosted read runtime is temporarily unavailable",
                    http_status: 503,
                    retryable: true,
                },
            },
            503,
        );

        const failure = await failureOf(investigate(config, { question: "status?" }));
        expect(failure.code).toBe("acr_runtime_unavailable");
        expect(failure.upstreamCode).toBe("upstream_unavailable");
        expect(failure.message).toMatch(/graph reads enabled/);
        expect(failure.retryable).toBe(true);
    });

    it("maps a 401 to acr_unauthorized and never retries it", async () => {
        respondWith(
            { schema_version: "error.v1", error: { code: "invalid_token", http_status: 401 } },
            401,
        );

        const failure = await failureOf(investigate(config, { question: "q" }));
        expect(failure.code).toBe("acr_unauthorized");
        expect(failure.retryable).toBe(false);
    });

    /**
     * The Workbench must not render a payload it does not understand as if it
     * were an answer. A result failing its own contract is an upstream failure.
     */
    it("rejects a 200 whose body violates the investigation contract", async () => {
        const tainted = structuredClone(canonicalResult) as unknown as Record<string, unknown>;
        delete tainted["coverage"];
        respondWith(tainted);

        const failure = await failureOf(investigate(config, { question: "q" }));
        expect(failure.code).toBe("acr_contract_violation");
        expect(failure.details?.join("; ")).toMatch(/coverage/);
    });

    it("rejects a 200 that is not JSON", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>nope</html>"));

        const failure = await failureOf(investigate(config, { question: "q" }));
        expect(failure.code).toBe("acr_contract_violation");
    });

    /**
     * Observed live against the local stack: ACR's global request budget (15s)
     * fires before its own model call budget (45s), so a real model-backed
     * investigation returns 504 while the pipeline is still running. That is
     * not "unreachable" — the call landed and the engine worked.
     */
    it("distinguishes a mid-investigation timeout from an unreachable service", async () => {
        respondWith(
            {
                schema_version: "error.v1",
                error: {
                    code: "upstream_unavailable",
                    message: "The Context Fabric investigation timed out",
                    http_status: 504,
                    retryable: true,
                },
            },
            504,
        );

        const failure = await failureOf(investigate(config, { question: "q" }));
        expect(failure.code).toBe("acr_timeout");
        expect(failure.httpStatus).toBe(504);
        expect(failure.retryable).toBe(true);
    });

    it("reports an unreachable service rather than throwing raw", async () => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

        const failure = await failureOf(investigate(config, { question: "q" }));
        expect(failure.code).toBe("acr_unreachable");
        expect(failure.retryable).toBe(true);
    });

    /**
     * A local configuration fault must be reported as one. Signing used to sit
     * inside the transport try/catch, so this surfaced as "ACR could not be
     * reached" — pointing whoever is debugging at the network when the call had
     * not even been attempted.
     */
    it("reports a missing repository scope as misconfiguration, not an unreachable service", async () => {
        const spy = vi.spyOn(globalThis, "fetch");

        const failure = await failureOf(
            investigate({ ...config, repositoryScopes: [] }, { question: "q" }),
        );

        expect(failure.code).toBe("workbench_misconfigured");
        expect(failure.message).toMatch(/empty repository_scopes/);
        expect(failure.retryable).toBe(false);
        expect(spy).not.toHaveBeenCalled();
    });
});
