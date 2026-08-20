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
 * result with subject candidates, a question containing
 * TRIGGER_STRUCTURE_NEEDS returns a `clarification_required` result with a
 * `structure_needs` disclosure (kind offers) instead. Every other question
 * returns the canonical `complete` example unchanged apart from
 * `question`/`result_id`/`request_id`, so it never accidentally collides
 * with either scenario's identifiers.
 *
 * ===================== MOCK-INFRASTRUCTURE DISCLOSURE =====================
 * This IS mock infrastructure, full stop — a fake server is a fake server
 * regardless of what it's named or how it's reached, and this repo's
 * zero-mocking rule deserves an honest answer, not a technicality.
 *
 *   (a) Nothing like this existed in the repo before the PR that introduced
 *       this file. Every e2e spec that predates it (`tests/workbench.smoke.spec.ts`)
 *       runs with NO ACR configuration at all and only ever proves the
 *       honest-failure path (see the README's "Gates" section — the
 *       unconfigured instance is still exactly that, unconfigured). There
 *       was no prior stand-in pattern to follow; this was new.
 *   (b) Real-ACR e2e is not merely inconvenient, it is IMPOSSIBLE in this
 *       repo's CI or dev environment: there is no ACR checkout either can
 *       build and run (ACR lives in the separate `dev-health-acr` repo). So
 *       this double is what makes "clarification chips render" and
 *       "structure-needs chips render" provable at the real-HTTP-request
 *       level at all — not merely at the mocked-fetch, component-test level
 *       the rest of this repo's suite otherwise relies on for both.
 *   (c) TEST-ONLY. Not imported by anything under `src/`, not built into
 *       the production bundle, not started by `pnpm dev`/`pnpm build`/
 *       `pnpm start` — only `playwright.config.ts`'s `webServer` array
 *       spawns it (alongside every OTHER e2e spec's run, since Playwright
 *       starts every `webServer` entry up front — this process just sits
 *       idle for any spec that never talks to it). Only `tests/chat.spec.ts`'s
 *       `"clarification chips"` and `"structure needs chips"` describe
 *       blocks actually TALK to it, by overriding `baseURL` to the
 *       configured app instance that points at it (codex review round 2,
 *       correcting an earlier version of this comment that implied the
 *       double itself was scoped to one spec).
 *   (d) CHAOS-3927 P1 (+ CHAOS-3900 W1) merged to acr `main`, and this
 *       repo's contract pin bumped past that merge (README's "Bumping the
 *       pin", pin `7d275c2e`): `structure_needs`/`confirmed_structure` are
 *       now real fields on the pinned schema this double validates every
 *       response against, the same schema the real client validates
 *       against. This double was EXTENDED (`structureNeedsResult` /
 *       `TRIGGER_STRUCTURE_NEEDS` below), per this comment's own prior
 *       version flagging that as the intended path once the pin bumped —
 *       not retired, because a real ACR instance in CI is still not
 *       practical (see (b)), and this double is still the only thing that
 *       proves the wire round-trip (not just the mocked-fetch unit level)
 *       for structure-needs chips specifically.
 * ============================================================================
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.FAKE_ACR_PORT ?? "4021");
export const TRIGGER_CLARIFICATION = "e2e-clarify-me";
export const TRIGGER_STRUCTURE_NEEDS = "e2e-structure-me";

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

/**
 * CHAOS-3927 P1/P2: a `structure_needs` disclosure with a single missing
 * member (`expected_kind`) and two `kindr_`-namespaced kind offers — mirrors
 * `src/test/fixtures/structure-needs.ts`'s own `kindDisambiguationScenario`
 * field-for-field (same reason each judgment field is emptied: a result
 * that has not resolved WHICH census to run has no judgment to give).
 */
function structureNeedsResult(question) {
    const result = structuredClone(canonical);
    return {
        ...result,
        result_id: "result_e2e_structure_0001",
        request_id: "request_e2e_structure_0001",
        question,
        status: "clarification_required",
        interpretation: {
            ...result.interpretation,
            clarification_needed: true,
            clarification_reason: "The question does not name which kind of thing it is about.",
        },
        subject_resolution: { candidates: [], committed: [] },
        structure_needs: {
            missing: ["expected_kind"],
            kind_options: [
                {
                    receipt_id: "kindr_e2e_pull_request_0001",
                    option_id: "kind_pull_request",
                    label: "Pull request",
                    kind: "pull_request",
                    offer_source: "engine",
                },
                {
                    receipt_id: "kindr_e2e_ci_pipeline_run_0001",
                    option_id: "kind_ci_pipeline_run",
                    label: "CI pipeline run",
                    kind: "ci_pipeline_run",
                    offer_source: "engine",
                },
            ],
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
        limitations: ["No judgment was formed because the kind is unresolved."],
        deterministic_answer: "The kind of thing this question is about is unresolved.",
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
            // src/contracts/schemas/context_fabric_investigation_request.v1.schema.json).
            // NOT `priorSubjectReceipts` — that camelCase name is the
            // browser-to-Next-route body's own field, one layer up
            // (src/app/page.tsx's `fetch("/api/investigations", ...)`).
            // src/app/api/investigations/route.ts forwards that value
            // UNCHANGED (still camelCase, as a same-named JS option) into
            // `investigate()`; it is `buildInvestigationRequest` in
            // src/lib/acr/client.ts — the function that actually POSTs to
            // THIS server — that renames it to `prior_subject_receipts` on
            // the wire (codex review round 2, correcting an earlier version
            // of this comment that credited the route with the rename).
            // Getting this wrong silently defeats the whole positive
            // control: `hasChosenReceipt` stays false, the re-ask falls
            // through to the trigger-keyword check below, and — because the
            // question text travels UNCHANGED on a re-ask — it still
            // contains the trigger, so a "chosen candidate" re-ask keeps
            // coming back `clarification_required` instead of decisive.
            // Caught by codex review round 1.
            //
            // `prior_kind_receipts` (and its three window/anchor/handle
            // siblings) is the SAME wire-renamed pattern, one layer up in the
            // CHAOS-3927 P1 structure-receipt flow — `buildInvestigationRequest`
            // renames the route's `priorKindReceipts` option the same way.
            // Checking only `prior_kind_receipts` (not all four) is enough
            // for this double's one structure-needs scenario, which only
            // ever offers `kind_options`.
            hasChosenReceipt =
                (Array.isArray(parsed.prior_subject_receipts) &&
                    parsed.prior_subject_receipts.length > 0) ||
                (Array.isArray(parsed.prior_kind_receipts) &&
                    parsed.prior_kind_receipts.length > 0);
        } catch {
            question = "";
        }
        // A re-ask that carries a chosen receipt is decisive by construction
        // here — the question text is UNCHANGED on a re-ask (same rule the
        // real app holds, see `src/app/page.tsx`'s own `ask()`), so it would
        // otherwise still contain the trigger and loop forever. Checked
        // FIRST, before either trigger keyword, for exactly that reason.
        const result = hasChosenReceipt
            ? answeredResult(question)
            : question.includes(TRIGGER_STRUCTURE_NEEDS)
              ? structureNeedsResult(question)
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
