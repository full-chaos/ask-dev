import type {
    BoundStructureReceipt,
    ConfirmedStructureEntry,
    StructureNeedKind,
} from "@/lib/contracts";
import type { StructureSelectionBatch } from "@/lib/structure-selections";

/**
 * Conversation-scoped carry of confirmed structure receipts (CHAOS-4355
 * stopgap; CHAOS-4360 is the real acr-side fix, tracked separately).
 *
 * ACR does not carry a confirmed `structure_needs` member (kind/anchor/
 * handle/window/candidate) forward server-side across re-asks — each
 * request is judged only on what it itself carries. The Workbench's own
 * `StructureSelectionBatch` (`structure-selections.ts`) is a SINGLE-TURN
 * accumulator: it resets on every `ask()`/`confirmSelections()` call, by
 * design, so a member confirmed on turn 2 is gone from the batch by turn 3
 * even though the tester never changed their mind about it. When turn 3
 * asks about a DIFFERENT member (e.g. picking a subject candidate) without
 * resending the window receipt turn 2 already confirmed, ACR infers a fresh
 * window, the window gate fires, and every subject receipt in that turn is
 * reported `skipped_failed_reauth` — a decisive answer never lands.
 *
 * This module is the fix's data layer: a `member -> receipt` map that
 * OUTLIVES a single `StructureSelectionBatch`, populated from each
 * response's own `confirmed_structure` echo and merged into every
 * following re-ask within the SAME conversation, until the tester starts a
 * fresh question or explicitly changes/deselects that member.
 *
 * Scope, matching the brief exactly: only RECEIPT-sourced, APPLIED entries
 * are carryable. An `explicit`/`explicit_unattributed` entry has no
 * `receipt_id` to resend (it was never a receipt to begin with — an
 * inferred default or a literal-noun guess), and a `vetoed_*` entry is
 * fail-closed DROPPED rather than resent — resending something ACR just
 * rejected would be a retry loop, not a carry.
 */

export type CarriedStructureReceipt = {
    readonly member: StructureNeedKind;
    readonly receipt: BoundStructureReceipt;
    /** The assistant turn id this member was carried FROM — the "carried from turn N" disclosure. */
    readonly turn: number;
};

export type StructureCarryMap = {
    readonly [member in StructureNeedKind]?: CarriedStructureReceipt;
};

export const EMPTY_STRUCTURE_CARRY: StructureCarryMap = {};

export type StructureCarryUpdate = {
    readonly toSet: StructureCarryMap;
    readonly toDrop: readonly StructureNeedKind[];
};

export const EMPTY_STRUCTURE_CARRY_UPDATE: StructureCarryUpdate = { toSet: {}, toDrop: [] };

/**
 * Derives what a response's `confirmed_structure` echo means for the carry:
 * an applied, receipt-sourced entry is (re)carried from this turn onward; a
 * vetoed entry drops whatever this member was carrying, so a rejected
 * resend never gets resent again (no retry loops). An applied entry with no
 * usable receipt (`source !== "receipt"`, or ACR omitted the id pair) is
 * left untouched — nothing resendable, but also nothing to fail closed on.
 */
export function deriveCarryUpdate(
    entries: readonly ConfirmedStructureEntry[] | undefined,
    turn: number,
): StructureCarryUpdate {
    if (entries === undefined || entries.length === 0) return EMPTY_STRUCTURE_CARRY_UPDATE;
    const toSet: { [member in StructureNeedKind]?: CarriedStructureReceipt } = {};
    const toDrop: StructureNeedKind[] = [];
    for (const entry of entries) {
        if (entry.disposition !== "applied") {
            toDrop.push(entry.member);
            continue;
        }
        if (entry.source !== "receipt") continue;
        if (entry.prior_result_id === undefined || entry.receipt_id === undefined) continue;
        toSet[entry.member] = {
            member: entry.member,
            receipt: { result_id: entry.prior_result_id, receipt_id: entry.receipt_id },
            turn,
        };
    }
    return { toSet, toDrop };
}

/** Applies a `StructureCarryUpdate` onto the running carry map: drops first, then sets. */
export function applyCarryUpdate(
    current: StructureCarryMap,
    update: StructureCarryUpdate,
): StructureCarryMap {
    if (update.toDrop.length === 0 && Object.keys(update.toSet).length === 0) return current;
    const next: { [member in StructureNeedKind]?: CarriedStructureReceipt } = { ...current };
    for (const member of update.toDrop) delete next[member];
    for (const member of Object.keys(update.toSet) as StructureNeedKind[]) {
        const entry = update.toSet[member];
        if (entry !== undefined) next[member] = entry;
    }
    return next;
}

/** Drops one member from the carry — an explicit deselect stops it riding along silently. */
export function dropCarriedMember(
    current: StructureCarryMap,
    member: StructureNeedKind,
): StructureCarryMap {
    if (!(member in current)) return current;
    const next = { ...current };
    delete next[member];
    return next;
}

/**
 * The carried members that would actually be INJECTED into an outgoing
 * request — i.e. every carry entry for a member the tester's own explicit
 * `StructureSelectionBatch` does NOT already cover. An explicit pick always
 * wins over a carried one for the same member.
 */
export function structureCarryContribution(
    carry: StructureCarryMap,
    explicit: StructureSelectionBatch,
): readonly CarriedStructureReceipt[] {
    return (Object.keys(carry) as StructureNeedKind[])
        .filter((member) => !(member in explicit))
        .map((member) => carry[member])
        .filter((entry): entry is CarriedStructureReceipt => entry !== undefined);
}

/**
 * Merges the carry UNDER an explicit batch (explicit always wins) into a
 * batch shape ready for `buildStructureReceiptFields` — the request-body
 * builder never has to know a carry exists.
 */
export function mergeStructureCarryIntoBatch(
    carry: StructureCarryMap,
    explicit: StructureSelectionBatch,
): StructureSelectionBatch {
    if (Object.keys(carry).length === 0) return explicit;
    const merged: { [member in StructureNeedKind]?: BoundStructureReceipt } = {};
    for (const contribution of structureCarryContribution(carry, explicit)) {
        merged[contribution.member] = contribution.receipt;
    }
    return { ...merged, ...explicit };
}
