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
 * result with subject candidates, TRIGGER_STRUCTURE_NEEDS returns one with a
 * `structure_needs` disclosure (kind offers) instead, TRIGGER_CANDIDATE_NEEDS
 * (CHAOS-4012/CHAOS-4171) returns one with a candidate-list disclosure
 * instead, TRIGGER_MIXED returns one with BOTH clarification and kind offers
 * at once, and TRIGGER_CONVERSATION_ECHO returns a decisive result whose
 * `deterministic_answer` reports back what `conversation` the request itself
 * carried. Every other question returns the canonical `complete` example
 * unchanged apart from `question`/`result_id`/`request_id`, so it never
 * accidentally collides with any scenario's identifiers.
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
 *       `"clarification chips"`, `"structure needs chips"`, `"mixed receipt
 *       families"`, and `"conversation threading"` describe blocks actually
 *       TALK to it, by overriding `baseURL` to the configured app instance
 *       that points at it (codex review round 2, correcting an earlier
 *       version of this comment that implied the double itself was scoped
 *       to one spec; extended again in round 2 of the mixed-receipt-family
 *       and conversation-threading follow-up for the same reason).
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
// Mixed-receipt-family unification follow-up: a response that discloses
// BOTH a subject-candidate clarification AND a structure_needs disclosure
// at once — legal on the pinned schema (the two are independent optional
// fields on the same result) and wire-legal only since P1 landed.
export const TRIGGER_MIXED = "e2e-mixed-me";
// Conversation threading follow-up: echoes back what `conversation` this
// request itself carried, so an e2e spec can prove turn 2 actually threads
// turn 1's own content rather than merely asserting the request "looks
// fine" some other way.
export const TRIGGER_CONVERSATION_ECHO = "e2e-conversation-echo";
// CHAOS-4171/CHAOS-4012: the candidate-list offer axis — mirrors
// TRIGGER_STRUCTURE_NEEDS exactly, one member over (`subject_candidate`
// instead of `expected_kind`), so the real-HTTP round trip for
// CandidateOptionsSection gets the same proof the kind-offer path already
// has, not just component-level coverage.
export const TRIGGER_CANDIDATE_NEEDS = "e2e-candidate-me";
// CHAOS-4355 stopgap: conversation-memory carry. Models the pilot's own
// 3-request shape at the real-HTTP level: turn 1 offers a window; turn 2
// confirms the window ALONGSIDE a subject-candidate pick and gets back
// `confirmed_structure` (window applied) plus a FRESH clarification (never
// the same candidates again); turn 3 picks from THAT fresh list with no
// structure batch of its own. This double is decisive on turn 3 ONLY when
// `prior_window_receipts` still carries turn 1's window receipt — proving
// the real wire round trip that the client resent it, not just that a
// mocked-fetch unit test believes it did.
export const TRIGGER_CARRY = "e2e-carry-me";

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
// The exact candidate set `clarificationResult` (and `mixedResult`, which
// reuses it) discloses — hoisted so the receipt-recognition check below can
// validate a re-ask's chosen subject receipt against these SAME ids, never a
// wider "any non-empty array" match. Mirrors `STRUCTURE_KIND_OPTIONS`'s own
// reasoning exactly (codex round 2, finding 3): a bug that sent back a
// stale or wrong candidate's receipt (not merely SOME receipt) would
// otherwise still read as decisive here.
const SUBJECT_CANDIDATES = [
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
];

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
            candidates: SUBJECT_CANDIDATES,
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
 * member (`expected_kind`) and two `kindr_`-namespaced kind offers — same
 * SHAPE and same reason each judgment field is emptied as
 * `src/test/fixtures/structure-needs.ts`'s own `kindDisambiguationScenario`
 * (a result that has not resolved WHICH census to run has no judgment to
 * give), but not a field-for-field mirror: that fixture also discloses
 * `accepted_grammars`, which this double's one e2e scenario has no need for
 * (nothing in the chat surface currently renders it) and so omits.
 */
// The exact offer set `structureNeedsResult` discloses — hoisted so the
// receipt-recognition check below (`isOfferedKindReceipt`) can validate a
// re-ask's chosen receipt against these SAME ids, never a wider match. A
// bug that sent the wrong offer's receipt (not merely the wrong FIELD) is
// what this specificity catches; matching only "any kindr_-shaped id" would
// not.
const STRUCTURE_KIND_OPTIONS = [
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
];

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
            kind_options: STRUCTURE_KIND_OPTIONS,
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

/**
 * CHAOS-4012/CHAOS-4171: a `structure_needs` disclosure whose only missing
 * member is `subject_candidate` — same shape as `structureNeedsResult`
 * above, one member over. `candidateOfferMaterial` (acr-side) fires this
 * axis independently of a kind-pick, so this scenario stays single-family
 * on purpose (mirrors `structureNeedsResult`'s own scope note).
 */
const STRUCTURE_CANDIDATE_OPTIONS = [
    {
        receipt_id: "candr_e2e_work_item_0001",
        option_id: "candidate_work_item_9001",
        label: "WORK-9001: Investigate flaky test",
        kind: "work_item",
        canonical_id: "work_item:9001",
        offer_source: "engine",
    },
    {
        receipt_id: "candr_e2e_work_item_0002",
        option_id: "candidate_work_item_9002",
        label: "WORK-9002: Rotate signing key",
        kind: "work_item",
        canonical_id: "work_item:9002",
        offer_source: "engine",
    },
];

function candidateNeedsResult(question) {
    const result = structuredClone(canonical);
    return {
        ...result,
        result_id: "result_e2e_candidate_0001",
        request_id: "request_e2e_candidate_0001",
        question,
        status: "clarification_required",
        interpretation: {
            ...result.interpretation,
            clarification_needed: true,
            clarification_reason: "Nothing committed, and the resolution's own pool is non-empty.",
        },
        subject_resolution: { candidates: [], committed: [] },
        structure_needs: {
            missing: ["subject_candidate"],
            candidate_options: STRUCTURE_CANDIDATE_OPTIONS,
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
        limitations: ["No judgment was formed because no candidate was chosen."],
        deterministic_answer: "Which candidate this question is about is unresolved.",
        warnings: [],
    };
}

/**
 * The mixed scenario (mixed-receipt-family unification follow-up): the SAME
 * subject candidates as `clarificationResult` AND the SAME kind offers as
 * `structureNeedsResult`, disclosed on ONE result. Proves the co-presence
 * this double's two single-family scenarios never exercise together, and
 * lets the routing below require BOTH receipt families to arrive on the
 * re-ask before it is decisive — the mutation-provable positive control:
 * break `chooseCandidate` back to sending only the subject receipt and this
 * scenario stops resolving.
 */
function mixedResult(question) {
    const clarification = clarificationResult(question);
    const structure = structureNeedsResult(question);
    return {
        ...clarification,
        result_id: "result_e2e_mixed_0001",
        request_id: "request_e2e_mixed_0001",
        interpretation: {
            ...clarification.interpretation,
            clarification_reason:
                "The term matches more than one canonical subject, and the question does not name which kind of thing it is about.",
        },
        structure_needs: structure.structure_needs,
        limitations: [
            "No judgment was formed because the subject and the kind are both unresolved.",
        ],
        deterministic_answer:
            "The subject and the kind of thing this question is about are unresolved.",
    };
}

/**
 * Conversation threading follow-up: echoes back the turn count and every
 * prior USER turn's own content it received in `conversation` (verbatim, so
 * a spec can assert turn 1's own question text reappears in turn 2's
 * answer) — proving the SERVER actually received what the client claims to
 * have sent, not just that the client built something locally.
 */
// The pinned contract's own bound on `deterministic_answer`
// (`maxLength: 12000` — context_fabric_investigation_result.v1.schema.json).
// `priorUserContent` below is capped well under it: two legal
// `conversation` turns near their own 12000-char `content` cap would
// otherwise concatenate past this result's own bound and make the double
// return a schema-invalid response (codex round 2, finding 4).
const MAX_ECHOED_CONTENT_LENGTH = 4_000;

function conversationEchoResult(question, conversation) {
    const turns = Array.isArray(conversation) ? conversation : [];
    const priorUserContent = turns
        .filter((turn) => turn && turn.role === "user")
        .map((turn) => turn.content)
        .join(" | ")
        .slice(0, MAX_ECHOED_CONTENT_LENGTH);
    const result = structuredClone(canonical);
    return {
        ...result,
        result_id: "result_e2e_conversation_0001",
        request_id: "request_e2e_conversation_0001",
        question,
        status: "complete",
        deterministic_answer: `conversation_turns=${String(turns.length)}; prior_user_content=${priorUserContent}`,
    };
}

/**
 * CHAOS-4355 stopgap, turn 1's own offer — a single window option, distinct
 * receipt namespace from every other scenario's own window/kind/candidate
 * ids so a cross-scenario mismatch cannot accidentally read as decisive.
 */
const CARRY_WINDOW_OPTIONS = [
    {
        receipt_id: "winr_e2e_carry_trailing_30d_0001",
        option_id: "window_trailing_30d",
        label: "Last 30 days",
        relative_id: "trailing_30d",
        start: "2026-07-20T00:00:00Z",
        end: "2026-08-19T00:00:00Z",
    },
];

/**
 * A SEPARATE candidate pool from `SUBJECT_CANDIDATES` — reachable only
 * AFTER the window is confirmed. Using a distinct pool (not the same
 * candidates repeated) is what makes turn 2 -> turn 3 a genuine state
 * transition, matching what the pilot actually observed ("a fresh
 * candidate-confirmation clarification", never the same one again).
 */
const CARRY_FRESH_SUBJECT_CANDIDATES = [
    {
        receipt_id: "receipt_e2e_carry_fresh_ask_dev",
        subject: { kind: "project", canonical_id: "project_ask_dev", label: "Ask Dev" },
        state: "ambiguous",
        matched_terms: ["Ask Dev"],
        match_reasons: ["Exact canonical project label."],
        confidence: 0.6,
        evidence_ref_ids: ["evidence_project_identity"],
    },
    {
        receipt_id: "receipt_e2e_carry_fresh_atlas",
        subject: { kind: "project", canonical_id: "project_atlas", label: "Atlas" },
        state: "ambiguous",
        matched_terms: ["Atlas"],
        match_reasons: ["Fuzzy canonical project label."],
        confidence: 0.4,
        evidence_ref_ids: ["evidence_project_identity"],
    },
];

const CARRY_TURN1_RESULT_ID = "result_e2e_carry_turn1_0001";

function carryTurn1Result(question) {
    const clarification = clarificationResult(question);
    return {
        ...clarification,
        result_id: CARRY_TURN1_RESULT_ID,
        request_id: "request_e2e_carry_turn1_0001",
        structure_needs: { missing: ["window"], window_options: CARRY_WINDOW_OPTIONS },
    };
}

/**
 * Turn 2's response: the window applied (`confirmed_structure`), and a
 * FRESH subject clarification distinct from turn 1's own candidates — never
 * decisive by itself, exactly the pilot's own observed shape ("a fresh
 * candidate-confirmation clarification").
 */
function carryTurn2Result(question) {
    const result = structuredClone(canonical);
    return {
        ...result,
        result_id: "result_e2e_carry_turn2_0001",
        request_id: "request_e2e_carry_turn2_0001",
        question,
        status: "clarification_required",
        interpretation: {
            ...result.interpretation,
            clarification_needed: true,
            clarification_reason: "A different candidate still needs to be chosen.",
        },
        subject_resolution: {
            candidates: CARRY_FRESH_SUBJECT_CANDIDATES,
            committed: [],
            clarification_prompt: "Did you mean Ask Dev or Atlas?",
        },
        confirmed_structure: [
            {
                member: "window",
                applied_value: "trailing_30d",
                source: "receipt",
                prior_result_id: CARRY_TURN1_RESULT_ID,
                receipt_id: CARRY_WINDOW_OPTIONS[0].receipt_id,
                offer_source: "engine",
                provenance: "clarification_confirmed",
                disposition: "applied",
            },
        ],
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
        let hasSubjectReceipt = false;
        let hasKindReceipt = false;
        let hasCandidateReceipt = false;
        let hasCarryWindowReceipt = false;
        let hasCarryFreshSubjectReceipt = false;
        let conversation;
        try {
            const parsed = JSON.parse(body);
            question = typeof parsed.question === "string" ? parsed.question : "";
            conversation = parsed.conversation;
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
            // ever offers `kind_options`. Matched against the EXACT offered
            // receipt ids (`STRUCTURE_KIND_OPTIONS`), not merely "some
            // kindr_-shaped id" — codex round 1: a bug that sent back the
            // wrong offer's receipt (not just the wrong wire field) would
            // otherwise still read as decisive here.
            // codex round 2 (P3, documented rather than fixed — this double
            // exists to prove the wire round-trip, not to be the contract's
            // enforcement layer): the two branches are ORed, so a structure
            // receipt that somehow landed in `prior_subject_receipts` instead
            // of `prior_kind_receipts` would still read as decisive here.
            // The real contract validator (`validateContract`, run by both
            // the real client and this double's own schema conformance) is
            // what actually rejects a receipt outside its namespace on the
            // wire; this double's job is narrower — proving the CORRECT
            // field carries the CORRECT receipt when everything is wired
            // right, which the exact-id match above already does.
            const chosenKindReceiptIds = Array.isArray(parsed.prior_kind_receipts)
                ? parsed.prior_kind_receipts.map((receipt) => receipt?.receipt_id)
                : [];
            const chosenSubjectReceiptIds = Array.isArray(parsed.prior_subject_receipts)
                ? parsed.prior_subject_receipts.map((receipt) => receipt?.receipt_id)
                : [];
            // Matched against the EXACT offered candidate ids
            // (`SUBJECT_CANDIDATES`), the same discipline as the kind-receipt
            // check just below — codex round 2, finding 3: "any non-empty
            // array" let a wrong or stale subject receipt read as decisive.
            // `result_id` is NOT checked, matching the kind-receipt check's
            // own documented (not fixed) gap two comments below: this
            // double proves the CORRECT field carries the CORRECT offer's
            // receipt id, not full contract enforcement — that is
            // `validateContract`'s job, exercised by both the real client
            // and this double's own schema conformance.
            hasSubjectReceipt = chosenSubjectReceiptIds.some((receiptId) =>
                SUBJECT_CANDIDATES.some((candidate) => candidate.receipt_id === receiptId),
            );
            hasKindReceipt = chosenKindReceiptIds.some((receiptId) =>
                STRUCTURE_KIND_OPTIONS.some((option) => option.receipt_id === receiptId),
            );
            // `prior_candidate_receipts` (CHAOS-4012): same wire-renamed
            // pattern as `prior_kind_receipts` above, one layer up.
            const chosenCandidateReceiptIds = Array.isArray(parsed.prior_candidate_receipts)
                ? parsed.prior_candidate_receipts.map((receipt) => receipt?.receipt_id)
                : [];
            hasCandidateReceipt = chosenCandidateReceiptIds.some((receiptId) =>
                STRUCTURE_CANDIDATE_OPTIONS.some((option) => option.receipt_id === receiptId),
            );
            hasChosenReceipt = hasSubjectReceipt || hasKindReceipt || hasCandidateReceipt;
            // CHAOS-4355 stopgap: `prior_window_receipts` — the wire-renamed
            // sibling of `prior_kind_receipts` above, one layer up. Matched
            // against the EXACT offered window id, same discipline as every
            // other receipt check in this double.
            const chosenWindowReceiptIds = Array.isArray(parsed.prior_window_receipts)
                ? parsed.prior_window_receipts.map((receipt) => receipt?.receipt_id)
                : [];
            hasCarryWindowReceipt = chosenWindowReceiptIds.some((receiptId) =>
                CARRY_WINDOW_OPTIONS.some((option) => option.receipt_id === receiptId),
            );
            hasCarryFreshSubjectReceipt = chosenSubjectReceiptIds.some((receiptId) =>
                CARRY_FRESH_SUBJECT_CANDIDATES.some(
                    (candidate) => candidate.receipt_id === receiptId,
                ),
            );
        } catch {
            question = "";
        }
        // A re-ask that carries a chosen receipt is decisive by construction
        // here — the question text is UNCHANGED on a re-ask (same rule the
        // real app holds, see `src/app/page.tsx`'s own `ask()`), so it would
        // otherwise still contain the trigger and loop forever. Checked
        // FIRST, before either trigger keyword, for exactly that reason.
        //
        // The mixed scenario is a SEPARATE branch, checked ahead of the
        // single-family `hasChosenReceipt` check: it requires BOTH families
        // to be present before it is decisive, which is exactly what proves
        // `chooseCandidate` carries the tester's own unconfirmed structure
        // picks along with the subject receipt it always sent — the mixed-
        // receipt-family unification this scenario exists to prove.
        const result = question.includes(TRIGGER_MIXED)
            ? hasSubjectReceipt && hasKindReceipt
                ? answeredResult(question)
                : mixedResult(question)
            : question.includes(TRIGGER_CONVERSATION_ECHO)
              ? conversationEchoResult(question, conversation)
              : question.includes(TRIGGER_CARRY)
                ? hasCarryFreshSubjectReceipt
                    ? hasCarryWindowReceipt
                        ? // Turn 3, WITH the carried window: decisive. This is
                          // the fix — turn 3 never picked a window itself.
                          answeredResult(question)
                        : // Turn 3, WITHOUT the carried window: reproduces the
                          // defect's own symptom exactly — stuck on the SAME
                          // fresh clarification rather than ever landing.
                          carryTurn2Result(question)
                    : hasCarryWindowReceipt
                      ? // Turn 2: window + turn 1's subject pick arrived
                        // together -> confirm the window, offer a FRESH
                        // clarification (never turn 1's own candidates again).
                        carryTurn2Result(question)
                      : // Turn 1: the opening ask.
                        carryTurn1Result(question)
                : hasChosenReceipt
                  ? answeredResult(question)
                  : question.includes(TRIGGER_STRUCTURE_NEEDS)
                    ? structureNeedsResult(question)
                    : question.includes(TRIGGER_CANDIDATE_NEEDS)
                      ? candidateNeedsResult(question)
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
