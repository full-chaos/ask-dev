import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ConfirmedStructureEntry } from "@/lib/contracts";
import { useStructureCarry } from "@/lib/use-structure-carry";

const WINDOW_ENTRY: ConfirmedStructureEntry = {
    member: "window",
    applied_value: "trailing_30d",
    source: "receipt",
    prior_result_id: "result_turn2_0001",
    receipt_id: "winr_trailing_30d_0001",
    offer_source: "engine",
    provenance: "clarification_confirmed",
    disposition: "applied",
};

describe("useStructureCarry (CHAOS-4355 stopgap)", () => {
    it("starts empty", () => {
        const { result } = renderHook(() => useStructureCarry());
        expect(result.current.carry).toEqual({});
    });

    it("recordFromResult() carries an applied receipt entry forward", () => {
        const { result } = renderHook(() => useStructureCarry());

        act(() => {
            result.current.recordFromResult([WINDOW_ENTRY], 2);
        });

        expect(result.current.carry.window).toEqual({
            member: "window",
            receipt: { result_id: "result_turn2_0001", receipt_id: "winr_trailing_30d_0001" },
            turn: 2,
        });
    });

    it("a later recordFromResult() that says nothing about a member leaves it carried", () => {
        const { result } = renderHook(() => useStructureCarry());

        act(() => {
            result.current.recordFromResult([WINDOW_ENTRY], 2);
        });
        act(() => {
            result.current.recordFromResult([], 3);
        });

        expect(result.current.carry.window).toBeDefined();
    });

    it("dropMember() clears one member without a fresh confirmed_structure echo", () => {
        const { result } = renderHook(() => useStructureCarry());

        act(() => {
            result.current.recordFromResult([WINDOW_ENTRY], 2);
        });
        act(() => {
            result.current.dropMember("window");
        });

        expect(result.current.carry.window).toBeUndefined();
    });

    it("reset() clears the whole carry — a fresh question starts clean", () => {
        const { result } = renderHook(() => useStructureCarry());

        act(() => {
            result.current.recordFromResult([WINDOW_ENTRY], 2);
        });
        act(() => {
            result.current.reset();
        });

        expect(result.current.carry).toEqual({});
    });
});
