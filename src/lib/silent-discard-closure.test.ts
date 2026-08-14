import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/investigations/route";
import { validateContract } from "@/lib/acr/validate";
import { choiceDisposition } from "@/lib/clarification";
import type { InvestigationResult } from "@/lib/contracts";
import { buildComposition } from "@/lib/enrichment/compose";
import { PRESENTATION_MANIFEST_V1 } from "@/lib/enrichment/manifest";
import { validateEnrichment } from "@/lib/enrichment/validate";
import { mockScenarios } from "@/test/fixtures/investigations";
import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";

/**
 * CLASS CLOSURE — "the Workbench presents a state as normal when something was
 * silently discarded or substituted."
 *
 * Five instances of this shape appeared during CHAOS-3738, which is why the
 * class is closed here rather than chased further:
 *
 *   1. OpenUI calls `onError` with an EMPTY array on a clean render; treating
 *      any call as failure made the enriched view fall back permanently.
 *   2. ACR discards a clarification receipt without reporting it (CHAOS-3813).
 *   3. A second clarification after a discarded choice reads as an ordinary
 *      one, letting a tester loop forever.
 *   4. (codex C4) A runtime failure latched, forcing every later valid result
 *      into fallback.
 *   5. (codex C3) A clarification entering the enrichment path rendered an
 *      empty answer with no way to re-ask.
 *
 * Every one of them was invisible for the same reason: the failure mode
 * produces output that looks like ordinary, safe operation. Falling back looks
 * safe. An empty section looks like "nothing to report". A fresh clarification
 * looks like a fresh question.
 *
 * The table below enumerates every seam where a result or user input crosses a
 * boundary. Each is (a) STRUCTURALLY IMPOSSIBLE — with the mechanism named, not
 * merely no known path; (b) DETECTED AND SURFACED; or (c) an ACCEPTED GAP with
 * a real owner. Rows that are mechanically checkable are checked below; the
 * rest carry their evidence in the argument.
 *
 * (c) is deliberately non-empty. A closure table whose every row read
 * "impossible" would be the very shape it exists to close.
 */

const result = canonicalResult as unknown as InvestigationResult;
const clarification = mockScenarios().find((scenario) => scenario.id === "clarification")!.result;

type Verdict = "structurally-impossible" | "detected-and-surfaced" | "accepted-gap";

type Seam = {
    readonly seam: string;
    readonly discard: string;
    readonly verdict: Verdict;
    /** For (a): the mechanism. For (b): where it surfaces. For (c): the owner. */
    readonly evidence: string;
};

export const SILENT_DISCARD_SEAMS: readonly Seam[] = [
    {
        seam: "HTTP body → route",
        discard: "A non-object body is read as though it had fields.",
        verdict: "structurally-impossible",
        evidence:
            "route.ts rejects any body that is not a non-array object before a property is read; typeof/null/Array checks precede all use.",
    },
    {
        seam: "Browser receipts → ACR request",
        discard: "A malformed receipt is dropped and the re-ask runs without the chosen subject.",
        verdict: "structurally-impossible",
        evidence:
            "parseReceipts throws on the first malformed entry and the route returns acr_rejected_request; there is no filtering path that can produce a partial list.",
    },
    {
        seam: "Receipt list → contract bound",
        discard: "Receipts past maxItems are silently truncated by ACR.",
        verdict: "structurally-impossible",
        evidence:
            "buildInvestigationRequest dedupes and slices to the contract's 20 before sending, and the request is schema-validated; over-length never reaches the wire.",
    },
    {
        seam: "ACR response → result",
        discard: "A payload that violates the contract is rendered as an answer.",
        verdict: "structurally-impossible",
        evidence:
            "The client schema-validates every 200 against the pinned schema and raises acr_contract_violation; no unvalidated payload reaches the UI.",
    },
    {
        seam: "ACR error → failure surface",
        discard: "A failure class is misfiled, or upstream prose is substituted for our own.",
        verdict: "structurally-impossible",
        evidence:
            "UpstreamError has no `message` field at all, so upstream text cannot be carried; each status maps to a distinct code (rate-limited, timeout, engine-failed, rejected) rather than a catch-all.",
    },
    {
        seam: "ACR receipt handling → result",
        discard:
            "ACR discards a clarification receipt and answers about something else, or asks again.",
        verdict: "detected-and-surfaced",
        evidence:
            "choiceDisposition compares the chosen subject against committed by canonical id; ChoiceNotice renders in BOTH the answered and second-clarification shapes. Detection only — no retry.",
    },
    {
        seam: "Composition → enriched render",
        discard: "An invalid node is dropped and the rest renders as a complete answer.",
        verdict: "structurally-impossible",
        evidence:
            "The whole composition is validated before the renderer mounts; excess-args is fatal rather than a warning; unknown components, unresolved refs, and computed props all fail closed.",
    },
    {
        seam: "Enriched render → fallback",
        discard: "A stale failure latches, so later valid results never render enriched.",
        verdict: "structurally-impossible",
        evidence:
            "The runtime failure is keyed to result_id + composition (renderFailureFor); a new result cannot read a previous result's failure. Pinned by a pure test after mutation showed a component-level test was vacuous.",
    },
    {
        seam: "Renderer runtime error → fallback",
        discard: "A component that throws mid-render leaves a half-drawn answer on screen.",
        verdict: "structurally-impossible",
        evidence:
            "RuntimeFallback.test.tsx registers a throwing component in a TEST-SCOPE library (asserted absent from the production registry) so a VALID composition mounts and throws; the fallback engages and no React update-during-render warning is emitted, pinning that OpenUI calls onError from componentDidCatch. No PRODUCTION component can throw today — the validator pre-empts every input that would cause it — so this is defense in depth whose mechanism is now covered rather than assumed.",
    },
    {
        seam: "Clarification → enrichment path",
        discard: "A clarification renders as an empty answer with no way to re-ask.",
        verdict: "structurally-impossible",
        evidence:
            "EnrichmentView returns the deterministic clarification panel for clarification_required before any enrichment work; the enriched branch is unreachable for that status.",
    },
    {
        seam: "Result → telemetry",
        discard: "A failure aggregates as an answer with zero findings.",
        verdict: "structurally-impossible",
        evidence:
            "outcome is derived independently of the counts, so failed and empty-but-answered never collapse; clarificationChoiceHonoured is undefined vs false for the same reason.",
    },
    {
        seam: "Fixtures → product code",
        discard: "A fixture is rendered as though it were a real answer.",
        verdict: "structurally-impossible",
        evidence:
            "An ESLint no-restricted-imports rule bars @/test/** from src/app, src/components and src/lib; verified to fire on a non-test file.",
    },
    {
        seam: "ACR receipt disposition → wire",
        discard:
            "ACR gives no per-receipt applied/skipped signal, so the REASON a choice was dropped is unknowable to the Workbench.",
        verdict: "accepted-gap",
        evidence:
            "CHAOS-3813 (filed, acr-side, evidence quoted from engine.go:417-427). The Workbench detects the outcome but cannot report the cause. Our detection is kept after 3813 lands — defense in depth on a measurement instrument, NOT dead code.",
    },
    {
        seam: "ACR stage timing → latency attribution",
        discard:
            "Only total latency is observable; a slow stage cannot be distinguished from a slow model.",
        verdict: "accepted-gap",
        evidence:
            "The spec asks for ACR stage latency; ACR exposes none on the wire. Recorded as total only, and honestly labelled as such rather than apportioned by guess.",
    },
    {
        seam: "Model-authored composition → manifest",
        discard: "A model omits a section the manifest does not mark mandatory.",
        verdict: "structurally-impossible",
        evidence:
            "THE SEAM DOES NOT EXIST YET: the only producer of a composition is buildComposition, which always emits every section the result supports. No model-authoring path is wired. PRECONDITION, recorded deliberately: the moment a model authors compositions this row must be re-verdicted, because only Coverage and Limitations are mandatory and a model omitting drivers would render a thinner answer without failing closed. Re-verdict it in the same change that introduces model authoring, not afterwards.",
    },
];

describe("silent-discard class closure — the enumeration", () => {
    it("has a verdict and evidence for every seam", () => {
        for (const seam of SILENT_DISCARD_SEAMS) {
            expect(seam.evidence.length, seam.seam).toBeGreaterThan(40);
        }
    });

    /**
     * The anti-vacuity check. A table of all-(a) rows would be the same
     * fails-toward-fine shape this closure exists to close, so the honest
     * expectation is that gaps exist and are named.
     */
    /**
     * The EXACT expected gap set, not "some gap, generic match".
     *
     * This artifact drifted once already — it carried a different seam count
     * and gap count from the report and the README, and three numbers in three
     * places was itself a finding. An exact assertion makes the next drift fail
     * loudly instead of being discovered by a reviewer counting rows.
     */
    it("has exactly the expected accepted gaps, by name", () => {
        const gaps = SILENT_DISCARD_SEAMS.filter((seam) => seam.verdict === "accepted-gap").map(
            (seam) => seam.seam,
        );
        expect(gaps).toEqual([
            "ACR receipt disposition → wire",
            "ACR stage timing → latency attribution",
        ]);
    });

    it("keeps the gap list non-empty, and every gap owned", () => {
        const gaps = SILENT_DISCARD_SEAMS.filter((seam) => seam.verdict === "accepted-gap");
        // A table whose every row read "impossible" would be the very shape
        // this closure exists to close.
        expect(gaps.length).toBeGreaterThan(0);
        for (const gap of gaps) {
            expect(gap.evidence, gap.seam).toMatch(/CHAOS-\d+|exposes none/u);
        }
    });

    it("pins the seam count, so an added or dropped row is deliberate", () => {
        expect(SILENT_DISCARD_SEAMS).toHaveLength(15);
    });
});

describe("silent-discard class closure — the mechanically checkable rows", () => {
    it("a non-object body cannot be read as though it had fields", async () => {
        const response = await POST(
            new Request("http://workbench.test/api/investigations", {
                method: "POST",
                body: "null",
            }),
        );
        expect(response.status).toBe(400);
    });

    it("a contract-violating payload cannot be mistaken for a result", () => {
        const tainted = structuredClone(result) as unknown as Record<string, unknown>;
        delete tainted["coverage"];
        expect(
            validateContract("context_fabric_investigation_result.v1.schema.json", tainted).valid,
        ).toBe(false);
    });

    it("a partially-invalid composition cannot render partially", () => {
        const partial = `root = Answer("@result.deterministic_answer", [good, bad, cov, lim])
good = Prose("@result.direct_judgment")
bad = Prose("a literal")
cov = Coverage("@result.coverage.partial", [])
lim = Limitations([])`;
        expect(validateEnrichment(partial, result, PRESENTATION_MANIFEST_V1).ok).toBe(false);
    });

    it("a dishonoured choice is always classified, never silently normal", () => {
        const chosen = clarification.subject_resolution.candidates[0]!.subject;
        // Both shapes report applied:false — an answer about another subject,
        // and a second clarification.
        expect(choiceDisposition(clarification, chosen)).toEqual({
            applied: false,
            answered: false,
        });
        expect(choiceDisposition(result, chosen)).toEqual({ applied: false, answered: true });
    });

    it("a builder-generated composition never silently loses a mandatory section", () => {
        for (const scenario of mockScenarios()) {
            const composition = buildComposition(scenario.result, PRESENTATION_MANIFEST_V1);
            expect(composition, scenario.id).toContain("Coverage(");
            expect(composition, scenario.id).toContain("Limitations(");
        }
    });
});
