"use client";

import { useCallback, useState } from "react";

import type { ConfirmedStructureEntry, StructureNeedKind } from "@/lib/contracts";
import {
    applyCarryUpdate,
    deriveCarryUpdate,
    dropCarriedMember,
    EMPTY_STRUCTURE_CARRY,
    type StructureCarryMap,
} from "@/lib/structure-carry";

export type UseStructureCarryResult = {
    readonly carry: StructureCarryMap;
    /** Folds one answered turn's `confirmed_structure` echo into the running carry. */
    readonly recordFromResult: (
        entries: readonly ConfirmedStructureEntry[] | undefined,
        turn: number,
    ) => void;
    /** An explicit deselect for `member` — stops it riding along on the next re-ask. */
    readonly dropMember: (member: StructureNeedKind) => void;
    /** A fresh question starts: nothing from the old conversation should carry forward. */
    readonly reset: () => void;
};

/**
 * Conversation-scoped counterpart to `useStructureSelections` (CHAOS-4355
 * stopgap). Where that hook's `batch` is single-turn (reset on every
 * ask/confirm), this hook's `carry` survives across turns on purpose — see
 * `structure-carry.ts`'s own header for why that gap is the defect.
 *
 * One instance per `ChatPage`, reset only when a brand-new plain question is
 * asked (never on a receipt-carrying re-ask, which is exactly the case this
 * hook exists to keep alive).
 */
export function useStructureCarry(): UseStructureCarryResult {
    const [carry, setCarry] = useState<StructureCarryMap>(EMPTY_STRUCTURE_CARRY);

    const recordFromResult = useCallback(
        (entries: readonly ConfirmedStructureEntry[] | undefined, turn: number) => {
            setCarry((current) => applyCarryUpdate(current, deriveCarryUpdate(entries, turn)));
        },
        [],
    );

    const dropMember = useCallback((member: StructureNeedKind) => {
        setCarry((current) => dropCarriedMember(current, member));
    }, []);

    const reset = useCallback(() => setCarry(EMPTY_STRUCTURE_CARRY), []);

    return { carry, recordFromResult, dropMember, reset };
}
