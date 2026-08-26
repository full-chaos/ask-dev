import { useId } from "react";

import { Badge } from "@/components/Badge";
import type { PriorSubjectReceiptDispositionEntry } from "@/lib/contracts";
import { humanizeTerm, priorSubjectReceiptDispositionTone } from "@/lib/presentation";

export type PriorSubjectReceiptDisclosureProps = {
    readonly dispositions: readonly PriorSubjectReceiptDispositionEntry[] | undefined;
};

/**
 * CHAOS-3478/CHAOS-3813 (acr PR #265, e946ad90): disclosure for every
 * `prior_subject_receipts` entry the caller sent on this request.
 *
 * A prior-turn subject receipt used to be a SILENT drop — `@/lib/clarification.ts`'s
 * own header documents that acr gave the caller nothing to detect it with
 * beyond a server-side counter. This is now wire-visible: every receipt gets
 * an entry here, applied or skipped, with the skip reason named.
 *
 * Its own component, not inlined into `SubjectResolutionPanel` (codex
 * finding): `SubjectResolution.prior_subject_receipt_dispositions` can be
 * present on a `clarification_required` result too — a prior choice can be
 * dropped in the SAME turn a fresh clarification is asked, which is exactly
 * when a tester most needs to see it (a dropped choice AND a new "which one
 * did you mean" read as one ordinary clarification otherwise). That path
 * renders `ClarificationPanel`, not `SubjectResolutionPanel` (which would
 * duplicate `ClarificationPanel`'s own candidate list), so both call sites
 * — `SubjectResolutionPanel` for the decisive path and
 * `DeterministicAnswerView` directly for the clarification path — render
 * this same component rather than duplicating its markup.
 */
export function PriorSubjectReceiptDisclosure({
    dispositions,
}: PriorSubjectReceiptDisclosureProps) {
    // Instance-scoped (codex finding, matching StructureNeedsPanel's own
    // useId() rationale): the chat surface renders one of these per answered
    // turn (`@/app/page.tsx`), so a hardcoded id would collide across turns
    // and break `aria-labelledby` for every instance but the first.
    const idPrefix = useId();
    if (dispositions === undefined || dispositions.length === 0) return null;
    return (
        <section aria-labelledby={`${idPrefix}-prior-subject-receipts-title`}>
            <h3 className="panel__title" id={`${idPrefix}-prior-subject-receipts-title`}>
                Prior-turn subject receipts
            </h3>
            <ul className="stack stack--tight">
                {dispositions.map((entry, index) => (
                    // Composite key, index-guarded (codex round 1 + round 2
                    // findings): the schema does not require `receipt_id` to
                    // be unique ACROSS different prior results, only
                    // `(prior_result_id, receipt_id)` together identifies one
                    // entry — and since either id may itself legally contain
                    // `:` (`stringLengthBetween`, no character-shape bound),
                    // even that pair could theoretically collide after
                    // joining. `index` is always unique within one render of
                    // this immutable, never-reordered list, so it closes the
                    // gap the join alone cannot.
                    <li
                        className="record__meta"
                        key={`${index}:${entry.prior_result_id}:${entry.receipt_id}`}
                    >
                        <code>{entry.receipt_id}</code> from <code>{entry.prior_result_id}</code>:{" "}
                        <Badge
                            tone={priorSubjectReceiptDispositionTone(entry.disposition)}
                            title={entry.disposition}
                        >
                            {humanizeTerm(entry.disposition)}
                        </Badge>
                    </li>
                ))}
            </ul>
        </section>
    );
}
