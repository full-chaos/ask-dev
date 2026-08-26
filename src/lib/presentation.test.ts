import { describe, expect, it } from "vitest";

import investigationResultSchema from "@/contracts/schemas/context_fabric_common.v1.schema.json";
import type {
    CoverageState,
    PriorSubjectReceiptDisposition,
    SubjectCandidateState,
} from "@/lib/contracts";
import {
    candidateStateTone,
    coverageStateTone,
    formatConfidence,
    priorSubjectReceiptDispositionTone,
} from "@/lib/presentation";

/**
 * The tone maps must stay exhaustive over the CONTRACT's vocabulary, not over
 * whatever subset the fixtures happen to use. These read the enums straight out
 * of the pinned schema, so a pin bump that adds a state fails here instead of
 * silently rendering `undefined` in the UI.
 */
const schemaDefs = investigationResultSchema.$defs as unknown as Record<
    string,
    { properties: Record<string, { enum?: string[] }>; enum?: string[] }
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

    /** CHAOS-3478/CHAOS-3813 (acr PR #265, e946ad90). */
    it("covers every prior-subject-receipt disposition the contract declares", () => {
        const dispositions = schemaDefs["PriorSubjectReceiptDisposition"]!.enum;
        expect(dispositions).toBeDefined();
        for (const disposition of dispositions!) {
            expect(
                priorSubjectReceiptDispositionTone(disposition as PriorSubjectReceiptDisposition),
            ).toBeTypeOf("string");
        }
    });

    /**
     * codex finding (chaos4171pr3-codex-r1): the exhaustiveness check above
     * only proves every value returns SOME string — a regression mapping
     * `skipped_failed_reauth` to `bad`, say, would still pass it. This pins
     * the actual mapping: a skip here never vetoes the investigation (it is
     * a best-effort, plural hint list, not a gate — see the schema's own
     * `PriorSubjectReceiptDisposition` doc comment), so every `skipped_*`
     * reads as `warn`, never `bad`.
     */
    it("maps every prior-subject-receipt disposition to its exact tone", () => {
        expect(priorSubjectReceiptDispositionTone("applied")).toBe("ok");
        expect(priorSubjectReceiptDispositionTone("skipped_unloadable")).toBe("warn");
        expect(priorSubjectReceiptDispositionTone("skipped_no_match")).toBe("warn");
        expect(priorSubjectReceiptDispositionTone("skipped_stale_graph_epoch")).toBe("warn");
        expect(priorSubjectReceiptDispositionTone("skipped_failed_reauth")).toBe("warn");
    });

    it("formats contract confidence as a percentage", () => {
        expect(formatConfidence(1)).toBe("100%");
        expect(formatConfidence(0.96)).toBe("96%");
        expect(formatConfidence(0)).toBe("0%");
    });
});
