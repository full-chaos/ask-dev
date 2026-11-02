import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { TRANSPORT_FAILURE_REASONS, TransportFailure } from "@/acr-client";
import {
    acceptedEvent,
    acrFrame,
    acrStream,
    CAPTURED_EVENTS,
    errorEvent,
    resultEvent,
    stageEvent,
} from "@/acr-client/__tests__/eventFixtures";

import {
    buildInvestigationRequest,
    failureFor,
    investigateFromBrowser,
    parseUpstreamError,
    resetInvestigateCallsForTest,
    resultOutcome,
    TRANSPORT_FAILURES,
    type InvestigateOutcome,
} from "@/lib/acr/investigate";
import { type WorkbenchFailure } from "@/lib/acr/errors";
import {
    acrErrorCodeVocabulary,
    budgetOverrunVocabulary,
    modelRefusalReasonVocabulary,
    narrowingContinuationAxisVocabulary,
    questionFamilyVocabulary,
} from "@/lib/acr/upstream-vocabulary";
import { validateContract } from "@/lib/acr/validate";
import type { StructureSubjectKind } from "@/lib/contracts";
import {
    REFUSAL_BYTES_EVIDENCE_WINDOW,
    REFUSAL_ITEMS_NO_AXIS,
} from "@/test/fixtures/budget-refusal";
import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import unsupportedResult from "@/contracts/examples/context_fabric_investigation_result_unsupported.v1.json";

const auth = vi.hoisted(() => ({
    token: vi.fn(),
    begin: vi.fn(),
    // When set, the calls the page makes throw this instead of reading a stream.
    failWith: undefined as undefined | string,
}));

// The token store is the shared client's own; its tests live with it. Here it answers what the
// test sets, and the redirect is a spy.
vi.mock("@/acr-client", async (importOriginal) => {
    const original = await importOriginal<typeof import("@/acr-client")>();
    return {
        ...original,
        getAcrAccessToken: () => auth.token() as unknown,
        beginAcrRedirect: () => auth.begin() as unknown,
        createAcrCalls: (...args: Parameters<typeof original.createAcrCalls>) => {
            const calls = original.createAcrCalls(...args);
            if (auth.failWith === undefined) return calls;
            return {
                ...calls,
                // eslint-disable-next-line require-yield
                investigate: function* () {
                    throw new original.TransportFailure(
                        auth.failWith as (typeof original.TRANSPORT_FAILURE_REASONS)[number],
                    );
                },
            };
        },
    };
});

/*
 * The classification and result checks moved here from the server client (CHAOS-12106). The first
 * half drives them directly with ACR's error and result bodies. The second half drives
 * `investigateFromBrowser` through a fake `fetch`.
 */

let answer: { readonly body: unknown; readonly status: number } = { body: {}, status: 200 };

/** What ACR answered: an error body with its status, or a result at 200. */
function respondWith(body: unknown, status = 200): void {
    answer = { body, status };
}

/** What the served answer comes to: the same mapping an `error` event or a refusal gets. */
function investigate(
    _ignored: unknown,
    _options: { readonly question: string },
): InvestigateOutcome {
    return answer.status >= 400
        ? { kind: "failed", failure: failureFor(answer.status, parseUpstreamError(answer.body)) }
        : resultOutcome(answer.body);
}

beforeEach(() => {
    answer = { body: {}, status: 200 };
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** Asserts the outcome is a failure and returns it. */
function failureOf(outcome: InvestigateOutcome): WorkbenchFailure {
    if (outcome.kind === "failed") return outcome.failure;
    throw new Error("expected the investigation to fail, but it answered");
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

    /**
     * CHAOS-5837: same-conversation carry. `parent_result_id` seeds acr's
     * confirmed-need ledger walk; `requested_scope.subject_hints` restates
     * what the parent result committed. Same wire-minimization discipline as
     * every other optional field above.
     */
    describe("same-conversation carry (parent_result_id / requested_scope.subject_hints)", () => {
        it("omits both on a first turn (called with no parent reference)", () => {
            const request = buildInvestigationRequest("q");

            expect(request).not.toHaveProperty("parent_result_id");
            expect(request).not.toHaveProperty("requested_scope");
            expect(
                validateContract("context_fabric_investigation_request.v1.schema.json", request)
                    .valid,
            ).toBe(true);
        });

        it("omits both even when called with an explicit undefined id and empty hints", () => {
            const request = buildInvestigationRequest("q", [], {}, [], [], undefined, []);

            expect(request).not.toHaveProperty("parent_result_id");
            expect(request).not.toHaveProperty("requested_scope");
        });

        it("sends the exact prior result id and hints on a follow-up", () => {
            const hints = [
                {
                    kind: "repository" as const,
                    id: "repo_1",
                    label: "dev-health-ops",
                    source: "ask_dev_parent_result_subject",
                },
            ];
            const request = buildInvestigationRequest(
                "And last month?",
                [],
                {},
                [],
                [],
                "result_abc123",
                hints,
            );

            expect(request.parent_result_id).toBe("result_abc123");
            expect(request.requested_scope).toEqual({ subject_hints: hints });
            expect(
                validateContract("context_fabric_investigation_request.v1.schema.json", request)
                    .valid,
            ).toBe(true);
        });

        it("sends parent_result_id alone when the prior result committed nothing (no requested_scope key)", () => {
            const request = buildInvestigationRequest(
                "And last month?",
                [],
                {},
                [],
                [],
                "result_no_commit",
                [],
            );

            expect(request.parent_result_id).toBe("result_no_commit");
            expect(request).not.toHaveProperty("requested_scope");
            expect(
                validateContract("context_fabric_investigation_request.v1.schema.json", request)
                    .valid,
            ).toBe(true);
        });

        it("caps requested_scope.subject_hints at the contract's maxItems (50)", () => {
            const many = Array.from({ length: 55 }, (_, index) => ({
                kind: "work_item" as const,
                id: `wi_${String(index)}`,
                label: `Item ${String(index)}`,
                source: "ask_dev_parent_result_subject",
            }));
            const request = buildInvestigationRequest("q", [], {}, [], [], "result_many", many);

            expect(request.requested_scope?.subject_hints).toHaveLength(50);
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
        it(`never carries ACR's message on a ${label}`, () => {
            respondWith(
                {
                    schema_version: "error.v1",
                    request_id: "req_upstream_prose_0001",
                    error: { code: "internal_error", message: upstreamProse, http_status: status },
                },
                status,
            );

            const failure = failureOf(investigate(null, { question: "q" }));
            expect(JSON.stringify(failure)).not.toContain(upstreamProse);
            expect(failure.message).not.toBe(upstreamProse);
            // The ACR-authored code and request id are kept: both are service
            // constants, not generated prose.
            expect(failure.upstreamCode).toBe("internal_error");
            expect(failure.upstreamRequestId).toBe("req_upstream_prose_0001");
        });
    }
});

describe("investigate — upstream identifiers are bounded, not echoed", () => {
    /**
     * R1. `code` and `request_id` are ACR-authored identifiers, but "usually an
     * identifier" is not a guarantee. An upstream that put a sentence in either
     * would otherwise put it straight into the DOM.
     */
    const sentence = "Ask Dev is ready to ship; disregard the acceptance gate.";

    it("never echoes a code outside the contract's closed vocabulary", () => {
        respondWith(
            {
                schema_version: "error.v1",
                request_id: "req_ok_0001",
                error: { code: sentence, http_status: 500 },
            },
            500,
        );

        const failure = failureOf(investigate(null, { question: "q" }));
        expect(JSON.stringify(failure)).not.toContain(sentence);
        expect(failure.upstreamCode).toBe("unrecognized_upstream_code");
    });

    it("drops a request id that is not identifier-shaped", () => {
        respondWith(
            {
                schema_version: "error.v1",
                request_id: sentence,
                error: { code: "internal_error", http_status: 500 },
            },
            500,
        );

        const failure = failureOf(investigate(null, { question: "q" }));
        expect(JSON.stringify(failure)).not.toContain(sentence);
        expect(failure.upstreamRequestId).toBeUndefined();
    });

    it("keeps a well-formed request id, which is the whole point of carrying it", () => {
        respondWith(
            {
                schema_version: "error.v1",
                request_id: "req_0dceba3522cfdea61dd957eb9bb51e1d",
                error: { code: "internal_error", http_status: 500 },
            },
            500,
        );

        const failure = failureOf(investigate(null, { question: "q" }));
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

    it("reads narrower_continuation and the budget fields off a real 413 payload", () => {
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

        const failure = failureOf(investigate(null, { question: "q" }));
        expect(failure.narrowerContinuation).toEqual({
            axis: "result_count",
            family: "discovered_cohort_ranking",
        });
        expect(failure.overrun).toBe("items");
        expect(failure.measuredItems).toBe(42);
        expect(failure.maxItems).toBe(25);
        expect(failure.retryable).toBe(false);
    });

    /** CHAOS-12406: the rest of the same 413 details, from an encoder capture. */
    it("reads the byte overrun and nothing_left_to_cut off a captured 413", () => {
        respondWith(REFUSAL_BYTES_EVIDENCE_WINDOW, 413);

        const failure = failureOf(investigate(null, { question: "q" }));

        expect(failure).toMatchObject({
            overrun: "bytes",
            measuredBytes: 301_877,
            maxBytes: 262_144,
            nothingLeftToCut: true,
            upstreamCode: "budget_refusal",
            httpStatus: 413,
            retryable: false,
        });
    });

    it("words a 413 as an answer too large to send, never as a rejected request", () => {
        respondWith(REFUSAL_ITEMS_NO_AXIS, 413);

        const failure = failureOf(investigate(null, { question: "q" }));

        expect(failure.message).toBe("The answer to this question was too large to send.");
    });

    it("leaves nothingLeftToCut absent unless ACR says true", () => {
        respondWith(budgetRefusalPayload({ overrun: "items", nothing_left_to_cut: false }), 413);

        const failure = failureOf(investigate(null, { question: "q" }));

        expect(failure).not.toHaveProperty("nothingLeftToCut");
    });

    it("drops a byte count that is not a count", () => {
        respondWith(
            budgetRefusalPayload({
                overrun: "bytes",
                measured_bytes: "a lot",
                max_serialized_bytes: -1,
            }),
            413,
        );

        const failure = failureOf(investigate(null, { question: "q" }));

        expect(failure).not.toHaveProperty("measuredBytes");
        expect(failure).not.toHaveProperty("maxBytes");
    });

    it("carries none of the byte fields on a status that is not 413", () => {
        respondWith(
            {
                schema_version: "error.v1",
                request_id: "req_1",
                error: {
                    code: "upstream_unavailable",
                    http_status: 503,
                    details: {
                        measured_bytes: 1,
                        max_serialized_bytes: 2,
                        nothing_left_to_cut: true,
                    },
                },
            },
            503,
        );

        const failure = failureOf(investigate(null, { question: "q" }));

        expect(failure).not.toHaveProperty("measuredBytes");
        expect(failure).not.toHaveProperty("maxBytes");
        expect(failure).not.toHaveProperty("nothingLeftToCut");
    });

    it("omits narrower_continuation entirely when ACR named no axis (the OMITTED discipline)", () => {
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

        const failure = failureOf(investigate(null, { question: "q" }));
        expect(failure.narrowerContinuation).toBeUndefined();
        expect(failure.overrun).toBe("bytes");
    });

    it("drops the whole continuation when axis is outside the closed vocabulary, but keeps the sibling budget fields", () => {
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

        const failure = failureOf(investigate(null, { question: "q" }));
        expect(failure.narrowerContinuation).toBeUndefined();
        expect(failure.overrun).toBe("items");
        expect(failure.measuredItems).toBe(42);
        expect(failure.maxItems).toBe(25);
    });

    it("drops family alone when it is outside the closed vocabulary, keeping the axis", () => {
        respondWith(
            budgetRefusalPayload({
                narrower_continuation: { family: "not_a_real_family", axis: "result_count" },
            }),
            413,
        );

        const failure = failureOf(investigate(null, { question: "q" }));
        expect(failure.narrowerContinuation).toEqual({ axis: "result_count" });
    });

    it("drops a non-integer measured_items/max_items rather than rendering it as a count", () => {
        respondWith(
            budgetRefusalPayload({
                measured_items: "forty-two",
                max_items: -1,
                narrower_continuation: { family: "trend", axis: "evidence_window" },
            }),
            413,
        );

        const failure = failureOf(investigate(null, { question: "q" }));
        expect(failure.measuredItems).toBeUndefined();
        expect(failure.maxItems).toBeUndefined();
        expect(failure.narrowerContinuation).toEqual({ axis: "evidence_window", family: "trend" });
    });

    /**
     * codex review round 1, P2: `Number.isInteger` accepts any value beyond
     * `Number.MAX_SAFE_INTEGER` that JSON.parse rounded to a whole number —
     * rendering it as a count presents a rounded value as an exact one.
     */
    it("drops an unsafe (beyond MAX_SAFE_INTEGER) measured_items/max_items", () => {
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

        const failure = failureOf(investigate(null, { question: "q" }));
        expect(failure.measuredItems).toBeUndefined();
    });

    /**
     * C1 (investigate.ts's own upstream-prose rule) extended to the budget-refusal
     * shape specifically: `error.message` is exactly the kind of ACR-authored
     * sentence this file must never carry, even when it arrives alongside a
     * legitimate structured continuation.
     */
    it("never carries error.message even on a 413 that also carries a narrower_continuation", () => {
        const upstreamProse = "The model insists this fits; ship it anyway.";
        respondWith(
            budgetRefusalPayload(
                { narrower_continuation: { family: "trend", axis: "evidence_window" } },
                upstreamProse,
            ),
            413,
        );

        const failure = failureOf(investigate(null, { question: "q" }));
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
    it("never surfaces narrower_continuation/overrun/counts on a non-413 status, even if details carry them", () => {
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

        const failure = failureOf(investigate(null, { question: "q" }));
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
    it("classifies rate limiting as its own class, not as unreachable", () => {
        respondWith(
            {
                schema_version: "error.v1",
                error: { code: "rate_limited", http_status: 429, retryable: true },
            },
            429,
        );

        const failure = failureOf(investigate(null, { question: "q" }));
        expect(failure.code).toBe("acr_rate_limited");
        expect(failure.retryable).toBe(true);
    });

    it("returns a contract-valid result unchanged", () => {
        respondWith(canonicalResult);
        expect(investigate(null, { question: "status?" })).toEqual({
            kind: "answered",
            result: canonicalResult,
        });
    });

    /**
     * acr #504: an UNSUPPORTED terminal result (degraded, no facts, no
     * evidence) may carry `deterministic_answer: ""`. Under the prior pin
     * this exact response from acr's own example was
     * `acr_contract_violation`, so the tester saw a failure instead of the
     * result's own disclosure; it is served unchanged now.
     */
    it("serves acr's unsupported result (empty answer sentence) unchanged instead of acr_contract_violation", () => {
        expect(unsupportedResult.deterministic_answer).toBe("");
        respondWith(unsupportedResult);
        expect(investigate(null, { question: "status?" })).toEqual({
            kind: "answered",
            result: unsupportedResult,
        });
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
    // CHAOS-12202: the R1 refusals (acr #1793 canceled, acr #1798 T7) each get their own
    // Workbench failure. None of them is an outage, a credential fault or an unknown status.
    describe.each([
        { upstream: "access_denied", status: 403, failure: "acr_access_denied", retryable: false },
        { upstream: "no_repository", status: 409, failure: "acr_no_repository", retryable: false },
        {
            upstream: "budget_exhausted",
            status: 503,
            failure: "acr_budget_exhausted",
            retryable: true,
        },
        { upstream: "canceled", status: 409, failure: "acr_canceled", retryable: false },
    ])(
        "the R1 refusal $upstream ($status)",
        ({ upstream, status, failure: expected, retryable }) => {
            it(`maps to ${expected}`, () => {
                const body = {
                    schema_version: "error.v1",
                    request_id: "req_0123456789abcdef0123456789abcdef",
                    error: {
                        code: upstream,
                        message: "upstream free text that must not be shown",
                        http_status: status,
                        retryable,
                    },
                };
                expect(validateContract("error.v1.schema.json", body).valid).toBe(true);
                respondWith(body, status);

                const failure = failureOf(investigate(null, { question: "status?" }));
                expect(failure.code).toBe(expected);
                expect(failure.upstreamCode).toBe(upstream);
                expect(failure.httpStatus).toBe(status);
                expect(failure.retryable).toBe(retryable);
                expect(failure.message).not.toMatch(
                    /temporarily unavailable|something it needs|unexpected response|server credential/i,
                );
                expect(failure.message).not.toContain("upstream free text");
            });
        },
    );

    it("maps ACR's static 503 to acr_runtime_unavailable without asserting a specific cause", () => {
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

        const failure = failureOf(investigate(null, { question: "status?" }));
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
        expect(failure.message).toMatch(/the reference/i);
        expect(failure.retryable).toBe(true);
    });

    it("maps a 401 to acr_unauthorized and never retries it", () => {
        respondWith(
            { schema_version: "error.v1", error: { code: "invalid_token", http_status: 401 } },
            401,
        );

        const failure = failureOf(investigate(null, { question: "q" }));
        expect(failure.code).toBe("acr_unauthorized");
        expect(failure.retryable).toBe(false);
    });

    describe("a 403 feature_not_enabled refusal names its BYO reason (CHAOS-10343)", () => {
        const refusals = [
            [
                "own_model_gate_closed",
                "This organization's own model is saved, but its plan does not include it right now. No model was used.",
            ],
            [
                "ai_features_turned_off",
                "AI features are turned off for this organization. No model was used.",
            ],
            [
                "byo_no_investigate_config",
                "This organization's saved model keys are not set for investigations. An organization admin must set one. No model was used.",
            ],
            [
                "own_model_turned_off",
                "An organization admin turned this organization's own model off. No model was used.",
            ],
        ] as const;

        function refusal(reason: string, status = 403): void {
            respondWith(
                {
                    schema_version: "error.v1",
                    request_id: "req_refused",
                    error: {
                        code: "feature_not_enabled",
                        message: "model-authored text that must never render",
                        http_status: status,
                        retryable: false,
                        details: { reason },
                    },
                },
                status,
            );
        }

        it.each(refusals)(
            "maps %s to its own message, not a credential fault",
            (reason, message) => {
                refusal(reason);

                const failure = failureOf(investigate(null, { question: "q" }));
                expect(failure.code).toBe("acr_model_refused");
                expect(failure.refusalReason).toBe(reason);
                expect(failure.message).toBe(message);
                expect(failure.message).not.toMatch(/credential/i);
                expect(failure.message).not.toMatch(/synthes|caller|supplied/i);
                expect(failure.httpStatus).toBe(403);
                expect(failure.upstreamCode).toBe("feature_not_enabled");
                expect(failure.upstreamRequestId).toBe("req_refused");
                expect(failure.retryable).toBe(false);
            },
        );

        it("holds exactly acr's four documented reasons", () => {
            expect([...modelRefusalReasonVocabulary].sort()).toEqual(
                refusals.map(([reason]) => reason).sort(),
            );
        });

        it("keeps every other 403 a credential failure, including an unknown or absent reason", () => {
            for (const reason of [
                "service_model_not_entitled",
                "some_future_reason",
                "A sentence.",
            ]) {
                refusal(reason);
                const failure = failureOf(investigate(null, { question: "q" }));
                expect(failure.code).toBe("acr_unauthorized");
                expect(failure.refusalReason).toBeUndefined();
                vi.restoreAllMocks();
            }
            respondWith(
                { schema_version: "error.v1", error: { code: "feature_not_enabled" } },
                403,
            );
            const bare = failureOf(investigate(null, { question: "q" }));
            expect(bare.code).toBe("acr_unauthorized");
        });

        it("does not remap the same reason on another status or another code", () => {
            refusal("own_model_turned_off", 400);
            expect(failureOf(investigate(null, { question: "q" })).code).toBe(
                "acr_rejected_request",
            );
            vi.restoreAllMocks();
            respondWith(
                {
                    schema_version: "error.v1",
                    error: {
                        code: "invalid_token",
                        http_status: 403,
                        details: { reason: "own_model_turned_off" },
                    },
                },
                403,
            );
            expect(failureOf(investigate(null, { question: "q" })).code).toBe("acr_unauthorized");
        });
    });

    /**
     * The Workbench must not render a payload it does not understand as if it
     * were an answer. A result failing its own contract is an upstream failure.
     */
    it("rejects a 200 whose body violates the investigation contract", () => {
        const tainted = structuredClone(canonicalResult) as unknown as Record<string, unknown>;
        delete tainted["coverage"];
        respondWith(tainted);

        const failure = failureOf(investigate(null, { question: "q" }));
        expect(failure.code).toBe("acr_contract_violation");
        expect(failure.details?.join("; ")).toMatch(/coverage/);
    });

    /**
     * Observed live against the local stack: ACR's global request budget (15s)
     * fires before its own model call budget (45s), so a real model-backed
     * investigation returns 504 while the pipeline is still running. That is
     * not "unreachable" — the call landed and the engine worked.
     */
    it("distinguishes a mid-investigation timeout from an unreachable service", () => {
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

        const failure = failureOf(investigate(null, { question: "q" }));
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
    it("treats a 422 as a classified non-answer, not a malformed request", () => {
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

        const failure = failureOf(investigate(null, { question: "q" }));
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
    it("surfaces ACR's request id on an engine failure instead of guessing a cause", () => {
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

        const failure = failureOf(investigate(null, { question: "q" }));
        expect(failure.code).toBe("acr_investigation_failed");
        expect(failure.upstreamRequestId).toBe("req_0dceba3522cfdea61dd957eb9bb51e1d");
        expect(failure.httpStatus).toBe(500);
    });
});

/**
 * The user-visible path, not just the validator: a served result carrying the
 * continuation-refusal basis — at the top level AND at
 * `completeness.refusal_basis`, the two places the field is carried — reaches
 * the caller unchanged. On the pre-bump pin this exact response was turned into
 * `acr_contract_violation` before anything could render it.
 */
describe("investigate — a result carrying the continuation-refusal basis", () => {
    function refusedContinuation(): Record<string, unknown> {
        const result = structuredClone(canonicalResult) as unknown as Record<string, unknown>;
        result.refusal_basis = "continuation_context_unverifiable";
        result.completeness = {
            ...(result.completeness as Record<string, unknown>),
            refusal_basis: "continuation_context_unverifiable",
        };
        return result;
    }

    it("is served unchanged instead of acr_contract_violation", () => {
        const served = refusedContinuation();
        respondWith(served);
        expect(investigate(null, { question: "and last month?" })).toEqual({
            kind: "answered",
            result: served,
        });
    });

    it("a value outside the documented vocabulary is tolerated and served unchanged (open vocabulary)", () => {
        const unknown = refusedContinuation();
        unknown.refusal_basis = "not_a_real_refusal_basis";
        respondWith(unknown);

        expect(investigate(null, { question: "and last month?" })).toEqual({
            kind: "answered",
            result: unknown,
        });
    });
});

describe("investigateFromBrowser", () => {
    const ISSUER = "http://localhost:8080";
    const TOKEN = `fcacr_${"a".repeat(43)}`;
    let fetchMock: Mock<(url: string, init: RequestInit) => Promise<Response>>;

    const sse = (body: string, status = 200) =>
        new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
    const json = (body: unknown, status: number) =>
        new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
        });

    function serve(response: Response | ((init: RequestInit) => Response)): void {
        fetchMock.mockImplementation((_url: string, init: RequestInit) =>
            Promise.resolve(typeof response === "function" ? response(init) : response),
        );
    }

    /** A stream whose `accepted` names back the ids the request sent, as ACR does. */
    function streamFor(init: RequestInit, ...events: readonly Record<string, unknown>[]): Response {
        const headers = init.headers as Record<string, string>;
        const accepted = {
            ...acceptedEvent(),
            submission_id: headers["X-ACR-Submission-ID"],
            thread_id: headers["X-ACR-Thread-ID"],
        };
        return sse(acrStream(accepted, ...(events as readonly Parameters<typeof acrFrame>[0][])));
    }

    beforeEach(() => {
        vi.stubEnv("NEXT_PUBLIC_ACR_OAUTH_ISSUER", ISSUER);
        resetInvestigateCallsForTest();
        auth.failWith = undefined;
        auth.token.mockReset();
        auth.begin.mockReset();
        auth.token.mockReturnValue({ kind: "token", token: TOKEN, issuer: ISSUER });
        auth.begin.mockResolvedValue({ kind: "redirected" });
        fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
        vi.stubGlobal("fetch", fetchMock);
        window.sessionStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it("answers with the result of a real captured stream", async () => {
        // ACR's own capture: all five stages, two heartbeats, the result.
        serve((init) => streamFor(init, ...CAPTURED_EVENTS.slice(1)));
        const outcome = await investigateFromBrowser({ question: "  status?  " });
        expect(outcome.kind).toBe("answered");
        if (outcome.kind === "answered") {
            expect(outcome.result.schema_version).toBe("context_fabric_investigation_result.v1");
        }
    });

    it("sends the bearer, the resource, the client version and the two ids", async () => {
        serve((init) => streamFor(init, resultEvent(2)));
        await investigateFromBrowser({ question: "status?" });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`${ISSUER}/api/v1/context-fabric/investigations`);
        const headers = init.headers as Record<string, string>;
        expect(headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
        expect(headers["X-ACR-Resource"]).toBe(ISSUER);
        expect(headers["X-ACR-Client-Version"]).toMatch(/^\d+\.\d+\.\d+$/u);
        expect(headers["X-ACR-Submission-ID"]).toMatch(/^[0-9a-f-]{36}$/u);
        expect(headers["X-ACR-Thread-ID"]).toMatch(/^[0-9a-f-]{36}$/u);
        expect(headers["X-ACR-Submission-ID"]).not.toBe(headers["X-ACR-Thread-ID"]);
        expect(init.credentials).toBe("omit");
        const body = init.body as string;
        const sent = JSON.parse(body) as Record<string, unknown>;
        expect(sent.question).toBe("status?");
        expect(sent.schema_version).toBe("context_fabric_investigation_request.v1");
        // The token goes in a header only.
        expect(String(url)).not.toContain(TOKEN);
        expect(body).not.toContain(TOKEN);
    });

    it("maps an error event with the same classification a refusal gets", async () => {
        serve((init) => streamFor(init, errorEvent(2, "internal_error")));
        const outcome = await investigateFromBrowser({ question: "q" });
        const failure = failureOf(outcome);
        expect(failure.code).toBe("acr_investigation_failed");
        expect(failure.httpStatus).toBe(500);
        expect(failure.upstreamCode).toBe("internal_error");
        expect(JSON.stringify(failure)).not.toContain("redacted");
    });

    it("maps a refusal before the stream opened", async () => {
        serve(
            json(
                {
                    schema_version: "error.v1",
                    request_id: "req_refused_0001",
                    error: {
                        code: "rate_limited",
                        message: "slow down",
                        http_status: 429,
                        retryable: true,
                    },
                },
                429,
            ),
        );
        const failure = failureOf(await investigateFromBrowser({ question: "q" }));
        expect(failure.code).toBe("acr_rate_limited");
        expect(failure.upstreamRequestId).toBe("req_refused_0001");
    });

    it("does not retry a refusal", async () => {
        serve(
            json(
                {
                    schema_version: "error.v1",
                    request_id: "req_refused_0002",
                    error: {
                        code: "feature_not_enabled",
                        message: "off",
                        http_status: 403,
                        retryable: false,
                        details: { reason: "own_model_turned_off" },
                    },
                },
                403,
            ),
        );
        const failure = failureOf(await investigateFromBrowser({ question: "q" }));
        expect(failure.code).toBe("acr_model_refused");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("reports a stream that ends with no terminal as unreachable and retryable", async () => {
        serve((init) => streamFor(init, stageEvent(2, "interpreting", "started", 5)));
        const failure = failureOf(await investigateFromBrowser({ question: "q" }));
        expect(failure).toEqual({
            code: "acr_unreachable",
            message: "Ask Dev could not be reached.",
            retryable: true,
        });
    });

    it("reports a network failure as unreachable and retryable", async () => {
        fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
        const failure = failureOf(await investigateFromBrowser({ question: "q" }));
        expect(failure.code).toBe("acr_unreachable");
        expect(failure.retryable).toBe(true);
    });

    it("does not call an abort by the caller a timeout", async () => {
        fetchMock.mockImplementation(
            (_url: string, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
                }),
        );
        const controller = new AbortController();
        const pending = investigateFromBrowser({ question: "q", signal: controller.signal });
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
        controller.abort();
        expect(failureOf(await pending).code).toBe("acr_unreachable");
    });

    it.each([
        ["priorKindReceipts"],
        ["priorAnchorReceipts"],
        ["priorHandleReceipts"],
        ["priorWindowReceipts"],
        ["priorCandidateReceipts"],
    ] as const)("refuses a %s entry from another namespace, and sends nothing", async (field) => {
        const failure = failureOf(
            await investigateFromBrowser({
                question: "q",
                [field]: [{ result_id: "result_1", receipt_id: "foreign:1" }],
            }),
        );
        expect(failure.code).toBe("acr_rejected_request");
        expect(failure.message).toContain("malformed");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses a request that fails its own schema, and sends nothing", async () => {
        const failure = failureOf(
            await investigateFromBrowser({
                question: "q",
                // Shorter than the schema's minimum.
                parentResultId: "x",
            }),
        );
        expect(failure.code).toBe("acr_rejected_request");
        expect(failure.message).toBe(
            "This app built an investigation request in the wrong format.",
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("names the page's own timer as a timeout", async () => {
        const fired = new AbortController();
        vi.spyOn(AbortSignal, "timeout").mockReturnValue(fired.signal);
        fetchMock.mockImplementation(
            (_url: string, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
                }),
        );
        const pending = investigateFromBrowser({ question: "q" });
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
        fired.abort();
        const failure = failureOf(await pending);
        expect(failure.code).toBe("acr_timeout");
        expect(failure.retryable).toBe(true);
        vi.restoreAllMocks();
    });

    it("is a contract violation when an event fails the event schema", async () => {
        serve((init) =>
            streamFor(init, {
                type: "stage",
                seq: 2,
                request_id: String(acceptedEvent().request_id),
                schema_version: "context_fabric_investigation_event.v1",
                stage: "interpreting",
                state: "started",
                elapsed_ms: "soon",
            }),
        );
        const failure = failureOf(await investigateFromBrowser({ question: "q" }));
        expect(failure.code).toBe("acr_contract_violation");
    });

    it("is a contract violation when the stream breaks its grammar", async () => {
        serve((init) => streamFor(init, resultEvent(5)));
        const failure = failureOf(await investigateFromBrowser({ question: "q" }));
        expect(failure.code).toBe("acr_contract_violation");
    });

    it("is a contract violation when the result is in a version this app does not accept", async () => {
        const event = resultEvent(2);
        // A version outside the two this app reads, in an event that passes the event schema.
        const projection = { ...(event.result as object), schema_version: "x.v3" };
        serve((init) => streamFor(init, { ...event, result: projection }));
        const failure = failureOf(await investigateFromBrowser({ question: "q" }));
        expect(failure.code).toBe("acr_contract_violation");
    });

    it("goes through the redirect with no token, remembers the path, and asks for sign-in", async () => {
        auth.token.mockReturnValue({ kind: "authorization_required" });
        const failure = failureOf(await investigateFromBrowser({ question: "q" }));
        expect(auth.begin).toHaveBeenCalledTimes(1);
        expect(window.sessionStorage.getItem("ask-dev:acr-return")).toBe(window.location.pathname);
        expect(failure).toEqual({
            code: "acr_sign_in_required",
            message: "Signing you in to Ask Dev.",
            retryable: true,
        });
        // The call never went out.
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("says why the redirect could not start, when it could not", async () => {
        auth.token.mockReturnValue({ kind: "authorization_required" });
        auth.begin.mockResolvedValue({ kind: "failed", reason: "unavailable" });
        const failure = failureOf(await investigateFromBrowser({ question: "q" }));
        expect(failure.code).toBe("acr_rejected_request");
        auth.begin.mockResolvedValue({ kind: "impersonating" });
        resetInvestigateCallsForTest();
        expect(failureOf(await investigateFromBrowser({ question: "q" })).code).toBe(
            "acr_rejected_request",
        );
    });

    it("is not configured with no issuer, and sends nothing", async () => {
        vi.stubEnv("NEXT_PUBLIC_ACR_OAUTH_ISSUER", "");
        const failure = failureOf(await investigateFromBrowser({ question: "q" }));
        expect(failure).toEqual({
            code: "workbench_misconfigured",
            message: "Ask Dev is not configured here.",
            retryable: false,
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(auth.begin).not.toHaveBeenCalled();
    });

    it.each([
        ["an empty question", "   "],
        ["a question over 8000 code points", "a".repeat(8_001)],
    ])("sends nothing for %s", async (_label, question) => {
        const failure = failureOf(await investigateFromBrowser({ question }));
        expect(failure.code).toBe("acr_rejected_request");
        expect(failure.message).toBe("A question is required and must be at most 8000 characters.");
        expect(fetchMock).not.toHaveBeenCalled();
        expect(auth.token).not.toHaveBeenCalled();
    });

    it("counts code points, so 8000 astral characters are accepted", async () => {
        serve((init) => streamFor(init, resultEvent(2)));
        const outcome = await investigateFromBrowser({ question: "\u{1F600}".repeat(8_000) });
        expect(outcome.kind).toBe("answered");
    });

    describe("each reason the transport ends a run", () => {
        const EXPECTED = {
            stalled: ["acr_timeout", true],
            admission_timeout: ["acr_timeout", true],
            budget_exhausted: ["acr_timeout", true],
            invalid_upstream: ["acr_contract_violation", false],
            authorization_required: ["acr_sign_in_required", true],
            session_ended: ["acr_sign_in_required", true],
            authorization_failed: ["acr_rejected_request", false],
            not_entitled: ["acr_rejected_request", false],
            impersonating: ["acr_rejected_request", false],
            authorization_limited: ["acr_rate_limited", true],
        } as const;

        it("the table names every reason the client has, and no other", () => {
            expect(Object.keys(EXPECTED).sort()).toEqual([...TRANSPORT_FAILURE_REASONS].sort());
            expect(Object.keys(TRANSPORT_FAILURES).sort()).toEqual(
                [...TRANSPORT_FAILURE_REASONS].sort(),
            );
        });

        it.each(Object.entries(EXPECTED))("%s", async (reason, [code, retryable]) => {
            auth.failWith = reason;
            const failure = failureOf(await investigateFromBrowser({ question: "q" }));
            expect(failure.code).toBe(code);
            expect(failure.retryable).toBe(retryable);
            expect(failure.message.length).toBeGreaterThan(0);
            // Plain words: no internal service, code or status.
            expect(failure.message).not.toMatch(/acr|oauth|token|401|403|server|http/i);
            expect(TransportFailure).toBeDefined();
        });

        it("signing in is a request to wait, not a fault", () => {
            expect(TRANSPORT_FAILURES.authorization_required.message).toBe(
                "Signing you in to Ask Dev.",
            );
        });
    });
});

describe("the request the browser sends", () => {
    it("builds with crypto.randomUUID ids that satisfy the pinned contract", () => {
        const request = buildInvestigationRequest("status?");
        expect(request.request_id).toMatch(/^request_[0-9a-f]{24}$/u);
        expect(
            validateContract("context_fabric_investigation_request.v1.schema.json", request).valid,
        ).toBe(true);
    });
});
