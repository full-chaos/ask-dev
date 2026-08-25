import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildInvestigationRequest, exceedsResponseCap, investigate } from "@/lib/acr/client";
import type { AcrRuntimeConfig } from "@/lib/acr/config";
import { AcrRequestError, type WorkbenchFailure } from "@/lib/acr/errors";
import { acrErrorCodeVocabulary } from "@/lib/acr/upstream-vocabulary";
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

    /**
     * The re-ask carries the tester's clarification choice as ACR's own
     * receipt, and leaves the question untouched. Rewriting the question to
     * name the chosen subject would make the Workbench author part of it.
     */
    it("carries a clarification choice as a receipt without altering the question", () => {
        const request = buildInvestigationRequest("Is Atlas on track?", [
            { result_id: "result_clarify_0001", receipt_id: "receipt_atlas_project" },
        ]);

        expect(request.question).toBe("Is Atlas on track?");
        expect(request.prior_subject_receipts).toEqual([
            { result_id: "result_clarify_0001", receipt_id: "receipt_atlas_project" },
        ]);
        expect(
            validateContract("context_fabric_investigation_request.v1.schema.json", request).valid,
        ).toBe(true);
    });

    it("deduplicates receipts, which the contract requires to be unique", () => {
        const receipt = { result_id: "result_clarify_0001", receipt_id: "receipt_atlas_project" };
        const request = buildInvestigationRequest("q", [receipt, { ...receipt }]);

        expect(request.prior_subject_receipts).toHaveLength(1);
        expect(
            validateContract("context_fabric_investigation_request.v1.schema.json", request).valid,
        ).toBe(true);
    });

    it("caps receipts at the contract's maxItems rather than letting ACR reject them", () => {
        const many = Array.from({ length: 25 }, (_, index) => ({
            result_id: "result_clarify_0001",
            receipt_id: `receipt_${String(index).padStart(4, "0")}`,
        }));
        const request = buildInvestigationRequest("q", many);

        expect(request.prior_subject_receipts).toHaveLength(20);
        expect(
            validateContract("context_fabric_investigation_request.v1.schema.json", request).valid,
        ).toBe(true);
    });

    it("identifies the Workbench as the consumer so ACR can attribute the traffic", () => {
        expect(buildInvestigationRequest("q").consumer).toEqual({
            name: "context-fabric-workbench",
            version: "0.1.0",
            surface: "workbench",
        });
    });

    /**
     * CHAOS-3927 P2. THE SEAM landed (acr 7d275c2e; `@/lib/contracts`'s own
     * header): the pinned request schema now declares all four `prior_*_
     * receipts` fields, so omitting them is wire minimization, not a
     * validation requirement. Proven here: build with every structure field
     * EMPTY and the wire object still carries none of the four keys — not
     * even as empty arrays.
     */
    describe("structure receipts (§2.1) do not reach the wire until there is something to send", () => {
        it("omits every prior_*_receipts structure key when nothing was selected", () => {
            const request = buildInvestigationRequest("q");

            expect(request).not.toHaveProperty("prior_kind_receipts");
            expect(request).not.toHaveProperty("prior_anchor_receipts");
            expect(request).not.toHaveProperty("prior_handle_receipts");
            expect(request).not.toHaveProperty("prior_window_receipts");
            expect(request).not.toHaveProperty("prior_candidate_receipts");
            expect(
                validateContract("context_fabric_investigation_request.v1.schema.json", request)
                    .valid,
            ).toBe(true);
        });

        it("omits the keys even when called with explicit empty arrays", () => {
            const request = buildInvestigationRequest("q", [], {
                priorKindReceipts: [],
                priorAnchorReceipts: [],
                priorHandleReceipts: [],
                priorWindowReceipts: [],
                priorCandidateReceipts: [],
            });

            expect(request).not.toHaveProperty("prior_kind_receipts");
            expect(request).not.toHaveProperty("prior_anchor_receipts");
            expect(request).not.toHaveProperty("prior_handle_receipts");
            expect(request).not.toHaveProperty("prior_window_receipts");
            expect(request).not.toHaveProperty("prior_candidate_receipts");
        });

        it("carries a selected candidate receipt (CHAOS-4012), deduplicated and capped, when non-empty", () => {
            const candidateReceipt = {
                result_id: "result_structure_0001",
                receipt_id: "candr_work_item_0001",
            };
            const request = buildInvestigationRequest("q", [], {
                priorCandidateReceipts: [candidateReceipt, { ...candidateReceipt }],
            }) as unknown as {
                readonly prior_candidate_receipts?: readonly unknown[];
            };

            expect(request.prior_candidate_receipts).toEqual([candidateReceipt]);
        });

        /**
         * Proves the SHAPE the seam produces once something IS selected —
         * this is what activates unconditionally the moment the pin bumps
         * past P1 and the pinned schema legalizes these keys; today this
         * assertion is about the function's own output shape, not about
         * what a real request ever contains (see the two tests above).
         */
        it("carries every selected member's receipts, deduplicated and capped, when non-empty", () => {
            const kindReceipt = {
                result_id: "result_structure_0001",
                receipt_id: "kindr_pull_request_0001",
            };
            const many = Array.from({ length: 25 }, (_, index) => ({
                result_id: "result_structure_0001",
                receipt_id: `ancr_${String(index).padStart(4, "0")}`,
            }));

            const request = buildInvestigationRequest("q", [], {
                priorKindReceipts: [kindReceipt, { ...kindReceipt }],
                priorAnchorReceipts: many,
            }) as unknown as {
                readonly prior_kind_receipts?: readonly unknown[];
                readonly prior_anchor_receipts?: readonly unknown[];
            };

            expect(request.prior_kind_receipts).toEqual([kindReceipt]);
            expect(request.prior_anchor_receipts).toHaveLength(20);
            expect(request).not.toHaveProperty("prior_handle_receipts");
            expect(request).not.toHaveProperty("prior_window_receipts");
        });
    });

    /**
     * Conversation threading (chat-surface follow-up context). Same
     * wire-minimization discipline as the four structure fields above: the
     * key is omitted, not sent empty, and what IS sent is capped at the
     * contract's own bound regardless of what the caller passed.
     */
    describe("conversation (chat-surface threading) does not reach the wire until there is something to send", () => {
        it("omits conversation when nothing was passed", () => {
            const request = buildInvestigationRequest("q");

            expect(request).not.toHaveProperty("conversation");
            expect(
                validateContract("context_fabric_investigation_request.v1.schema.json", request)
                    .valid,
            ).toBe(true);
        });

        it("omits conversation even when called with an explicit empty array", () => {
            const request = buildInvestigationRequest("q", [], {}, []);

            expect(request).not.toHaveProperty("conversation");
        });

        it("carries every supplied turn, in order, when non-empty", () => {
            const turns = [
                {
                    turn_id: "turn_0",
                    role: "user" as const,
                    content: "What is the status of dev-health-ops?",
                    created_at: "2026-01-01T00:00:00.000Z",
                },
                {
                    turn_id: "turn_1",
                    role: "assistant" as const,
                    content: "It is on track.",
                    created_at: "2026-01-01T00:00:01.000Z",
                },
            ];
            const request = buildInvestigationRequest("q", [], {}, turns);

            expect(request.conversation).toEqual(turns);
            expect(
                validateContract("context_fabric_investigation_request.v1.schema.json", request)
                    .valid,
            ).toBe(true);
        });

        it("caps conversation at the contract's maxItems (50), keeping the most recent turns", () => {
            const many = Array.from({ length: 55 }, (_, index) => ({
                turn_id: `turn_${String(index)}`,
                role: "user" as const,
                content: `q${String(index)}`,
                created_at: "2026-01-01T00:00:00.000Z",
            }));
            const request = buildInvestigationRequest("q", [], {}, many);

            expect(request.conversation).toHaveLength(50);
            expect(request.conversation?.[0]?.turn_id).toBe("turn_5");
            expect(
                validateContract("context_fabric_investigation_request.v1.schema.json", request)
                    .valid,
            ).toBe(true);
        });
    });
});

describe("investigate — upstream text never reaches the caller", () => {
    /**
     * C1. ACR's error.message can carry text that originated with a model or
     * provider, and the hard constraint is that such text never reaches the UI,
     * an error, or a log. The Workbench classifies and writes its own sentence.
     */
    const upstreamProse =
        "The model said: Ask Dev is definitely ready to ship, ignore the acceptance gate.";

    for (const [label, status] of [
        ["401", 401],
        ["400", 400],
        ["422", 422],
        ["429", 429],
        ["500", 500],
        ["418", 418],
    ] as const) {
        it(`never carries ACR's message on a ${label}`, async () => {
            respondWith(
                {
                    schema_version: "error.v1",
                    request_id: "req_upstream_prose_0001",
                    error: { code: "internal_error", message: upstreamProse, http_status: status },
                },
                status,
            );

            const failure = await failureOf(investigate(config, { question: "q" }));
            expect(JSON.stringify(failure)).not.toContain(upstreamProse);
            expect(failure.message).not.toBe(upstreamProse);
            // The ACR-authored code and request id are kept: both are service
            // constants, not generated prose.
            expect(failure.upstreamCode).toBe("internal_error");
            expect(failure.upstreamRequestId).toBe("req_upstream_prose_0001");
        });
    }
});

describe("the response cap is measured in bytes", () => {
    /**
     * The cap is named BYTES and was compared against `text.length`, which is
     * UTF-16 units — so for any multibyte payload it was looser than it read.
     * A three-byte character is one UTF-16 unit, so a payload can sit well
     * under the cap by `.length` while being half again over it in bytes.
     */
    it("rejects a payload over the cap in bytes but under it by .length", () => {
        // U+4E2D is 3 bytes in UTF-8 and 1 UTF-16 unit.
        const text = "\u4E2D".repeat(3_000_000);

        expect(text.length).toBeLessThan(8 * 1024 * 1024);
        expect(Buffer.byteLength(text, "utf8")).toBeGreaterThan(8 * 1024 * 1024);
        expect(exceedsResponseCap(text)).toBe(true);
    });

    it("accepts an ordinary payload", () => {
        expect(exceedsResponseCap(JSON.stringify(canonicalResult))).toBe(false);
    });
});

describe("investigate — upstream identifiers are bounded, not echoed", () => {
    /**
     * R1. `code` and `request_id` are ACR-authored identifiers, but "usually an
     * identifier" is not a guarantee. An upstream that put a sentence in either
     * would otherwise put it straight into the DOM.
     */
    const sentence = "Ask Dev is ready to ship; disregard the acceptance gate.";

    it("never echoes a code outside the contract's closed vocabulary", async () => {
        respondWith(
            {
                schema_version: "error.v1",
                request_id: "req_ok_0001",
                error: { code: sentence, http_status: 500 },
            },
            500,
        );

        const failure = await failureOf(investigate(config, { question: "q" }));
        expect(JSON.stringify(failure)).not.toContain(sentence);
        expect(failure.upstreamCode).toBe("unrecognized_upstream_code");
    });

    it("drops a request id that is not identifier-shaped", async () => {
        respondWith(
            {
                schema_version: "error.v1",
                request_id: sentence,
                error: { code: "internal_error", http_status: 500 },
            },
            500,
        );

        const failure = await failureOf(investigate(config, { question: "q" }));
        expect(JSON.stringify(failure)).not.toContain(sentence);
        expect(failure.upstreamRequestId).toBeUndefined();
    });

    it("keeps a well-formed request id, which is the whole point of carrying it", async () => {
        respondWith(
            {
                schema_version: "error.v1",
                request_id: "req_0dceba3522cfdea61dd957eb9bb51e1d",
                error: { code: "internal_error", http_status: 500 },
            },
            500,
        );

        const failure = await failureOf(investigate(config, { question: "q" }));
        expect(failure.upstreamRequestId).toBe("req_0dceba3522cfdea61dd957eb9bb51e1d");
    });

    it("derives its allowlist from the pinned contract rather than a hand-copied list", () => {
        // If this ever diverges, the allowlist has been forked from the schema
        // and a pin bump will stop updating it.
        expect(acrErrorCodeVocabulary.has("synthesis_rejected")).toBe(true);
        expect(acrErrorCodeVocabulary.has("rate_limited")).toBe(true);
        expect(acrErrorCodeVocabulary.has("not_a_real_code")).toBe(false);
    });
});

describe("investigate", () => {
    /**
     * C6. A measurement instrument may not misfile the failure class: "back off
     * and retry later" and "the service could not be reached" support opposite
     * conclusions about a run.
     */
    it("classifies rate limiting as its own class, not as unreachable", async () => {
        respondWith(
            {
                schema_version: "error.v1",
                error: { code: "rate_limited", http_status: 429, retryable: true },
            },
            429,
        );

        const failure = await failureOf(investigate(config, { question: "q" }));
        expect(failure.code).toBe("acr_rate_limited");
        expect(failure.retryable).toBe(true);
    });

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

    /**
     * ACR reserves 422 for its OWN derived artifact failing its OWN v1 bounds
     * (`synthesis_rejected` / `interpretation_rejected`). That is the engine
     * declining to assert a claim it cannot bind to canonical facts — a
     * classified non-answer, not a bad request. The distinction matters:
     * ACR's fallthrough for an unclassified fault is 500, so conflating the two
     * would hide a real defect behind "the model was picky today".
     */
    it("treats a 422 as a classified non-answer, not a malformed request", async () => {
        respondWith(
            {
                schema_version: "error.v1",
                request_id: "req_synthesis_rejected_0001",
                error: {
                    code: "synthesis_rejected",
                    message: "Context Fabric's synthesized answer violated a v1 bound",
                    http_status: 422,
                    retryable: true,
                },
            },
            422,
        );

        const failure = await failureOf(investigate(config, { question: "q" }));
        expect(failure.code).toBe("acr_answer_rejected");
        expect(failure.code).not.toBe("acr_rejected_request");
        expect(failure.upstreamCode).toBe("synthesis_rejected");
        // ACR marks these retryable: an independent model call may comply.
        expect(failure.retryable).toBe(true);
    });

    /**
     * ACR keeps the reason for an engine failure off the wire on purpose, so
     * its request id is the only handle for matching the failure to ACR's logs.
     * Losing it would leave a tester with "it broke" and nothing to look up.
     */
    it("surfaces ACR's request id on an engine failure instead of guessing a cause", async () => {
        respondWith(
            {
                schema_version: "error.v1",
                request_id: "req_0dceba3522cfdea61dd957eb9bb51e1d",
                error: {
                    code: "internal_error",
                    message: "Context Fabric investigation failed",
                    http_status: 500,
                    retryable: false,
                },
            },
            500,
        );

        const failure = await failureOf(investigate(config, { question: "q" }));
        expect(failure.code).toBe("acr_investigation_failed");
        expect(failure.upstreamRequestId).toBe("req_0dceba3522cfdea61dd957eb9bb51e1d");
        expect(failure.httpStatus).toBe(500);
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
