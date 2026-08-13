import { describe, expect, it } from "vitest";

import investigationResultSchema from "@/contracts/schemas/context_fabric_common.v1.schema.json";
import type { CoverageState, SubjectCandidateState } from "@/lib/contracts";
import { candidateStateTone, coverageStateTone, formatConfidence } from "@/lib/presentation";

/**
 * The tone maps must stay exhaustive over the CONTRACT's vocabulary, not over
 * whatever subset the fixtures happen to use. These read the enums straight out
 * of the pinned schema, so a pin bump that adds a state fails here instead of
 * silently rendering `undefined` in the UI.
 */
const schemaDefs = investigationResultSchema.$defs as unknown as Record<
    string,
    { properties: Record<string, { enum?: string[] }> }
>;

describe("presentation tone maps", () => {
    it("covers every coverage state the contract declares", () => {
        const states = schemaDefs["SourceObservation"]!.properties["state"]!.enum;
        expect(states).toBeDefined();
        for (const state of states!) {
            expect(coverageStateTone(state as CoverageState)).toBeTypeOf("string");
        }
    });

    it("covers every subject-candidate state the contract declares", () => {
        const states = schemaDefs["SubjectCandidate"]!.properties["state"]!.enum;
        expect(states).toBeDefined();
        for (const state of states!) {
            expect(candidateStateTone(state as SubjectCandidateState)).toBeTypeOf("string");
        }
    });

    it("formats contract confidence as a percentage", () => {
        expect(formatConfidence(1)).toBe("100%");
        expect(formatConfidence(0.96)).toBe("96%");
        expect(formatConfidence(0)).toBe("0%");
    });
});
