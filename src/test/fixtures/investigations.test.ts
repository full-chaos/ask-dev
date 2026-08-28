import { describe, expect, it } from "vitest";

import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import { mockScenarios, resolveMockScenario } from "@/test/fixtures/investigations";
import { validateContract } from "@/lib/acr/validate";

const RESULT_SCHEMA = "context_fabric_investigation_result.v1.schema.json";

describe("mock investigation fixtures", () => {
    it("round-trips every scenario against the pinned investigation-result schema", () => {
        for (const scenario of mockScenarios()) {
            const validation = validateContract(RESULT_SCHEMA, scenario.result);
            expect(validation.valid, `${scenario.id}: ${validation.errors.join("; ")}`).toBe(true);
        }
    });

    it("covers every status the renderer has to draw", () => {
        expect(mockScenarios().map((scenario) => scenario.result.status)).toEqual([
            "complete",
            // CHAOS-4355: "rows" is a second `complete` scenario — it exists
            // to carry `ClaimedFact.rows`, not to add a new status.
            "complete",
            // CHAOS-4364: "flow-landscape" is a third `complete` scenario — it
            // exists to carry the flow/landscape FactKinds and a `carried`
            // confirmed_structure source, not a new status either.
            "complete",
            "degraded",
            "clarification_required",
            "no_match",
        ]);
    });

    it("exercises the pruned coverage state and a partial-coverage result", () => {
        const states = mockScenarios().flatMap((scenario) =>
            scenario.result.coverage.sources.map((source) => source.state),
        );
        expect(states).toContain("pruned");
        expect(states).toContain("stale");
        expect(states).toContain("unauthorized");
        expect(states).toContain("truncated");
        expect(mockScenarios().some((scenario) => scenario.result.coverage.partial)).toBe(true);
    });

    it("answers the question it claims to answer", () => {
        // A scenario cloned from the canonical example keeps the canonical
        // answer unless every prose field is overridden too. That mismatch
        // renders as an answer to a question nobody asked, and it is invisible
        // to schema validation, so it is asserted here.
        for (const scenario of mockScenarios()) {
            expect(scenario.result.question, scenario.id).toBe(scenario.question);
            if (scenario.id === "complete") continue;
            expect(scenario.result.deterministic_answer, scenario.id).not.toBe(
                canonicalResult.deterministic_answer,
            );
            expect(scenario.result.direct_judgment, scenario.id).not.toBe(
                canonicalResult.direct_judgment,
            );
        }
    });

    it("keeps the canonical example byte-identical to the pinned copy", () => {
        const complete = mockScenarios().find((scenario) => scenario.id === "complete");
        expect(complete?.result).toEqual(canonicalResult);
    });

    it("routes an unknown question to the canonical scenario", () => {
        expect(resolveMockScenario("something nobody asked").id).toBe("complete");
        expect(resolveMockScenario("Is Atlas on track?").id).toBe("clarification");
    });
});

describe("schema validation negative controls", () => {
    // The red half of red->green. If the validator ever stops rejecting these,
    // the round-trip test above proves nothing.

    it("rejects a coverage state outside the contract's closed vocabulary", () => {
        // `retrieval_degraded` reads like a coverage state but appears nowhere
        // in the ACR contracts or service. The contract expresses that concept
        // as `coverage.partial` plus `degraded_reasons`, which the "degraded"
        // scenario uses. This control keeps the invented term out.
        const tainted = structuredClone(canonicalResult) as unknown as Record<string, unknown>;
        const coverage = tainted["coverage"] as { sources: { state: string }[] };
        coverage.sources[0]!.state = "retrieval_degraded";

        const validation = validateContract(RESULT_SCHEMA, tainted);
        expect(validation.valid).toBe(false);
        expect(validation.errors.join("; ")).toContain("/coverage/sources/0/state");
    });

    it("rejects a result that drops a required field", () => {
        const tainted = structuredClone(canonicalResult) as unknown as Record<string, unknown>;
        delete tainted["reused"];

        const validation = validateContract(RESULT_SCHEMA, tainted);
        expect(validation.valid).toBe(false);
        expect(validation.errors.join("; ")).toContain("reused");
    });

    it("rejects a subject-candidate state outside the contract's closed vocabulary", () => {
        const tainted = structuredClone(canonicalResult) as unknown as Record<string, unknown>;
        const resolution = tainted["subject_resolution"] as { candidates: { state: string }[] };
        resolution.candidates[0]!.state = "probably";

        const validation = validateContract(RESULT_SCHEMA, tainted);
        expect(validation.valid).toBe(false);
        expect(validation.errors.join("; ")).toContain("/subject_resolution/candidates/0/state");
    });
});
