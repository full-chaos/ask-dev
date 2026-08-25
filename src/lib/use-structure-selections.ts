"use client";

import { useCallback, useState } from "react";

import type { BoundStructureReceipt, StructureNeedKind } from "@/lib/contracts";
import {
    EMPTY_SELECTION_EVENTS,
    EMPTY_STRUCTURE_SELECTION_BATCH,
    recordSelectionEvent,
    toggleStructureOffer,
    type PendingSelectionEvent,
    type StructureSelectionBatch,
} from "@/lib/structure-selections";

export type UseStructureSelectionsResult = {
    readonly batch: StructureSelectionBatch;
    readonly toggle: (member: StructureNeedKind, receipt: BoundStructureReceipt) => void;
    /**
     * Records a namespace-mismatch rejection (CHAOS-4171 standing order) —
     * called by `StructureNeedsPanel` on its defense-in-depth branch, which
     * never reaches `toggle` because no valid receipt exists to apply.
     */
    readonly reject: (member: StructureNeedKind) => void;
    /**
     * Every selection outcome observed since the last `reset()`, queued for
     * the next `/api/investigations` submit to carry and the route to emit —
     * see `structure-selections.ts`'s own `PendingSelectionEvent` header for
     * why this does not emit client-side.
     */
    readonly pendingSelectionEvents: readonly PendingSelectionEvent[];
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
    const [pendingSelectionEvents, setPendingSelectionEvents] =
        useState<readonly PendingSelectionEvent[]>(EMPTY_SELECTION_EVENTS);

    const toggle = useCallback((member: StructureNeedKind, receipt: BoundStructureReceipt) => {
        setBatch((current) => toggleStructureOffer(current, member, receipt));
        setPendingSelectionEvents((current) => recordSelectionEvent(current, member, "submitted"));
    }, []);

    const reject = useCallback((member: StructureNeedKind) => {
        setPendingSelectionEvents((current) =>
            recordSelectionEvent(current, member, "rejected_malformed"),
        );
    }, []);

    const reset = useCallback(() => {
        setBatch(EMPTY_STRUCTURE_SELECTION_BATCH);
        setPendingSelectionEvents(EMPTY_SELECTION_EVENTS);
    }, []);

    return { batch, toggle, reject, pendingSelectionEvents, reset };
}
