import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useCandidateSelections } from "@/lib/use-candidate-selections";

describe("useCandidateSelections (CHAOS-4343 items 1/2)", () => {
    it("starts empty", () => {
        const { result } = renderHook(() => useCandidateSelections());

        expect(result.current.batch.size).toBe(0);
        expect(result.current.pendingSelectionEvents).toEqual([]);
    });

    it("toggle() selects a candidate, and a repeat toggle withdraws it", () => {
        const { result } = renderHook(() => useCandidateSelections());

        act(() => {
            result.current.toggle("receipt_a");
        });
        expect(result.current.batch.has("receipt_a")).toBe(true);

        act(() => {
            result.current.toggle("receipt_a");
        });
        expect(result.current.batch.has("receipt_a")).toBe(false);
    });

    it("toggle() accumulates several distinct selections", () => {
        const { result } = renderHook(() => useCandidateSelections());

        act(() => {
            result.current.toggle("receipt_a");
            result.current.toggle("receipt_b");
        });

        expect(result.current.batch.has("receipt_a")).toBe(true);
        expect(result.current.batch.has("receipt_b")).toBe(true);
        expect(result.current.batch.size).toBe(2);
    });

    it("reset() clears every selection", () => {
        const { result } = renderHook(() => useCandidateSelections());

        act(() => {
            result.current.toggle("receipt_a");
        });
        expect(result.current.batch.size).toBeGreaterThan(0);

        act(() => {
            result.current.reset();
        });
        expect(result.current.batch.size).toBe(0);
    });

    /**
     * `subject_candidate` is already one of the five `StructureNeedKind`
     * members (CHAOS-4012), so this reuses the same telemetry pipe
     * `useStructureSelections` uses — CHAOS-4171 standing order: telemetry
     * baked into new logic, same PR.
     */
    describe("pendingSelectionEvents", () => {
        it("toggle() queues a submitted outcome for subject_candidate", () => {
            const { result } = renderHook(() => useCandidateSelections());

            act(() => {
                result.current.toggle("receipt_a");
            });

            expect(result.current.pendingSelectionEvents).toEqual([
                { member: "subject_candidate", outcome: "submitted" },
            ]);
        });

        it("queues one event per toggle, including a deselecting one", () => {
            const { result } = renderHook(() => useCandidateSelections());

            act(() => {
                result.current.toggle("receipt_a");
                result.current.toggle("receipt_a");
            });

            expect(result.current.pendingSelectionEvents).toEqual([
                { member: "subject_candidate", outcome: "submitted" },
                { member: "subject_candidate", outcome: "submitted" },
            ]);
        });

        it("reset() clears queued selection events alongside the batch", () => {
            const { result } = renderHook(() => useCandidateSelections());

            act(() => {
                result.current.toggle("receipt_a");
            });
            expect(result.current.pendingSelectionEvents).not.toEqual([]);

            act(() => {
                result.current.reset();
            });
            expect(result.current.pendingSelectionEvents).toEqual([]);
        });
    });
});
