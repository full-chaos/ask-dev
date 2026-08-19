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
});
