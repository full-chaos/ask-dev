"use client";

import { useCallback, useState } from "react";

import type { BoundStructureReceipt, StructureNeedKind } from "@/lib/contracts";
import {
    EMPTY_STRUCTURE_SELECTION_BATCH,
    toggleStructureOffer,
    type StructureSelectionBatch,
} from "@/lib/structure-selections";

export type UseStructureSelectionsResult = {
    readonly batch: StructureSelectionBatch;
    readonly toggle: (member: StructureNeedKind, receipt: BoundStructureReceipt) => void;
    readonly reset: () => void;
};

/**
 * Portable accumulate-and-re-ask-ONCE selection state (CHAOS-3927 P2,
 * design brief §2.2).
 *
 * Composition discipline (team-lead): the eventual Ask Dev surface heads
 * toward a conversational (chat-turn) UI, and the current workbench shell
 * is explicitly temporary. So the state `StructureNeedsPanel` needs is
 * owned HERE, not inline in a page component — a caller mounting the panel
 * under a chat-message turn needs exactly this hook and nothing else: no
 * page-level `useState`, no positional/layout coupling.
 *
 * `batch` is meant to be shared across every simultaneous rendering of the
 * SAME offer set (today: the raw inspector view and the deterministic
 * view; tomorrow: however many surfaces choose to show it) — one call to
 * this hook, its `batch`/`toggle` threaded to every renderer, `reset()`
 * called whenever the underlying question/result changes.
 */
export function useStructureSelections(): UseStructureSelectionsResult {
    const [batch, setBatch] = useState<StructureSelectionBatch>(EMPTY_STRUCTURE_SELECTION_BATCH);

    const toggle = useCallback((member: StructureNeedKind, receipt: BoundStructureReceipt) => {
        setBatch((current) => toggleStructureOffer(current, member, receipt));
    }, []);

    const reset = useCallback(() => {
        setBatch(EMPTY_STRUCTURE_SELECTION_BATCH);
    }, []);

    return { batch, toggle, reset };
}
