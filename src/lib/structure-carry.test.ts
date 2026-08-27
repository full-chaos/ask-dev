import { describe, expect, it } from "vitest";

import type { ConfirmedStructureEntry } from "@/lib/contracts";
import {
    applyCarryUpdate,
    deriveCarryUpdate,
    dropCarriedMember,
    EMPTY_STRUCTURE_CARRY,
    mergeStructureCarryIntoBatch,
    structureCarryContribution,
} from "@/lib/structure-carry";

const WINDOW_RECEIPT_ENTRY: ConfirmedStructureEntry = {
    member: "window",
    applied_value: "trailing_30d",
    source: "receipt",
    prior_result_id: "result_turn2_0001",
    receipt_id: "winr_trailing_30d_0001",
    offer_source: "engine",
    provenance: "clarification_confirmed",
    disposition: "applied",
};

const ANCHOR_RECEIPT_ENTRY: ConfirmedStructureEntry = {
    member: "subject_anchor",
    applied_value: "repository:repo_atlas",
    source: "receipt",
    prior_result_id: "result_turn2_0001",
    receipt_id: "ancr_repo_atlas_0001",
    offer_source: "engine",
    provenance: "clarification_confirmed",
    disposition: "applied",
};

const VETOED_WINDOW_ENTRY: ConfirmedStructureEntry = {
    ...WINDOW_RECEIPT_ENTRY,
    disposition: "vetoed_stale",
};

const EXPLICIT_KIND_ENTRY: ConfirmedStructureEntry = {
    member: "expected_kind",
    applied_value: "pull_request",
    source: "explicit",
    provenance: "question_stated",
    disposition: "applied",
};

describe("deriveCarryUpdate (CHAOS-4355 stopgap)", () => {
    it("returns nothing to set or drop when there is no confirmed_structure echo", () => {
        expect(deriveCarryUpdate(undefined, 2)).toEqual({ toSet: {}, toDrop: [] });
        expect(deriveCarryUpdate([], 2)).toEqual({ toSet: {}, toDrop: [] });
    });

    it("carries an applied, receipt-sourced entry, stamped with the turn it came from", () => {
        const update = deriveCarryUpdate([WINDOW_RECEIPT_ENTRY], 2);
        expect(update.toSet).toEqual({
            window: {
                member: "window",
                receipt: { result_id: "result_turn2_0001", receipt_id: "winr_trailing_30d_0001" },
                turn: 2,
            },
        });
        expect(update.toDrop).toEqual([]);
    });

    it("drops (never re-sets) a vetoed member — fail closed, no retry loop", () => {
        const update = deriveCarryUpdate([VETOED_WINDOW_ENTRY], 3);
        expect(update.toSet).toEqual({});
        expect(update.toDrop).toEqual(["window"]);
    });

    it("does not carry an explicit (non-receipt) entry — nothing resendable", () => {
        const update = deriveCarryUpdate([EXPLICIT_KIND_ENTRY], 2);
        expect(update.toSet).toEqual({});
        expect(update.toDrop).toEqual([]);
    });

    it("handles several members from one echo independently", () => {
        const update = deriveCarryUpdate([WINDOW_RECEIPT_ENTRY, ANCHOR_RECEIPT_ENTRY], 2);
        expect(Object.keys(update.toSet).sort()).toEqual(["subject_anchor", "window"]);
    });
});

describe("applyCarryUpdate", () => {
    it("sets new members and drops vetoed ones onto the running carry", () => {
        const afterTurn2 = applyCarryUpdate(
            EMPTY_STRUCTURE_CARRY,
            deriveCarryUpdate([WINDOW_RECEIPT_ENTRY], 2),
        );
        expect(afterTurn2.window?.receipt.receipt_id).toBe("winr_trailing_30d_0001");

        // A LATER turn's response says nothing about `window` at all (the
        // defect this closes: turn 3 never re-echoes it) — it must survive
        // untouched.
        const afterTurn3 = applyCarryUpdate(
            afterTurn2,
            deriveCarryUpdate([ANCHOR_RECEIPT_ENTRY], 3),
        );
        expect(afterTurn3.window?.receipt.receipt_id).toBe("winr_trailing_30d_0001");
        expect(afterTurn3.subject_anchor?.receipt.receipt_id).toBe("ancr_repo_atlas_0001");

        // A vetoed re-confirmation on the SAME member drops it going forward.
        const afterTurn4 = applyCarryUpdate(
            afterTurn3,
            deriveCarryUpdate([VETOED_WINDOW_ENTRY], 4),
        );
        expect(afterTurn4.window).toBeUndefined();
        expect(afterTurn4.subject_anchor?.receipt.receipt_id).toBe("ancr_repo_atlas_0001");
    });
});

describe("dropCarriedMember", () => {
    it("removes one member and leaves the rest untouched", () => {
        const carry = applyCarryUpdate(
            EMPTY_STRUCTURE_CARRY,
            deriveCarryUpdate([WINDOW_RECEIPT_ENTRY, ANCHOR_RECEIPT_ENTRY], 2),
        );
        const next = dropCarriedMember(carry, "window");
        expect(next.window).toBeUndefined();
        expect(next.subject_anchor).toBeDefined();
    });

    it("is a no-op when the member is not carried", () => {
        expect(dropCarriedMember(EMPTY_STRUCTURE_CARRY, "window")).toBe(EMPTY_STRUCTURE_CARRY);
    });
});

describe("structureCarryContribution / mergeStructureCarryIntoBatch", () => {
    const carry = applyCarryUpdate(
        EMPTY_STRUCTURE_CARRY,
        deriveCarryUpdate([WINDOW_RECEIPT_ENTRY, ANCHOR_RECEIPT_ENTRY], 2),
    );

    it("contributes every carried member the explicit batch does not already cover", () => {
        const contribution = structureCarryContribution(carry, {});
        expect(contribution.map((entry) => entry.member).sort()).toEqual([
            "subject_anchor",
            "window",
        ]);
    });

    it("an explicit pick for a member wins over the carry — that member is not a contribution", () => {
        const explicitWindow = {
            result_id: "result_turn3_0001",
            receipt_id: "winr_trailing_60d_0001",
        };
        const contribution = structureCarryContribution(carry, { window: explicitWindow });
        expect(contribution.map((entry) => entry.member)).toEqual(["subject_anchor"]);
    });

    it("merges carry UNDER the explicit batch — the explicit value survives", () => {
        const explicitWindow = {
            result_id: "result_turn3_0001",
            receipt_id: "winr_trailing_60d_0001",
        };
        const merged = mergeStructureCarryIntoBatch(carry, { window: explicitWindow });
        expect(merged.window).toEqual(explicitWindow);
        expect(merged.subject_anchor).toEqual({
            result_id: "result_turn2_0001",
            receipt_id: "ancr_repo_atlas_0001",
        });
    });

    it("returns the explicit batch unchanged when the carry is empty", () => {
        const explicit = { window: { result_id: "r", receipt_id: "winr_x" } };
        expect(mergeStructureCarryIntoBatch(EMPTY_STRUCTURE_CARRY, explicit)).toBe(explicit);
    });
});

/**
 * The reproduction this whole module exists to close (CHAOS-4355): turn 2
 * confirms a window receipt; turn 3 asks about a DIFFERENT member (a
 * candidate pick) with no explicit window in its own batch. Without the
 * carry, turn 3's outgoing structure batch would be empty for `window` —
 * this is the RED state the fix turns green.
 */
describe("three-turn carry reproduction", () => {
    it("turn 3's merged batch still carries turn 2's confirmed window", () => {
        const carryAfterTurn2 = applyCarryUpdate(
            EMPTY_STRUCTURE_CARRY,
            deriveCarryUpdate([WINDOW_RECEIPT_ENTRY], 2),
        );
        // Turn 3's own explicit batch: nothing about window, only whatever
        // the tester picked THIS turn (modeled here as empty — the picked
        // candidate travels via `priorSubjectReceipts`, not this batch).
        const turn3ExplicitBatch = {};
        const turn3MergedBatch = mergeStructureCarryIntoBatch(carryAfterTurn2, turn3ExplicitBatch);
        expect(turn3MergedBatch.window).toEqual({
            result_id: "result_turn2_0001",
            receipt_id: "winr_trailing_30d_0001",
        });
    });
});
