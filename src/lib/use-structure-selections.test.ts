import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useStructureSelections } from "@/lib/use-structure-selections";

const KIND_RECEIPT = {
    result_id: "result_0000000000000001",
    receipt_id: "kindr_pull_request_0001",
};

describe("useStructureSelections", () => {
    it("starts empty", () => {
        const { result } = renderHook(() => useStructureSelections());
        expect(result.current.batch).toEqual({});
    });

    it("toggle() records a pick, and a repeat toggle withdraws it", () => {
        const { result } = renderHook(() => useStructureSelections());

        act(() => {
            result.current.toggle("expected_kind", KIND_RECEIPT);
        });
        expect(result.current.batch).toEqual({ expected_kind: KIND_RECEIPT });

        act(() => {
            result.current.toggle("expected_kind", KIND_RECEIPT);
        });
        expect(result.current.batch).toEqual({});
    });

    it("reset() clears every member's pick", () => {
        const { result } = renderHook(() => useStructureSelections());

        act(() => {
            result.current.toggle("expected_kind", KIND_RECEIPT);
        });
        expect(result.current.batch).not.toEqual({});

        act(() => {
            result.current.reset();
        });
        expect(result.current.batch).toEqual({});
    });

    describe("pendingSelectionEvents (CHAOS-4171 standing order)", () => {
        it("starts empty", () => {
            const { result } = renderHook(() => useStructureSelections());
            expect(result.current.pendingSelectionEvents).toEqual([]);
        });

        it("toggle() queues a submitted outcome, matching the same call that updates the batch", () => {
            const { result } = renderHook(() => useStructureSelections());

            act(() => {
                result.current.toggle("expected_kind", KIND_RECEIPT);
            });

            expect(result.current.pendingSelectionEvents).toEqual([
                { member: "expected_kind", outcome: "submitted" },
            ]);
        });

        /**
         * `toggle()` deselects on a repeat click of the same offer (its own
         * doc comment). This hook does not distinguish select from deselect
         * in the outcome it queues — matching the panel's own pre-existing
         * behavior (it called `onToggle` unconditionally on every
         * namespace-valid click before this change), not a new semantic.
         */
        it("a deselecting toggle() still queues a submitted outcome", () => {
            const { result } = renderHook(() => useStructureSelections());

            act(() => {
                result.current.toggle("expected_kind", KIND_RECEIPT);
                result.current.toggle("expected_kind", KIND_RECEIPT);
            });

            expect(result.current.pendingSelectionEvents).toEqual([
                { member: "expected_kind", outcome: "submitted" },
                { member: "expected_kind", outcome: "submitted" },
            ]);
        });

        it("reject() queues a rejected_malformed outcome without touching the batch", () => {
            const { result } = renderHook(() => useStructureSelections());

            act(() => {
                result.current.reject("expected_kind");
            });

            expect(result.current.pendingSelectionEvents).toEqual([
                { member: "expected_kind", outcome: "rejected_malformed" },
            ]);
            expect(result.current.batch).toEqual({});
        });

        it("reset() clears queued selection events alongside the batch", () => {
            const { result } = renderHook(() => useStructureSelections());

            act(() => {
                result.current.toggle("expected_kind", KIND_RECEIPT);
                result.current.reject("subject_anchor");
            });
            expect(result.current.pendingSelectionEvents).not.toEqual([]);

            act(() => {
                result.current.reset();
            });
            expect(result.current.pendingSelectionEvents).toEqual([]);
        });
    });
});
