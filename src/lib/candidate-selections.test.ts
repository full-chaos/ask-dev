import { describe, expect, it } from "vitest";

import {
    candidateSelectionCount,
    EMPTY_CANDIDATE_SELECTION_BATCH,
    toggleCandidateSelection,
} from "@/lib/candidate-selections";

describe("toggleCandidateSelection (CHAOS-4343 items 1/2)", () => {
    it("selects a candidate not yet in the batch", () => {
        const batch = toggleCandidateSelection(EMPTY_CANDIDATE_SELECTION_BATCH, "receipt_a");

        expect(batch.has("receipt_a")).toBe(true);
        expect(candidateSelectionCount(batch)).toBe(1);
    });

    it("deselects a candidate already in the batch, on a repeat toggle", () => {
        const selected = toggleCandidateSelection(EMPTY_CANDIDATE_SELECTION_BATCH, "receipt_a");
        const deselected = toggleCandidateSelection(selected, "receipt_a");

        expect(deselected.has("receipt_a")).toBe(false);
        expect(candidateSelectionCount(deselected)).toBe(0);
    });

    it("accumulates several distinct selections without disturbing one another", () => {
        const batch = toggleCandidateSelection(
            toggleCandidateSelection(EMPTY_CANDIDATE_SELECTION_BATCH, "receipt_a"),
            "receipt_b",
        );

        expect(batch.has("receipt_a")).toBe(true);
        expect(batch.has("receipt_b")).toBe(true);
        expect(candidateSelectionCount(batch)).toBe(2);
    });

    it("does not mutate the batch passed in — pure reducer", () => {
        const before = toggleCandidateSelection(EMPTY_CANDIDATE_SELECTION_BATCH, "receipt_a");
        const beforeSize = before.size;

        toggleCandidateSelection(before, "receipt_b");

        expect(before.size).toBe(beforeSize);
        expect(before.has("receipt_b")).toBe(false);
    });
});
