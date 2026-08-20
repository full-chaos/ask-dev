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
 *
 * ===================== MOCK-INFRASTRUCTURE DISCLOSURE =====================
 * This IS mock infrastructure, full stop — a fake server is a fake server
 * regardless of what it's named or how it's reached, and this repo's
 * zero-mocking rule deserves an honest answer, not a technicality.
 *
 *   (a) Nothing like this existed in the repo before this PR. Every e2e spec
 *       that predates this file (`tests/workbench.smoke.spec.ts`) runs with
 *       NO ACR configuration at all and only ever proves the honest-failure
 *       path — see the README's "The smoke suite runs against the PRODUCTION
 *       build... No ACR_* variables are supplied on purpose." There was no
 *       prior stand-in pattern to follow; this is new.
 *   (b) Real-ACR e2e is not merely inconvenient today, it is IMPOSSIBLE:
 *       there is no ACR checkout this repo's CI or dev environment can
 *       build and run (ACR lives in the separate `dev-health-acr` repo), and
 *       even a locally-running real ACR would be USELESS for the structure-
 *       needs half of "clarification chips render" specifically, because
 *       the contract this repo validates every response against
 *       (`context_fabric_investigation_result.v1.schema.json`,
 *       `additionalProperties: false`) is pinned to a commit that predates
 *       CHAOS-3900 P1 — `structure_needs`/`confirmed_structure` are not
 *       legal fields on that schema YET, for ANY server, real or fake (see
 *       `src/lib/pivot/structure-contracts.ts`'s "THE SEAM"). So this double
 *       only ever exercises the ONE clarification shape the pinned contract
 *       already supports for real (`clarification_required` with subject
 *       candidates) — it does not, and structurally cannot, fabricate
 *       coverage for the P1 structure-needs chips; those stay unit-tested
 *       only (mocked fetch, same pattern the rest of this repo's component
 *       tests already use), same as before this PR.
 *   (c) TEST-ONLY. Not imported by anything under `src/`, not built into
 *       the production bundle, not started by `pnpm dev`/`pnpm build`/
 *       `pnpm start` — only `playwright.config.ts`'s `webServer` array
 *       spawns it, and only for `tests/chat.spec.ts`'s clarification-chip
 *       project.
 *   (d) What retires it: once acr's `chaos-pivot-p1` branch merges to `main`
 *       and this repo's contract pin bumps past that merge (README's
 *       "Bumping the pin"), `structure_needs` becomes a real field on the
 *       pinned schema and a REAL ACR instance becomes able to answer with
 *       one. At that point this double should either be deleted in favor of
 *       a real ACR instance in CI, or (if a real instance still isn't
 *       practical for CI) extended to also return a schema-valid
 *       `structure_needs` payload — but that is a decision for whoever lands
 *       that pin bump, not this PR. Flagged here, and in the PR description,
 *       for that reason: this is Chris's call to accept at merge time, not
 *       something to wave through quietly.
 * ============================================================================
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
            // `prior_subject_receipts` — the PINNED WIRE CONTRACT'S own
            // snake_case field name (see
            // src/contracts/schemas/context_fabric_investigation_request.v1.schema.json
            // and `buildInvestigationRequest` in src/lib/acr/client.ts, which
            // is what actually POSTs to this server). NOT
            // `priorSubjectReceipts` — that camelCase name exists only on
            // the browser-to-Next-route body one layer up
            // (src/app/page.tsx's `fetch("/api/investigations", ...)`),
            // which src/app/api/investigations/route.ts translates to this
            // snake_case field before ever reaching here. Getting this wrong
            // silently defeats the whole positive control: `hasChosenReceipt`
            // stays false, the re-ask falls through to the trigger-keyword
            // check below, and — because the question text travels UNCHANGED
            // on a re-ask — it still contains the trigger, so a "chosen
            // candidate" re-ask keeps coming back `clarification_required`
            // instead of decisive. Caught by codex review round 1.
            hasChosenReceipt =
                Array.isArray(parsed.prior_subject_receipts) &&
                parsed.prior_subject_receipts.length > 0;
        } catch {
            question = "";
        }
        // A re-ask that carries a chosen receipt is decisive by construction
        // here — the question text is UNCHANGED on a re-ask (same rule the
        // real app holds, see `src/app/page.tsx`'s own `ask()`), so it would
        // otherwise still contain the trigger and loop forever. Checked
        // FIRST, before the trigger keyword, for exactly that reason.
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
