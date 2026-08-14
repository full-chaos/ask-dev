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
