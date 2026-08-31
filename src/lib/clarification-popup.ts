import {
    STRUCTURE_NEED_KINDS_IN_PRIORITY_ORDER,
    type BoundStructureReceipt,
    type InvestigationResult,
    type StructureNeedKind,
    type StructureNeeds,
} from "@/lib/contracts";
import type { StructureSelectionBatch } from "@/lib/structure-selections";
import { structureMemberLabel } from "@/lib/structure-disposition";

/**
 * CHAOS-4671: the popup clarification flow (window/kind/anchor/handle offers
 * plus both candidate axes) as an ordered set of PAGES, one question per
 * page, built PURELY from the current result and the three selection
 * batches `page.tsx` already owns (`useStructureSelections`/
 * `useCandidateSelections` x2) — nothing here mints a new selection model.
 *
 * `ClarificationPopup` reads this to render; `page.tsx` still owns every
 * actual mutation via the SAME `toggle`/`chooseStructure` functions the old
 * inline panels called — see that component's own header for why a
 * `PopupOption.source` round-trips directly into those calls with zero wire
 * changes.
 *
 * A member with zero offered options gets NO page (§ ticket: "offers that
 * cannot be acted on are not shown as controls at all") — unlike
 * `StructureNeedsPanel`, which used to render a "No X offers were
 * provided." line for that case; the popup has nothing useful to show there
 * and no space for dead filler.
 */

export type PopupOptionSource =
    | {
          readonly kind: "structure";
          readonly member: StructureNeedKind;
          readonly receipt: BoundStructureReceipt;
      }
    | { readonly kind: "structure-candidate"; readonly receipt: BoundStructureReceipt }
    | { readonly kind: "subject-candidate"; readonly receiptId: string };

export type PopupOption = {
    /** Stable per-page key (the offer's own `option_id`, or its `receipt_id` when it has none). */
    readonly id: string;
    /** The structural value bound to the receipt — always shown alongside `displayText` (never hidden behind phrasing). */
    readonly label: string;
    /** What the option renders as — the model's `phrasing` when the offer carries one, else `label`. */
    readonly displayText: string;
    readonly selected: boolean;
    readonly source: PopupOptionSource;
};

export type PopupPage = {
    /** Stable across renders of the SAME result (member name, or a fixed axis key) — safe as a React key/stepper index anchor. */
    readonly key: string;
    readonly title: string;
    /**
     * `"single"`: exactly one pick is meaningful (kind/anchor/handle/window)
     * — picking auto-advances. `"multi"`: several picks are meaningful
     * (either candidate axis, CHAOS-4343) — picking toggles in place and the
     * page needs an explicit advance (Continue/Skip).
     */
    readonly selectMode: "single" | "multi";
    readonly options: readonly PopupOption[];
};

const PROMPT_TITLE: Record<StructureNeedKind, string> = {
    expected_kind: "Which kind of thing is this about?",
    subject_anchor: "Which repository, project, or team?",
    subject_handle: "Which specific item?",
    window: "Over what period?",
    subject_candidate: "Did you mean one of these?",
};

function structureOptionsPage(
    resultId: string,
    needs: StructureNeeds,
    member: StructureNeedKind,
    selectedReceiptId: string | undefined,
): PopupPage | undefined {
    const options = ((): readonly {
        readonly option_id: string;
        readonly receipt_id: string;
        readonly label: string;
        readonly phrasing?: string;
    }[] => {
        switch (member) {
            case "expected_kind":
                return needs.kind_options ?? [];
            case "subject_anchor":
                return needs.anchor_options ?? [];
            case "subject_handle":
                return needs.handle_options ?? [];
            case "window":
                return needs.window_options ?? [];
            case "subject_candidate":
                return [];
        }
    })();
    if (options.length === 0) return undefined;
    return {
        key: member,
        title: PROMPT_TITLE[member],
        selectMode: "single",
        options: options.map((option) => ({
            id: option.option_id,
            label: option.label,
            displayText: option.phrasing ?? option.label,
            selected: option.receipt_id === selectedReceiptId,
            source: {
                kind: "structure",
                member,
                receipt: { result_id: resultId, receipt_id: option.receipt_id },
            },
        })),
    };
}

function structureCandidatePage(
    resultId: string,
    needs: StructureNeeds,
    selectedReceiptIds: ReadonlySet<string>,
): PopupPage | undefined {
    const options = needs.candidate_options ?? [];
    if (options.length === 0) return undefined;
    return {
        key: "subject_candidate",
        title: PROMPT_TITLE.subject_candidate,
        selectMode: "multi",
        options: options.map((option) => ({
            id: option.option_id,
            label: option.label,
            displayText: option.phrasing ?? option.label,
            selected: selectedReceiptIds.has(option.receipt_id),
            source: {
                kind: "structure-candidate",
                receipt: { result_id: resultId, receipt_id: option.receipt_id },
            },
        })),
    };
}

function subjectResolutionPage(
    result: InvestigationResult,
    selectedReceiptIds: ReadonlySet<string>,
): PopupPage | undefined {
    const { candidates, clarification_prompt: prompt } = result.subject_resolution;
    if (candidates.length === 0) return undefined;
    return {
        key: "subject_resolution",
        title: prompt ?? "Which subject did you mean?",
        selectMode: "multi",
        options: candidates.map((candidate) => ({
            id: candidate.receipt_id,
            label: candidate.subject.label,
            displayText: candidate.subject.label,
            selected: selectedReceiptIds.has(candidate.receipt_id),
            source: { kind: "subject-candidate", receiptId: candidate.receipt_id },
        })),
    };
}

/**
 * Builds every actionable page for `result`, in `STRUCTURE_NEED_KINDS_IN_PRIORITY_ORDER`
 * order (kind, anchor, handle, window, structure-candidate), then the
 * `subject_resolution` candidate page last — mirrors
 * `DeterministicAnswerView`'s own existing render order (structure needs
 * before the subject clarification).
 *
 * The `subject_resolution` page is gated to `status === "clarification_required"`
 * — matching `ClarificationPanel`'s own OLD call site exactly (it was only
 * ever mounted from `DeterministicAnswerView`'s `clarification_required`
 * branch). `subject_resolution.candidates` can be non-empty on a DECISIVE
 * result too (ranked candidates riding along even once committed) — without
 * this gate, a plain complete answer would wrongly pop up a "did you mean"
 * dialog over nothing to clarify. `structure_needs`, by contrast, is read
 * unconditionally — the old `StructureNeedsPanel` rendered in BOTH branches,
 * and still-`missing` members can legitimately accompany a decisive result.
 */
export function buildClarificationPages(
    result: InvestigationResult,
    structureBatch: StructureSelectionBatch,
    structureCandidateSelectedIds: ReadonlySet<string>,
    subjectCandidateSelectedIds: ReadonlySet<string>,
): readonly PopupPage[] {
    const pages: PopupPage[] = [];
    const needs = result.structure_needs;
    if (needs !== undefined) {
        for (const member of STRUCTURE_NEED_KINDS_IN_PRIORITY_ORDER) {
            if (!needs.missing.includes(member)) continue;
            const page =
                member === "subject_candidate"
                    ? structureCandidatePage(result.result_id, needs, structureCandidateSelectedIds)
                    : structureOptionsPage(
                          result.result_id,
                          needs,
                          member,
                          structureBatch[member]?.receipt_id,
                      );
            if (page !== undefined) pages.push(page);
        }
    }
    if (result.status === "clarification_required") {
        const subjectPage = subjectResolutionPage(result, subjectCandidateSelectedIds);
        if (subjectPage !== undefined) pages.push(subjectPage);
    }
    return pages;
}

/** Re-exported for callers that want the member's plain-English label (e.g. the chosen-answers summary card). */
export { structureMemberLabel };
