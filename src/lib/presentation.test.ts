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
 * Team-lead ruling (round 3 close-out): codex kept re-finding cells of ONE
 * class -- "blank-ish content bypasses the fallback guard" -- because each
 * round's fix patched the specific cell it was shown (ASCII space, then
 * zero-width Unicode) rather than sweeping the class. `nonBlank` now
 * routes every category through a single normative predicate
 * (`INVISIBLE_CONTENT`, `@/lib/presentation`'s own doc comment on it); this
 * table is that sweep's proof -- EVERY Unicode character category the
 * predicate claims to cover, exhaustively, each as its own row so a
 * regression in any one category shows up as a named failure, not a
 * vanished assertion buried in a combined string.
 */
describe("nonBlank", () => {
    it("treats a defined, visibly non-empty string as present", () => {
        expect(nonBlank("Team: CHAOS")).toBe("Team: CHAOS");
    });

    it("treats undefined as absent", () => {
        expect(nonBlank(undefined)).toBeUndefined();
    });

    describe.each([
        ["empty string", ""],
        ["a single ASCII space", " "],
        ["ASCII tab/newline/carriage-return", "\t\n\r  "],
        ["Unicode Zs: NO-BREAK SPACE (U+00A0)", "\u00A0"],
        ["Unicode Zs: EN SPACE (U+2002)", "\u2002"],
        ["Unicode Zs: EM SPACE (U+2003)", "\u2003"],
        ["Unicode Zs: THIN SPACE (U+2009)", "\u2009"],
        ["Unicode Zs: IDEOGRAPHIC SPACE (U+3000)", "\u3000"],
        ["Unicode Zs: OGHAM SPACE MARK (U+1680)", "\u1680"],
        ["Unicode Zl: LINE SEPARATOR (U+2028)", "\u2028"],
        ["Unicode Zp: PARAGRAPH SEPARATOR (U+2029)", "\u2029"],
        ["Unicode Cf: ZERO WIDTH SPACE (U+200B)", "\u200B"],
        ["Unicode Cf: ZERO WIDTH NON-JOINER + JOINER (U+200C U+200D)", "\u200C\u200D"],
        ["Unicode Cf: ZERO WIDTH NO-BREAK SPACE / BOM (U+FEFF)", "\uFEFF"],
        ["Unicode Cf: WORD JOINER (U+2060)", "\u2060"],
        ["Unicode Cf: LEFT-TO-RIGHT / RIGHT-TO-LEFT MARKS (U+200E U+200F)", "\u200E\u200F"],
        ["Unicode Cf: ARABIC LETTER MARK (U+061C)", "\u061C"],
        ["Unicode Cf: bidi embedding/pop (U+202A U+202C)", "\u202A\u202C"],
        ["Unicode Mn: bare COMBINING ACUTE ACCENT (U+0301)", "\u0301"],
        ["Unicode Mn: bare COMBINING GRAVE + DIAERESIS (U+0300 U+0308)", "\u0300\u0308"],
        [
            "a mix of every category above, still nothing visible",
            " \t\u00A0\u3000\u2028\u200B\uFEFF\u200E\u0301 ",
        ],
    ])("category: %s", (_label, sample) => {
        it("is treated as absent", () => {
            expect(nonBlank(sample)).toBeUndefined();
        });
    });

    it("still returns the ORIGINAL string (not stripped) when it has real visible content alongside invisible characters from every category", () => {
        const withInvisibleNoise = " \u00A0Team\u200B:\u0301 CHAOS\uFEFF ";
        expect(nonBlank(withInvisibleNoise)).toBe(withInvisibleNoise);
    });
});
