import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/investigations/route";
import type { WorkbenchFailure } from "@/lib/acr/errors";

function post(body: string): Request {
    return new Request("http://workbench.test/api/investigations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
    });
}

async function failureOf(response: Response): Promise<WorkbenchFailure> {
    const payload = (await response.json()) as { failure?: WorkbenchFailure };
    if (payload.failure === undefined) throw new Error("expected a failure payload");
    return payload.failure;
}

afterEach(() => {
    vi.unstubAllEnvs();
});

/**
 * C5. `JSON.parse("null")` is null, and a bare scalar parses too — both crashed
 * on the first property read. A malformed body must be a controlled 400, never
 * an unhandled throw, because an unhandled throw in a route is a 500 that reads
 * like an upstream fault.
 */
describe("malformed request bodies are controlled failures", () => {
    for (const [label, body] of [
        ["null", "null"],
        ["a bare number", "42"],
        ["a bare string", '"hello"'],
        ["an array", "[]"],
        ["invalid JSON", "{not json"],
    ] as const) {
        it(`rejects ${label} with a 400 rather than throwing`, async () => {
            const response = await POST(post(body));

            expect(response.status).toBe(400);
            expect((await failureOf(response)).code).toBe("acr_rejected_request");
        });
    }

    /**
     * ACR bounds the question at 8000 RUNES. JavaScript's `.length` counts
     * UTF-16 units, so an astral character counted twice and a question of
     * exactly 8000 astral code points was rejected here while ACR would have
     * accepted it — the Workbench blaming the tester's input for its own
     * defect. Origin: a question from lane-3746 about Ajv; Ajv was correct.
     */
    describe("the question bound is measured in code points", () => {
        // U+1D11E: one code point, two UTF-16 units.
        const astral = "\u{1D11E}";

        it("accepts exactly 8000 astral code points, which .length would call 16000", async () => {
            const question = astral.repeat(8_000);
            expect(question.length).toBe(16_000);
            expect([...question].length).toBe(8_000);

            const response = await POST(post(JSON.stringify({ question })));

            // Past the bound check: it fails later for missing config, not for
            // length. Anything else means the guard rejected a valid question.
            expect(response.status).toBe(500);
            expect((await failureOf(response)).code).toBe("workbench_misconfigured");
        });

        it("still rejects 8001 code points", async () => {
            const response = await POST(post(JSON.stringify({ question: astral.repeat(8_001) })));

            expect(response.status).toBe(400);
            expect((await failureOf(response)).code).toBe("acr_rejected_request");
        });

        it("rejects 8001 plain characters too, so the bound is not simply gone", async () => {
            const response = await POST(post(JSON.stringify({ question: "a".repeat(8_001) })));

            expect(response.status).toBe(400);
            expect((await failureOf(response)).code).toBe("acr_rejected_request");
        });
    });

    it("rejects a missing question", async () => {
        const response = await POST(post(JSON.stringify({})));

        expect(response.status).toBe(400);
        expect((await failureOf(response)).code).toBe("acr_rejected_request");
    });
});

/**
 * Item 1. A discarded receipt means the re-ask runs WITHOUT the tester's chosen
 * subject and they get a fresh clarification with no indication their choice
 * was thrown away — the disambiguation flow silently not working. Filtering was
 * the original behaviour; rejecting is the fix.
 */
describe("a malformed receipt rejects the request instead of being filtered out", () => {
    for (const [label, receipts] of [
        ["a non-array", "not-an-array"],
        ["a null entry", [null]],
        ["an entry missing receipt_id", [{ result_id: "result_12345678" }]],
        ["an entry with a non-string id", [{ result_id: 1, receipt_id: "receipt_12345678" }]],
        ["an id below the contract's minLength", [{ result_id: "short", receipt_id: "short" }]],
    ] as const) {
        it(`rejects ${label}`, async () => {
            const response = await POST(
                post(JSON.stringify({ question: "status?", priorSubjectReceipts: receipts })),
            );

            expect(response.status).toBe(400);
            const failure = await failureOf(response);
            expect(failure.code).toBe("acr_rejected_request");
            expect(failure.message).toMatch(/without the chosen subject/);
        });
    }

    /**
     * The receipt bound is measured in CODE POINTS, like the question bound.
     *
     * This test exists because of the criterion the question guard's own fix
     * established: "the suite is green after my fix" and "my fix is pinned" are
     * different claims. Every receipt fixture above is ASCII, so a mutation of
     * the receipt guard back to `.length` kept the whole suite green while
     * rejecting a contract-valid 256-code-point astral id — the fix was correct
     * and unpinned, which is indistinguishable from a fix never made.
     *
     * Not reachable with today's ACR, which generates ASCII ids. Pinned anyway:
     * what makes it safe is a property of today's ACR rather than of this code.
     */
    describe("the receipt bound is measured in code points", () => {
        // U+1D11E: one code point, two UTF-16 units.
        const astral = "\u{1D11E}";

        const receiptRequest = (codePoints: number) =>
            post(
                JSON.stringify({
                    question: "status?",
                    priorSubjectReceipts: [
                        {
                            result_id: astral.repeat(codePoints),
                            receipt_id: astral.repeat(codePoints),
                        },
                    ],
                }),
            );

        it("accepts 256 astral code points, which .length would call 512", async () => {
            const id = astral.repeat(256);
            expect(id.length).toBe(512);
            expect([...id].length).toBe(256);

            const response = await POST(receiptRequest(256));

            // Past receipt validation: it fails later for missing config, not
            // for length. A 400 here means the guard rejected a valid receipt.
            expect(response.status).toBe(500);
            expect((await failureOf(response)).code).toBe("workbench_misconfigured");
        });

        it("still rejects 257 code points, so the bound is not simply gone", async () => {
            const response = await POST(receiptRequest(257));

            expect(response.status).toBe(400);
            expect((await failureOf(response)).code).toBe("acr_rejected_request");
        });

        it("still rejects 7 code points at the minimum", async () => {
            const response = await POST(receiptRequest(7));

            expect(response.status).toBe(400);
            expect((await failureOf(response)).code).toBe("acr_rejected_request");
        });

        /**
         * ASYMMETRIC fixtures, because the symmetric ones pinned the LOOP
         * rather than each identifier.
         *
         * Every case above sets both ids to the same length, so `receipt_id`'s
         * check covered for `result_id`'s: dropping result_id's length check
         * alone left the whole suite green. Pinning granularity has to match
         * the granularity of the thing that can independently break.
         */
        const asymmetric = (resultId: string, receiptId: string) =>
            post(
                JSON.stringify({
                    question: "status?",
                    priorSubjectReceipts: [{ result_id: resultId, receipt_id: receiptId }],
                }),
            );

        it("rejects an over-bound result_id even when receipt_id is valid", async () => {
            const response = await POST(asymmetric(astral.repeat(257), "receipt_1234567890"));

            expect(response.status).toBe(400);
            expect((await failureOf(response)).code).toBe("acr_rejected_request");
        });

        it("rejects an over-bound receipt_id even when result_id is valid", async () => {
            const response = await POST(asymmetric("result_1234567890", astral.repeat(257)));

            expect(response.status).toBe(400);
            expect((await failureOf(response)).code).toBe("acr_rejected_request");
        });

        it("rejects an under-bound result_id even when receipt_id is valid", async () => {
            const response = await POST(asymmetric("short", "receipt_1234567890"));

            expect(response.status).toBe(400);
            expect((await failureOf(response)).code).toBe("acr_rejected_request");
        });
    });

    /**
     * The proof that the old behaviour is now unrepresentable: a request
     * carrying one good and one malformed receipt cannot proceed with just the
     * good one. It cannot proceed at all.
     */
    it("rejects the whole request when only SOME receipts are malformed", async () => {
        const response = await POST(
            post(
                JSON.stringify({
                    question: "status?",
                    priorSubjectReceipts: [
                        { result_id: "result_12345678", receipt_id: "receipt_12345678" },
                        { result_id: "result_12345678" },
                    ],
                }),
            ),
        );

        expect(response.status).toBe(400);
        expect((await failureOf(response)).code).toBe("acr_rejected_request");
    });
});

/**
 * CHAOS-3927 P2: the four structure-receipt fields extend the SAME
 * malformed-rejects-the-whole-request discipline as priorSubjectReceipts,
 * plus one more check subject receipts don't need — the closed
 * kindr_/ancr_/handr_/winr_ namespace per field (design brief §2.1: "none
 * of the four ... may ever accept another's namespace").
 */
describe("structure receipts are validated with the same discipline as subject receipts", () => {
    const STRUCTURE_FIELDS = [
        ["priorKindReceipts", "kind"],
        ["priorAnchorReceipts", "repository/project/team"],
        ["priorHandleReceipts", "handle"],
        ["priorWindowReceipts", "time window"],
    ] as const;

    for (const [field, label] of STRUCTURE_FIELDS) {
        it(`rejects a malformed ${field} entry with a 400`, async () => {
            const response = await POST(
                post(
                    JSON.stringify({
                        question: "status?",
                        [field]: [{ result_id: "result_12345678" }],
                    }),
                ),
            );

            expect(response.status).toBe(400);
            const failure = await failureOf(response);
            expect(failure.code).toBe("acr_rejected_request");
            expect(failure.message).toContain(label);
        });

        it(`rejects the whole request when only SOME ${field} entries are malformed`, async () => {
            const namespaced = {
                priorKindReceipts: "kindr_",
                priorAnchorReceipts: "ancr_",
                priorHandleReceipts: "handr_",
                priorWindowReceipts: "winr_",
            }[field];
            const response = await POST(
                post(
                    JSON.stringify({
                        question: "status?",
                        [field]: [
                            { result_id: "result_12345678", receipt_id: `${namespaced}12345678` },
                            { result_id: "result_12345678" },
                        ],
                    }),
                ),
            );

            expect(response.status).toBe(400);
            expect((await failureOf(response)).code).toBe("acr_rejected_request");
        });
    }

    /**
     * The namespace check this field-set has and priorSubjectReceipts
     * doesn't: a shape-valid receipt in the WRONG member's namespace is
     * still malformed, per §2.1's closed-namespace rule.
     */
    it("rejects a kind receipt namespaced for anchor confirmation", async () => {
        const response = await POST(
            post(
                JSON.stringify({
                    question: "status?",
                    priorKindReceipts: [
                        { result_id: "result_12345678", receipt_id: "ancr_1234567890123" },
                    ],
                }),
            ),
        );

        expect(response.status).toBe(400);
        expect((await failureOf(response)).code).toBe("acr_rejected_request");
    });

    it("accepts a correctly-namespaced structure receipt (past validation)", async () => {
        const response = await POST(
            post(
                JSON.stringify({
                    question: "status?",
                    priorKindReceipts: [
                        { result_id: "result_12345678", receipt_id: "kindr_1234567890123" },
                    ],
                }),
            ),
        );

        // Past receipt validation: it fails later for missing config, not
        // for the receipt shape.
        expect(response.status).toBe(500);
        expect((await failureOf(response)).code).toBe("workbench_misconfigured");
    });
});

describe("configuration failures are reported as configuration failures", () => {
    it("reports an unconfigured server hop rather than blaming ACR", async () => {
        vi.stubEnv("ACR_API_ORIGIN", "");

        const response = await POST(post(JSON.stringify({ question: "status?" })));

        expect(response.status).toBe(500);
        const failure = await failureOf(response);
        expect(failure.code).toBe("workbench_misconfigured");
        expect(failure.retryable).toBe(false);
    });
});
