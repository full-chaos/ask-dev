/**
 * Multi-select accumulator for subject-candidate picks (CHAOS-4343 items 1/2).
 *
 * Unlike `StructureSelectionBatch` (`@/lib/structure-selections`) — one
 * receipt per member, because the engine accepts exactly one confirmed pick
 * per structure member in a single request — a tester picking subject
 * candidates may want SEVERAL at once, and each becomes its OWN independent
 * turn-2 request (item 2: "N selected candidates produce N stacked result
 * panels, each with its own turn-2 request and status"), never one request
 * carrying several `prior_candidate_receipts`. So this batch is just a set of
 * receipt ids, not a map to a single value: `result_id` is always the
 * CURRENT (latest) result's own id wherever a selection is read back, and
 * every id here already names one of THAT result's own candidates.
 *
 * Mirrors `structure-selections.ts`'s own shape (pure reducers, no React) so
 * `use-candidate-selections.ts` can follow `use-structure-selections.ts`'s
 * hook pattern exactly.
 */
export type CandidateSelectionBatch = ReadonlySet<string>;

export const EMPTY_CANDIDATE_SELECTION_BATCH: CandidateSelectionBatch = new Set();

/** Pure reducer: select-or-toggle-off the same candidate's receipt id. */
export function toggleCandidateSelection(
    batch: CandidateSelectionBatch,
    receiptId: string,
): CandidateSelectionBatch {
    const next = new Set(batch);
    if (next.has(receiptId)) {
        next.delete(receiptId);
    } else {
        next.add(receiptId);
    }
    return next;
}

export function candidateSelectionCount(batch: CandidateSelectionBatch): number {
    return batch.size;
}
