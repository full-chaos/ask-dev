#!/usr/bin/env node
/**
 * A REAL HTTP server standing in for ACR, for e2e only.
 *
 * "e2e uses zero mocking" means no `page.route` interception and no fetch
 * stubbing inside the app or the test runner — every request in the e2e
 * suite is a genuine network call. It does not mean the suite can only ever
 * exercise ACR's absence: the Workbench/Ask Dev route already has (and
 * needs) a smoke test for that path (`tests/workbench.smoke.spec.ts`), but
 * "clarification chips render" and "clarification chips do not render" can
 * only be proven by driving the REAL `/api/investigations` server hop
 * against something that answers like ACR — and there is no committed ACR
 * checkout this repo can start. This process is that something: a plain
 * Node HTTP server on the real network, reached over a real fetch from the
 * app's server-only ACR client (`src/lib/acr/client.ts`), returning
 * responses that satisfy the SAME pinned JSON Schema
 * (`context_fabric_investigation_result.v1.schema.json`) the real client
 * validates every response against. It is not product code, does not ship,
 * and is never imported by anything under `src/` — it lives entirely in
 * `tests/`, same as the Playwright specs it backs.
 *
 * It does not verify the `X-ACR-Web-Assertion` header. Signature
 * verification is ACR's own concern and is exercised nowhere in this repo
 * (real ACR is the only thing that holds the corresponding public key); this
 * double's job is only to prove the Workbench/Ask Dev UI renders a
 * schema-valid response correctly, not to re-prove ACR's auth.
 *
 * Response selection is a dumb keyword router, not a scenario engine: a
 * question containing TRIGGER_CLARIFICATION returns a `clarification_required`
 * result with subject candidates (ACR's real, pinned-schema shape — NOT the
 * pivot's `structure_needs`, which the pinned schema's `additionalProperties:
 * false` would reject outright, see the file-level note in
 * `src/lib/pivot/structure-contracts.ts`). Every other question returns the
 * canonical `complete` example unchanged apart from `question`/`result_id`/
 * `request_id`, so it never accidentally collides with the clarification
 * scenario's identifiers.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.FAKE_ACR_PORT ?? "4021");
export const TRIGGER_CLARIFICATION = "e2e-clarify-me";

const canonical = JSON.parse(
    readFileSync(
        join(__dirname, "../../src/contracts/examples/context_fabric_investigation_result.v1.json"),
        "utf8",
    ),
);

function answeredResult(question) {
    return {
        ...structuredClone(canonical),
        result_id: "result_e2e_answered_0001",
        request_id: "request_e2e_answered_0001",
        question,
    };
}

/**
 * Mirrors `src/test/fixtures/investigations.ts`'s own `clarificationScenario`
 * override set field-for-field: same reason each field is emptied (a result
 * that has not resolved a subject has no judgment to give).
 */
function clarificationResult(question) {
    const result = structuredClone(canonical);
    return {
        ...result,
        result_id: "result_e2e_clarify_0001",
        request_id: "request_e2e_clarify_0001",
        question,
        status: "clarification_required",
        interpretation: {
            ...result.interpretation,
            clarification_needed: true,
            clarification_reason: "The term matches more than one canonical subject.",
        },
        subject_resolution: {
            candidates: [
                {
                    receipt_id: "receipt_e2e_ask_dev",
                    subject: { kind: "project", canonical_id: "project_ask_dev", label: "Ask Dev" },
                    state: "ambiguous",
                    matched_terms: ["Ask Dev"],
                    match_reasons: ["Exact canonical project label."],
                    confidence: 0.6,
                    evidence_ref_ids: ["evidence_project_identity"],
                },
                {
                    receipt_id: "receipt_e2e_atlas",
                    subject: { kind: "project", canonical_id: "project_atlas", label: "Atlas" },
                    state: "ambiguous",
                    matched_terms: ["Atlas"],
                    match_reasons: ["Fuzzy canonical project label."],
                    confidence: 0.4,
                    evidence_ref_ids: ["evidence_project_identity"],
                },
            ],
            committed: [],
            clarification_prompt: "Did you mean Ask Dev or Atlas?",
        },
        direct_judgment: "",
        current_state: "",
        strongest_pressures: [],
        drivers: [],
        remaining_work: [],
        readiness_gaps: [],
        paths: [],
        conflicts: [],
        claimed_facts: [],
        limitations: ["No judgment was formed because the subject is unresolved."],
        deterministic_answer: "The subject is ambiguous, so no judgment was formed.",
        warnings: [],
    };
}

const server = createServer((request, response) => {
    // Playwright's `webServer.url` readiness probe is a plain GET / — answer
    // it distinctly from the (POST-only) investigation endpoint.
    if (request.method === "GET" && request.url === "/") {
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end("fake-acr-server ok");
        return;
    }

    if (request.method !== "POST" || request.url !== "/api/v1/context-fabric/investigations") {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { code: "not_found" } }));
        return;
    }

    let body = "";
    request.on("data", (chunk) => {
        body += chunk;
    });
    request.on("end", () => {
        let question = "";
        let hasChosenReceipt = false;
        try {
            const parsed = JSON.parse(body);
            question = typeof parsed.question === "string" ? parsed.question : "";
            hasChosenReceipt =
                Array.isArray(parsed.priorSubjectReceipts) &&
                parsed.priorSubjectReceipts.length > 0;
        } catch {
            question = "";
        }
        // A re-ask that carries a chosen receipt (the app's own
        // `prior_subject_receipts`) is decisive by construction here — the
        // question text is UNCHANGED on a re-ask (same rule the real app
        // holds, see `src/app/page.tsx`'s own `ask()`), so it would otherwise
        // still contain the trigger and loop forever. Checked FIRST, before
        // the trigger keyword, for exactly that reason.
        const result = hasChosenReceipt
            ? answeredResult(question)
            : question.includes(TRIGGER_CLARIFICATION)
              ? clarificationResult(question)
              : answeredResult(question);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(result));
    });
});

server.listen(PORT, "127.0.0.1", () => {
    // Playwright's webServer waits on a URL, not stdout — but a line here
    // still helps a human reading `--debug` output see the double came up.
    console.log(`fake-acr-server listening on http://127.0.0.1:${PORT}`);
});
