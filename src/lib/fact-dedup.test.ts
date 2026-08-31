import { describe, expect, it } from "vitest";

import type { Finding } from "@/lib/contracts";
import { dedupeFindings, identityLimitations } from "@/lib/fact-dedup";

function finding(overrides: Partial<Finding> & Pick<Finding, "finding_id" | "summary">): Finding {
    return {
        kind: "readiness",
        evidence_ref_ids: ["evidence_0001"],
        ...overrides,
    };
}

/**
 * CHAOS-4669 defect 1: chris's UX notes named the readiness-gap fact
 * rendering near-verbatim in the Remaining Work card, the Readiness Gaps
 * card, AND the Limitations list. This pins the exact scenario: one fact,
 * three cards, one primary rendering.
 */
describe("dedupeFindings: CHAOS-4669 defect 1 (one fact, one primary rendering)", () => {
    it("keeps a fact's full rendering on readiness_gaps and turns the SAME fact in remaining_work into a reference", () => {
        const readinessGap = finding({
            finding_id: "finding_readiness_gap",
            summary: "Release acceptance remains incomplete.",
        });
        const sameFactInRemainingWork = finding({
            finding_id: "finding_remaining_work_dup",
            summary: "Release acceptance remains incomplete.",
        });
        const result = dedupeFindings({
            remaining_work: [sameFactInRemainingWork],
            readiness_gaps: [readinessGap],
            conflicts: [],
            limitations: [],
        });

        expect(result.readiness_gaps).toHaveLength(1);
        expect(result.readiness_gaps[0]!.isDuplicate).toBe(false);
        expect(result.readiness_gaps[0]!.primarySurface).toBe("readiness_gaps");

        expect(result.remaining_work).toHaveLength(1);
        expect(result.remaining_work[0]!.isDuplicate).toBe(true);
        expect(result.remaining_work[0]!.primarySurface).toBe("readiness_gaps");
    });

    it("matches near-verbatim text (whitespace/case-insensitive), not just byte-identical", () => {
        const readinessGap = finding({
            finding_id: "finding_a",
            summary: "Release acceptance remains incomplete.",
        });
        const nearVerbatim = finding({
            finding_id: "finding_b",
            summary: "  release acceptance   remains incomplete.  ",
        });
        const result = dedupeFindings({
            remaining_work: [nearVerbatim],
            readiness_gaps: [readinessGap],
            conflicts: [],
            limitations: [],
        });
        expect(result.remaining_work[0]!.isDuplicate).toBe(true);
    });

    it("matches on shared claimed_fact_ids even when the wording differs", () => {
        const readinessGap = finding({
            finding_id: "finding_a",
            summary: "Release acceptance remains incomplete.",
            claimed_fact_ids: ["claim_readiness_0001"],
        });
        const differentWordingSameFact = finding({
            finding_id: "finding_b",
            summary: "The product acceptance gate has not passed yet.",
            claimed_fact_ids: ["claim_readiness_0001"],
        });
        const result = dedupeFindings({
            remaining_work: [differentWordingSameFact],
            readiness_gaps: [readinessGap],
            conflicts: [],
            limitations: [],
        });
        expect(result.remaining_work[0]!.isDuplicate).toBe(true);
        expect(result.remaining_work[0]!.primarySurface).toBe("readiness_gaps");
    });

    it("collapses the SAME fact in the Limitations list too — the ticket's own 3-surface scenario", () => {
        const readinessGap = finding({
            finding_id: "finding_readiness_gap",
            summary: "Release acceptance remains incomplete.",
        });
        const result = dedupeFindings({
            remaining_work: [],
            readiness_gaps: [readinessGap],
            conflicts: [],
            limitations: ["Release acceptance remains incomplete."],
        });
        expect(result.readiness_gaps[0]!.isDuplicate).toBe(false);
        expect(result.limitations[0]!.isDuplicate).toBe(true);
        expect(result.limitations[0]!.primarySurface).toBe("readiness_gaps");
    });

    it("does NOT collapse two genuinely different findings", () => {
        const a = finding({
            finding_id: "finding_a",
            summary: "Release acceptance is incomplete.",
        });
        const b = finding({
            finding_id: "finding_b",
            summary: "CI pipeline success rate dropped.",
        });
        const result = dedupeFindings({
            remaining_work: [a],
            readiness_gaps: [b],
            conflicts: [],
            limitations: [],
        });
        expect(result.remaining_work[0]!.isDuplicate).toBe(false);
        expect(result.readiness_gaps[0]!.isDuplicate).toBe(false);
    });

    it("every fact still appears SOMEWHERE — nothing is silently dropped from the returned arrays", () => {
        const a = finding({ finding_id: "finding_a", summary: "Same fact." });
        const b = finding({ finding_id: "finding_b", summary: "Same fact." });
        const c = finding({ finding_id: "finding_c", summary: "Same fact." });
        const result = dedupeFindings({
            remaining_work: [a],
            readiness_gaps: [b],
            conflicts: [c],
            limitations: ["Same fact."],
        });
        expect(result.remaining_work).toHaveLength(1);
        expect(result.readiness_gaps).toHaveLength(1);
        expect(result.conflicts).toHaveLength(1);
        expect(result.limitations).toHaveLength(1);
        // Exactly one primary among the four.
        const flags = [
            result.remaining_work[0]!.isDuplicate,
            result.readiness_gaps[0]!.isDuplicate,
            result.conflicts[0]!.isDuplicate,
            result.limitations[0]!.isDuplicate,
        ];
        expect(flags.filter((isDuplicate) => !isDuplicate)).toHaveLength(1);
        // readiness_gaps outranks remaining_work/conflicts/limitations.
        expect(result.readiness_gaps[0]!.isDuplicate).toBe(false);
    });

    it("conflicts outranks limitations when both carry the same fact and no Finding list ranks higher", () => {
        const c = finding({ finding_id: "finding_c", summary: "Same fact." });
        const result = dedupeFindings({
            remaining_work: [],
            readiness_gaps: [],
            conflicts: [c],
            limitations: ["Same fact."],
        });
        expect(result.conflicts[0]!.isDuplicate).toBe(false);
        expect(result.limitations[0]!.isDuplicate).toBe(true);
        expect(result.limitations[0]!.primarySurface).toBe("conflicts");
    });
});

describe("identityLimitations: no cross-surface dedup context (clarification branch)", () => {
    it("marks every limitation as its own primary", () => {
        const result = identityLimitations(["a", "b"]);
        expect(result).toEqual([
            { text: "a", isDuplicate: false, primarySurface: "limitations" },
            { text: "b", isDuplicate: false, primarySurface: "limitations" },
        ]);
    });
});
