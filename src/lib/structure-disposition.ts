import type {
    ConfirmedStructureEntry,
    StructureDisposition,
    StructureNeedKind,
} from "@/lib/contracts";

/**
 * Structure confirmation is wire-visible from day one (design brief §2.1):
 * unlike `prior_subject_receipts` (CHAOS-3813, still unclosed acr-side —
 * `src/lib/clarification.ts`'s `choiceDisposition` DETECTS a silent drop
 * because the contract gives it nothing else to go on), every carried
 * structure member gets an explicit `ConfirmedStructureEntry`, veto
 * dispositions included. So there is nothing to detect here — only to
 * render legibly, which is the closure this module provides: "a veto the
 * caller cannot see is the silent drop reborn" (§2.1).
 */

const MEMBER_LABEL: Record<StructureNeedKind, string> = {
    expected_kind: "kind",
    subject_anchor: "repository/project/team",
    subject_handle: "handle",
    window: "time window",
};

export function structureMemberLabel(member: StructureNeedKind): string {
    return MEMBER_LABEL[member];
}

/**
 * One sentence per disposition, naming the §2.5 failure branch it maps to so
 * a tester reading this is not left guessing why a pick did not stick.
 * Exhaustive over the closed enum.
 */
function dispositionSentence(disposition: StructureDisposition, member: StructureNeedKind): string {
    const label = structureMemberLabel(member);
    switch (disposition) {
        case "applied":
            return `Your ${label} selection was applied.`;
        case "vetoed_unresolved":
            return `Your ${label} selection could not be resolved (the prior result may be unloadable, or the receipt matched no offer) and was NOT applied. Fresh offers are shown below — try again.`;
        case "vetoed_conflict":
            return `Your ${label} selection conflicted with another value in the same request and was NOT applied. Fresh offers are shown below — try again.`;
        case "vetoed_stale":
            return `Your ${label} selection was for an offer that is no longer current (superseded by a later confirmation) and was NOT applied. Fresh offers are shown below — try again.`;
    }
}

export type StructureConfirmationSummary = {
    readonly entry: ConfirmedStructureEntry;
    readonly label: string;
    readonly sentence: string;
    readonly applied: boolean;
};

/**
 * Maps every carried `confirmed_structure` entry to display copy, in the
 * order the result carried them. Never re-sorts — same rule ClarificationPanel
 * already holds for subject candidates (§2.2's own boundary pin: "never
 * re-rank or filter offers").
 */
export function summarizeConfirmedStructure(
    entries: readonly ConfirmedStructureEntry[] | undefined,
): readonly StructureConfirmationSummary[] {
    if (entries === undefined) return [];
    return entries.map((entry) => ({
        entry,
        label: structureMemberLabel(entry.member),
        sentence: dispositionSentence(entry.disposition, entry.member),
        applied: entry.disposition === "applied",
    }));
}

/** True when any carried member was vetoed — used to pick the notice's tone/role. */
export function hasVetoedStructureConfirmation(
    entries: readonly ConfirmedStructureEntry[] | undefined,
): boolean {
    return (entries ?? []).some((entry) => entry.disposition !== "applied");
}
