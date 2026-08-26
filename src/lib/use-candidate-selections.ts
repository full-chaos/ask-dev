"use client";

import { useCallback, useState } from "react";

import {
    EMPTY_CANDIDATE_SELECTION_BATCH,
    toggleCandidateSelection,
    type CandidateSelectionBatch,
} from "@/lib/candidate-selections";
import {
    EMPTY_SELECTION_EVENTS,
    recordSelectionEvent,
    type PendingSelectionEvent,
} from "@/lib/structure-selections";

export type UseCandidateSelectionsResult = {
    readonly batch: CandidateSelectionBatch;
    readonly toggle: (receiptId: string) => void;
    /**
     * Every selection outcome observed since the last `reset()`, queued for
     * the next `/api/investigations` submit — same telemetry pipe as
     * `useStructureSelections`'s own `pendingSelectionEvents` (CHAOS-4171
     * standing order: telemetry baked into new logic, same PR).
     * `subject_candidate` is already one of the five `StructureNeedKind`
     * members (CHAOS-4012), so this reuses `recordSelectionEvent`/
     * `PendingSelectionEvent` verbatim rather than inventing a parallel
     * shape the route would need its own parser for.
     */
    readonly pendingSelectionEvents: readonly PendingSelectionEvent[];
    readonly reset: () => void;
};

/**
 * Portable multi-select-and-re-ask-PER-PICK state (CHAOS-4343 items 1/2),
 * mirroring `useStructureSelections`'s own hook shape.
 *
 * `batch` is meant to be shared across every simultaneous rendering of the
 * SAME candidate list — one instance per surface, its `batch`/`toggle`
 * threaded to every renderer, `reset()` called whenever the underlying
 * question/result changes (i.e. right before the confirmed selections are
 * sent, same point `useStructureSelections` resets at).
 */
export function useCandidateSelections(): UseCandidateSelectionsResult {
    const [batch, setBatch] = useState<CandidateSelectionBatch>(EMPTY_CANDIDATE_SELECTION_BATCH);
    const [pendingSelectionEvents, setPendingSelectionEvents] =
        useState<readonly PendingSelectionEvent[]>(EMPTY_SELECTION_EVENTS);

    const toggle = useCallback((receiptId: string) => {
        setBatch((current) => toggleCandidateSelection(current, receiptId));
        setPendingSelectionEvents((current) =>
            recordSelectionEvent(current, "subject_candidate", "submitted"),
        );
    }, []);

    const reset = useCallback(() => {
        setBatch(EMPTY_CANDIDATE_SELECTION_BATCH);
        setPendingSelectionEvents(EMPTY_SELECTION_EVENTS);
    }, []);

    return { batch, toggle, pendingSelectionEvents, reset };
}
