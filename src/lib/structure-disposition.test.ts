import { describe, expect, it } from "vitest";

import {
    hasVetoedStructureConfirmation,
    summarizeConfirmedStructure,
} from "@/lib/structure-disposition";
import { structureMockScenarios } from "@/test/fixtures/structure-needs";

const applied = structureMockScenarios().find((s) => s.id === "structure-applied")!.result
    .confirmed_structure!;
const vetoed = structureMockScenarios().find((s) => s.id === "structure-vetoed")!.result
    .confirmed_structure!;

describe("summarizeConfirmedStructure", () => {
    it("returns nothing for an undefined echo", () => {
        expect(summarizeConfirmedStructure(undefined)).toEqual([]);
    });

    it("preserves the result's own carried order (never re-sorts)", () => {
        const summaries = summarizeConfirmedStructure(vetoed);
        expect(summaries.map((summary) => summary.entry.member)).toEqual(
            vetoed.map((entry) => entry.member),
        );
    });

    it("marks every applied entry as applied and every vetoed entry as not", () => {
        expect(summarizeConfirmedStructure(applied).every((summary) => summary.applied)).toBe(true);
        const vetoedSummaries = summarizeConfirmedStructure(vetoed);
        expect(vetoedSummaries.some((summary) => !summary.applied)).toBe(true);
    });

    it("names the §2.5 veto reason class in the sentence, not a generic failure", () => {
        const staleEntry = vetoed.find((entry) => entry.disposition === "vetoed_stale")!;
        const summary = summarizeConfirmedStructure([staleEntry])[0]!;
        expect(summary.sentence).toMatch(/no longer current/);
        expect(summary.sentence).toMatch(/try again/i);
    });
});

describe("hasVetoedStructureConfirmation", () => {
    it("is false when every carried member applied", () => {
        expect(hasVetoedStructureConfirmation(applied)).toBe(false);
    });

    it("is true when any carried member was vetoed", () => {
        expect(hasVetoedStructureConfirmation(vetoed)).toBe(true);
    });

    it("is false for undefined (nothing carried)", () => {
        expect(hasVetoedStructureConfirmation(undefined)).toBe(false);
    });
});
