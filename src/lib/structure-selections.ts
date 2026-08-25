import {
    STRUCTURE_RECEIPT_PREFIX,
    type BoundStructureReceipt,
    type StructureNeedKind,
} from "@/lib/contracts";
import type { StructureOfferSelectionOutcome } from "@/lib/telemetry/outcome";

/**
 * Accumulate-and-re-ask-ONCE (CHAOS-3927 P2, design brief §2.2).
 *
 * "selections accumulate client-side and re-ask ONCE carrying all redeemed
 * receipts ... not one round-trip per member." A tester can pick a kind, an
 * anchor, a handle, and a window offer across one `StructureNeeds`
 * disclosure without the panel firing a re-ask after each pick; only the
 * (single) confirm action sends them all.
 *
 * One selection per member: the engine's own conflict rule vetoes plural
 * same-member receipts in one batch (§2.1, `structure_confirmation_conflict`),
 * so a second pick for a member the tester already chose REPLACES the first
 * rather than accumulating a second receipt the engine would reject anyway.
 */
export type StructureSelectionBatch = {
    readonly [member in StructureNeedKind]?: BoundStructureReceipt;
};

export const EMPTY_STRUCTURE_SELECTION_BATCH: StructureSelectionBatch = {};

/** Pure reducer: records (or replaces) the pick for one member. */
export function selectStructureOffer(
    batch: StructureSelectionBatch,
    member: StructureNeedKind,
    receipt: BoundStructureReceipt,
): StructureSelectionBatch {
    return { ...batch, [member]: receipt };
}

/** Pure reducer: withdraws the pick for one member, if any. */
export function deselectStructureOffer(
    batch: StructureSelectionBatch,
    member: StructureNeedKind,
): StructureSelectionBatch {
    if (!(member in batch)) return batch;
    const next = { ...batch };
    delete next[member];
    return next;
}

export function structureSelectionCount(batch: StructureSelectionBatch): number {
    return Object.keys(batch).length;
}

/**
 * Mixed-receipt-family unification (CHAOS-3927 P2 follow-up).
 *
 * A response can legally carry BOTH a subject-candidate clarification and a
 * `structure_needs` disclosure at once now that P1 landed (the two are
 * independent optional fields on the same result — nothing in the pinned
 * schema forbids their co-presence). Picking a subject candidate fires its
 * own re-ask immediately (unlike structure offers, which accumulate behind
 * an explicit "Ask again with these selections" confirm), so any structure
 * picks the tester already made in the SAME turn's panel — accumulated but
 * not yet confirmed — must travel in that SAME re-ask, or `ask()` resetting
 * the shared selection hook would silently drop them. This is the one place
 * both the chat surface and the Workbench read the live batch to decide
 * whether there is anything of the OTHER family to carry along.
 */
export function pendingStructureBatchOrUndefined(
    batch: StructureSelectionBatch,
): StructureSelectionBatch | undefined {
    return structureSelectionCount(batch) > 0 ? batch : undefined;
}

/**
 * Pure reducer: select-or-replace, or deselect if the SAME offer is clicked
 * again. The one place this toggle semantic lives, so every caller (the
 * panel rendered in the raw view, the one rendered in the deterministic
 * view — codex round 3: these are two SEPARATE component instances, and
 * batch storage lives in the shared page state precisely so a tester
 * switching views mid-selection does not lose their picks) applies it
 * identically.
 */
export function toggleStructureOffer(
    batch: StructureSelectionBatch,
    member: StructureNeedKind,
    receipt: BoundStructureReceipt,
): StructureSelectionBatch {
    return batch[member]?.receipt_id === receipt.receipt_id
        ? deselectStructureOffer(batch, member)
        : selectStructureOffer(batch, member, receipt);
}

/**
 * The receipt-id namespace pins each selection to the member it was picked
 * for — a `kindr_` id can only ever have come from a `KindOption`, and so
 * on. Defense in depth: `selectStructureOffer` is only ever called from a
 * per-member offer list, so a mismatch should be unreachable, but a wrong
 * namespace reaching the wire would be silently ignored by the engine's own
 * validation (400, per §2.5) rather than caught here where the mistake was
 * made. Checked eagerly so a wiring bug fails at selection time, not at
 * submit time.
 */
export function structureReceiptHasExpectedNamespace(
    member: StructureNeedKind,
    receipt: BoundStructureReceipt,
): boolean {
    return receipt.receipt_id.startsWith(STRUCTURE_RECEIPT_PREFIX[member]);
}

/** The contract's own bound on every `prior_*_receipts` array (§2.1: `maxItems: 20`). */
const MAX_RECEIPTS_PER_MEMBER = 20;

/**
 * Builds the five `prior_*_receipts` request bodies from an accumulated
 * batch — camelCase, matching the `/api/investigations` POST body's own
 * `priorSubjectReceipts` naming (the route translates to the contract's
 * snake_case fields, exactly as it already does for subject receipts).
 * `priorCandidateReceipts` is CHAOS-4012's own addition, same shape as the
 * other four.
 *
 * Each array holds at most one entry today (one selection per member), but
 * is built as a deduplicated, capped array — not a bare optional — so the
 * shape matches the contract's `maxItems: 20`/`uniqueItems: true` bound
 * exactly, the same discipline `buildInvestigationRequest` already applies
 * to `prior_subject_receipts`, and so this function does not need to change
 * shape if a future slice ever allows multiple picks per member.
 */
export function buildStructureReceiptFields(batch: StructureSelectionBatch): {
    readonly priorKindReceipts: readonly BoundStructureReceipt[];
    readonly priorAnchorReceipts: readonly BoundStructureReceipt[];
    readonly priorHandleReceipts: readonly BoundStructureReceipt[];
    readonly priorWindowReceipts: readonly BoundStructureReceipt[];
    readonly priorCandidateReceipts: readonly BoundStructureReceipt[];
} {
    const capped = (
        receipt: BoundStructureReceipt | undefined,
    ): readonly BoundStructureReceipt[] =>
        receipt === undefined ? [] : [receipt].slice(0, MAX_RECEIPTS_PER_MEMBER);

    return {
        priorKindReceipts: capped(batch.expected_kind),
        priorAnchorReceipts: capped(batch.subject_anchor),
        priorHandleReceipts: capped(batch.subject_handle),
        priorWindowReceipts: capped(batch.window),
        priorCandidateReceipts: capped(batch.subject_candidate),
    };
}

/**
 * One client-observed selection outcome, queued for the NEXT submit
 * (CHAOS-4171 standing order: telemetry baked into new logic, same PR).
 *
 * Not emitted client-side: a browser `console.info` lands only in that
 * viewer's own devtools, collected nowhere in prod (team-lead ruling,
 * 2026-08-24). Instead this rides the next `/api/investigations` POST body
 * alongside the structure receipts it travels with, and the ROUTE emits it
 * (see `src/app/api/investigations/route.ts`'s own `structureSelectionEvents`
 * handling) — server stdout is the surface the log pipeline actually
 * collects. `useStructureSelections` owns the accumulation; this module only
 * holds the pure shape and reducer, matching every other batch operation
 * here.
 */
export type PendingSelectionEvent = {
    readonly member: StructureNeedKind;
    readonly outcome: StructureOfferSelectionOutcome;
};

export const EMPTY_SELECTION_EVENTS: readonly PendingSelectionEvent[] = [];

/** Pure reducer: appends one client-observed selection outcome. */
export function recordSelectionEvent(
    events: readonly PendingSelectionEvent[],
    member: StructureNeedKind,
    outcome: StructureOfferSelectionOutcome,
): readonly PendingSelectionEvent[] {
    return [...events, { member, outcome }];
}
