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
    nonBlank,
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

/**
 * codex round 3, P2, EXECUTED: `String.prototype.trim()` strips ASCII/
 * Unicode WHITESPACE, but NOT zero-width format characters (U+200B ZERO
 * WIDTH SPACE, U+200C/U+200D joiners, U+FEFF BOM/ZERO WIDTH NO-BREAK
 * SPACE, U+2060 WORD JOINER) — those satisfy a wire field's `minLength: 1`
 * while rendering as nothing at all. A schema-valid label consisting of
 * only U+200B passed the old `.trim() !== ""` check as "present" and
 * would have rendered an invisible chip/sentence/evidence item instead of
 * falling to the generic floor.
 */
describe("nonBlank", () => {
    it("treats a defined, visibly non-empty string as present", () => {
        expect(nonBlank("Team: CHAOS")).toBe("Team: CHAOS");
    });

    it("treats undefined as absent", () => {
        expect(nonBlank(undefined)).toBeUndefined();
    });

    it("treats an empty string as absent", () => {
        expect(nonBlank("")).toBeUndefined();
    });

    it("treats ASCII/Unicode whitespace-only strings as absent", () => {
        expect(nonBlank(" ")).toBeUndefined();
        expect(nonBlank("\t\n  ")).toBeUndefined();
    });

    it("treats a string of ONLY zero-width/format characters as absent", () => {
        expect(nonBlank("\u200B")).toBeUndefined();
        expect(nonBlank("\u200C\u200D")).toBeUndefined();
        expect(nonBlank("\uFEFF")).toBeUndefined();
        expect(nonBlank("\u2060")).toBeUndefined();
        expect(nonBlank(" \u200B \uFEFF ")).toBeUndefined();
    });

    it("still returns the ORIGINAL string (not stripped) when it has real visible content alongside zero-width characters", () => {
        const withZeroWidth = "Team\u200B: CHAOS";
        expect(nonBlank(withZeroWidth)).toBe(withZeroWidth);
    });
});
