import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildInvestigationRequest, exceedsResponseCap, investigate } from "@/lib/acr/client";
import type { AcrRuntimeConfig } from "@/lib/acr/config";
import { AcrRequestError, type WorkbenchFailure } from "@/lib/acr/errors";
import {
    acrErrorCodeVocabulary,
    budgetOverrunVocabulary,
    narrowingContinuationAxisVocabulary,
    questionFamilyVocabulary,
} from "@/lib/acr/upstream-vocabulary";
import { validateContract } from "@/lib/acr/validate";
import type { StructureSubjectKind } from "@/lib/contracts";
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
     * CHAOS-4343 item 3: `expected_kinds` (CHAOS-3972 P3) is a plain request
     * field, not a receipt — legal on a fresh question with no prior result.
     * Same wire-minimization discipline as every other array field here: the
     * key is omitted (not sent empty), and what IS sent is deduplicated and
     * capped at the contract's own `maxItems: 15`.
     */
    describe("expected_kinds (CHAOS-4343 item 3) does not reach the wire until there is something to send", () => {
        it("omits expected_kinds when nothing was derived from the question", () => {
            const request = buildInvestigationRequest("q");

            expect(request).not.toHaveProperty("expected_kinds");
            expect(
                validateContract("context_fabric_investigation_request.v1.schema.json", request)
                    .valid,
            ).toBe(true);
        });

        it("omits expected_kinds even when called with an explicit empty array", () => {
            const request = buildInvestigationRequest("q", [], {}, [], []);

            expect(request).not.toHaveProperty("expected_kinds");
        });

        it("carries every supplied kind, deduplicated, when non-empty", () => {
            const request = buildInvestigationRequest(
                "What project owns this?",
                [],
                {},
                [],
                ["project", "team", "project"],
            ) as unknown as { readonly expected_kinds?: readonly string[] };

            expect(request.expected_kinds).toEqual(["project", "team"]);
            expect(
                validateContract("context_fabric_investigation_request.v1.schema.json", request)
                    .valid,
            ).toBe(true);
        });

        /**
         * The whole closed vocabulary is only 15 kinds, so a real caller can
         * never exceed the bound by supplying distinct real values — dedup
         * alone would already satisfy it. Proving the SLICE itself needs 16
         * distinct entries, which only exists as a fabricated input; the
         * literal-noun caller (`@/lib/kind-nouns`) can never produce one.
         */
        it("caps expected_kinds at the contract's maxItems (15) rather than letting ACR reject them", () => {
            const sixteenDistinctValues = Array.from(
                { length: 16 },
                (_, index) => `kind_${String(index)}`,
            ) as unknown as readonly StructureSubjectKind[];
            const request = buildInvestigationRequest(
                "q",
                [],
                {},
                [],
                sixteenDistinctValues,
            ) as unknown as { readonly expected_kinds?: readonly string[] };

            expect(request.expected_kinds).toHaveLength(15);
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

describe("investigate — CHAOS-5107: the CHAOS-4735 planned-refusal continuation", () => {
    /**
     * Real 413 budget-refusal shape, built from ACR's own route handler
     * (context_fabric_routes.go:279-304) — the exact keys and value types
     * `a.writeContextFabricError`'s `budgetRefusal` branch constructs, not
     * hand-invented ones: `overrun`, `measured_items`, `measured_bytes`,
     * `max_items`, `max_serialized_bytes`, `question_family`,
     * `retry_attempted`, and (only when an axis was named)
     * `narrower_continuation.{family,axis}`. `code` is `invalid_request`
     * because that route always classifies a budget refusal that way,
     * confirmed against error.v1.schema.json's closed `code` enum.
     */
    function budgetRefusalPayload(
        details: Record<string, unknown>,
        message = "The Context Fabric answer did not fit the response budget",
    ) {
        return {
            schema_version: "error.v1",
            request_id: "req_budget_refusal_0001",
            error: {
                code: "invalid_request",
                message,
                http_status: 413,
                retryable: false,
                details,
            },
        };
    }

    it("reads narrower_continuation and the budget fields off a real 413 payload", async () => {
        respondWith(
            budgetRefusalPayload({
                overrun: "items",
                measured_items: 42,
                measured_bytes: 900_000,
                max_items: 25,
                max_serialized_bytes: 1_048_576,
                question_family: "discovered_cohort_ranking",
                retry_attempted: true,
                narrower_continuation: {
                    family: "discovered_cohort_ranking",
                    axis: "result_count",
                },
            }),
            413,
        );

        const failure = await failureOf(investigate(config, { question: "q" }));
        expect(failure.narrowerContinuation).toEqual({
            axis: "result_count",
            family: "discovered_cohort_ranking",
        });
        expect(failure.overrun).toBe("items");
        expect(failure.measuredItems).toBe(42);
        expect(failure.maxItems).toBe(25);
        expect(failure.retryable).toBe(false);
    });

    it("omits narrower_continuation entirely when ACR named no axis (the OMITTED discipline)", async () => {
        // ACR omits the key rather than sending {"axis":"none"} when nothing
        // could be named (chaos4636_answer_plan.go's comment on this exact
        // branch) — a payload that never carries the key at all.
        respondWith(
            budgetRefusalPayload({
                overrun: "bytes",
                measured_items: 10,
                max_items: 25,
            }),
            413,
        );

        const failure = await failureOf(investigate(config, { question: "q" }));
        expect(failure.narrowerContinuation).toBeUndefined();
        expect(failure.overrun).toBe("bytes");
    });

    it("drops the whole continuation when axis is outside the closed vocabulary, but keeps the sibling budget fields", async () => {
        respondWith(
            budgetRefusalPayload({
                overrun: "items",
                measured_items: 42,
                max_items: 25,
                narrower_continuation: {
                    family: "discovered_cohort_ranking",
                    axis: "made_up_axis",
                },
            }),
            413,
        );

        const failure = await failureOf(investigate(config, { question: "q" }));
        expect(failure.narrowerContinuation).toBeUndefined();
        expect(failure.overrun).toBe("items");
        expect(failure.measuredItems).toBe(42);
        expect(failure.maxItems).toBe(25);
    });

    it("drops family alone when it is outside the closed vocabulary, keeping the axis", async () => {
        respondWith(
            budgetRefusalPayload({
                narrower_continuation: { family: "not_a_real_family", axis: "result_count" },
            }),
            413,
        );

        const failure = await failureOf(investigate(config, { question: "q" }));
        expect(failure.narrowerContinuation).toEqual({ axis: "result_count" });
    });

    it("drops a non-integer measured_items/max_items rather than rendering it as a count", async () => {
        respondWith(
            budgetRefusalPayload({
                measured_items: "forty-two",
                max_items: -1,
                narrower_continuation: { family: "trend", axis: "evidence_window" },
            }),
            413,
        );

        const failure = await failureOf(investigate(config, { question: "q" }));
        expect(failure.measuredItems).toBeUndefined();
        expect(failure.maxItems).toBeUndefined();
        expect(failure.narrowerContinuation).toEqual({ axis: "evidence_window", family: "trend" });
    });

    /**
     * codex review round 1, P2: `Number.isInteger` accepts any value beyond
     * `Number.MAX_SAFE_INTEGER` that JSON.parse rounded to a whole number —
     * rendering it as a count presents a rounded value as an exact one.
     */
    it("drops an unsafe (beyond MAX_SAFE_INTEGER) measured_items/max_items", async () => {
        // Computed, not a literal: a literal one past MAX_SAFE_INTEGER trips
        // eslint's no-loss-of-precision rule (correctly — that IS the point
        // being tested), so the value is built at runtime instead.
        const unsafeInteger = Number.MAX_SAFE_INTEGER + 2;
        respondWith(
            budgetRefusalPayload({
                measured_items: unsafeInteger,
                narrower_continuation: { family: "trend", axis: "evidence_window" },
            }),
            413,
        );

        const failure = await failureOf(investigate(config, { question: "q" }));
        expect(failure.measuredItems).toBeUndefined();
    });

    /**
     * C1 (client.ts's own upstream-prose rule) extended to the budget-refusal
     * shape specifically: `error.message` is exactly the kind of ACR-authored
     * sentence this file must never carry, even when it arrives alongside a
     * legitimate structured continuation.
     */
    it("never carries error.message even on a 413 that also carries a narrower_continuation", async () => {
        const upstreamProse = "The model insists this fits; ship it anyway.";
        respondWith(
            budgetRefusalPayload(
                { narrower_continuation: { family: "trend", axis: "evidence_window" } },
                upstreamProse,
            ),
            413,
        );

        const failure = await failureOf(investigate(config, { question: "q" }));
        expect(JSON.stringify(failure)).not.toContain(upstreamProse);
        expect(failure.narrowerContinuation).toEqual({ axis: "evidence_window", family: "trend" });
    });

    it("derives question_family/overrun allowlists from the pinned contract rather than a hand-copied list", () => {
        expect(questionFamilyVocabulary.has("discovered_cohort_ranking")).toBe(true);
        expect(questionFamilyVocabulary.has("not_a_real_family")).toBe(false);
        expect(budgetOverrunVocabulary.has("items")).toBe(true);
        expect(budgetOverrunVocabulary.has("bytes")).toBe(true);
        expect(budgetOverrunVocabulary.has("not_a_real_overrun")).toBe(false);
    });

    it("keeps the axis vocabulary in sync with ACR's registry (chaos4632_question_family_registry.go)", () => {
        expect(narrowingContinuationAxisVocabulary).toEqual(
            new Set([
                "evidence_window",
                "result_count",
                "scope_anchor",
                "group_selection",
                "comparison_pair",
            ]),
        );
        // "none" is never a member: ACR omits the key instead of sending it.
        expect(narrowingContinuationAxisVocabulary.has("none")).toBe(false);
    });

    /**
     * codex review round 2, P2: the budget-refusal fields were forwarded
     * regardless of HTTP status, so a 503 (or any other non-413 status)
     * whose `error.details` happened to carry these same key names would
     * render a narrower-reask button under an UNRELATED failure. ACR only
     * ever puts this continuation on a 413; the client now only reads it
     * for one.
     */
    it("never surfaces narrower_continuation/overrun/counts on a non-413 status, even if details carry them", async () => {
        respondWith(
            budgetRefusalPayload({
                overrun: "items",
                measured_items: 42,
                max_items: 25,
                narrower_continuation: {
                    family: "discovered_cohort_ranking",
                    axis: "result_count",
                },
            }),
            503,
        );

        const failure = await failureOf(investigate(config, { question: "q" }));
        expect(failure.narrowerContinuation).toBeUndefined();
        expect(failure.overrun).toBeUndefined();
        expect(failure.measuredItems).toBeUndefined();
        expect(failure.maxItems).toBeUndefined();
        // Sanity: this really did go through the 503 branch, not a fluke.
        expect(failure.code).toBe("acr_runtime_unavailable");
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
     * CHAOS-4333: ACR's own 503/upstream_unavailable code is ONE wire signal
     * for `contextfabric.ErrUnavailable`/`ErrModelUnavailable` covering
     * SEVERAL causes ACR's ErrorEnvelope never distinguishes on the wire --
     * confirmed live: the exact same code+status fired both for a genuinely
     * uncomposed graph/model runtime AND for an unrelated Postgres CHECK-
     * constraint violation during result persistence (`failure_stage=
     * persistence`, never sent to the client -- see acr's own
     * `pginvestigation.sanitizeError` doc comment). A message that asserts
     * ONE specific cause ("needs graph reads enabled...") is confidently
     * wrong for the other. The message must state what's actually known
     * (ACR answered, something behind it is down) and point at the request
     * id for the rest -- the same discipline `acr_investigation_failed`'s
     * own message already uses one branch below this one.
     */
    it("maps ACR's static 503 to acr_runtime_unavailable without asserting a specific cause", async () => {
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
        // Naming ONE dependency and stopping there is exactly the old
        // confident-but-sometimes-wrong shape (codex review, CHAOS-3748:
        // banning two exact old phrases wasn't enough -- a differently
        // worded single-cause message, e.g. "its graph store is
        // unavailable", would have slipped past those). Requiring at least
        // two of the three real possible dependencies to be named proves
        // the message is presenting POSSIBILITIES, not a diagnosis.
        const namedDependencyCount = [/graph/i, /model/i, /persist/i].filter((pattern) =>
            pattern.test(failure.message),
        ).length;
        expect(namedDependencyCount).toBeGreaterThanOrEqual(2);
        expect(failure.message).not.toMatch(/needs graph reads enabled/i);
        expect(failure.message).not.toMatch(/needs a configured model runtime/i);
        expect(failure.message).toMatch(/request id/i);
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
     * `AbortSignal.timeout(config.timeoutMs)` firing locally (no response
     * ever arrived) is a DIFFERENT fact than the network being unreachable,
     * and a different fact than ACR's own 504 (a real response saying the
     * pipeline was still running) already covered above. Collapsing this
     * one into `acr_unreachable` too is exactly the class of mistake
     * `acr_timeout`'s own doc comment (errors.ts) warns against: a tester
     * cannot tell "the Workbench never even got a response" from "DNS/TCP
     * failed" without this distinction, and both currently read the same
     * (observed live 2026-08-26: a real >120s investigation surfaced as
     * "ACR could not be reached").
     */
    it("distinguishes a local Workbench timeout from an unreachable service", async () => {
        // Drives the REAL AbortSignal.timeout(config.timeoutMs) rather than
        // fabricating a same-named error, so this proves the gate is the
        // local timer firing (`timeout.aborted`), not just an error name a
        // completely different signal could also carry (codex review round
        // 1, finding 1). A plain Error, not DOMException: under jsdom (this
        // suite's test environment), `new DOMException(...) instanceof
        // Error` is FALSE, which would make the OLD buggy `error instanceof
        // Error && error.name === ...` gate silently fall through to
        // `acr_unreachable` regardless of `error.name` -- passing this test
        // for the wrong reason instead of proving the fix (codex review
        // round 2, finding 1/2). A real fetch throws a plain `Error` here in
        // every runtime that matters (browser and Node), so this is also
        // the more representative shape.
        const shortTimeoutConfig: AcrRuntimeConfig = { ...config, timeoutMs: 20 };
        vi.spyOn(globalThis, "fetch").mockImplementation(
            (_input, init) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () => {
                        reject(
                            Object.assign(new Error("The operation was aborted due to timeout"), {
                                name: "TimeoutError",
                            }),
                        );
                    });
                }),
        );

        const before = Date.now();
        const failure = await failureOf(investigate(shortTimeoutConfig, { question: "q" }));
        const elapsedUpperBoundMs = Date.now() - before;

        expect(failure.code).toBe("acr_timeout");
        expect(failure.retryable).toBe(true);
        expect(failure.message).toContain(String(shortTimeoutConfig.timeoutMs));
        // Pins the message to an ACTUAL elapsed reading, not just a regex
        // shape a hard-coded string could also satisfy (codex review round
        // 2, finding 2): the reported "waited Nms" must be a real number no
        // larger than how long this whole test body took to run.
        const waitedMatch = /waited (\d+)ms/.exec(failure.message);
        expect(waitedMatch).not.toBeNull();
        const waitedMs = Number(waitedMatch?.[1]);
        expect(waitedMs).toBeGreaterThanOrEqual(0);
        expect(waitedMs).toBeLessThanOrEqual(elapsedUpperBoundMs);
    });

    /**
     * The chat route forwards the INCOMING request's own signal, combined
     * with the local timer via `AbortSignal.any`. An external abort can
     * carry a "TimeoutError"-named reason without the Workbench's own
     * budget ever having fired -- this proves that case is NOT misfiled as
     * `acr_timeout` (codex review round 1, finding 1: the old gate checked
     * `error.name` alone, which cannot tell the two apart). Plain Error, not
     * DOMException, for the same jsdom `instanceof Error` reason as the test
     * above -- with DOMException this test could not distinguish the fix
     * from the bug it is meant to catch (codex review round 2, finding 1).
     */
    it("does not classify an external abort as the Workbench's own timeout", async () => {
        const controller = new AbortController();
        vi.spyOn(globalThis, "fetch").mockImplementation(
            (_input, init) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () => {
                        reject(
                            Object.assign(new Error("The operation was aborted"), {
                                name: "TimeoutError",
                            }),
                        );
                    });
                }),
        );

        // config's own timeoutMs (5s) never fires here; only the caller-
        // supplied signal does, immediately.
        const pending = investigate(config, { question: "q", signal: controller.signal });
        controller.abort();

        const failure = await failureOf(pending);
        expect(failure.code).toBe("acr_unreachable");
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
