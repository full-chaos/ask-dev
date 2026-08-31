import { StructureConfirmationRecords } from "@/components/StructureConfirmationNotice";
import type { ChoiceDisposition } from "@/lib/clarification";
import { structureMemberLabel, summarizeConfirmedStructure } from "@/lib/structure-disposition";
import type { ConfirmedStructureEntry, SubjectRef } from "@/lib/contracts";

export type ChosenAnswersSummaryCardProps = {
    readonly confirmedStructure: readonly ConfirmedStructureEntry[] | undefined;
    readonly chosenSubject: SubjectRef | undefined;
    readonly disposition: ChoiceDisposition | undefined;
};

type Row = { readonly key: string; readonly question: string; readonly answer: string };

/**
 * CHAOS-4671: one compact card, question muted / answer emphasized, per the
 * ticket's second visual reference — replaces `StructureConfirmationNotice`'s
 * "Your selections were applied" chip panel AND the old per-offer inline
 * receipt panels on the chat surface (`DeterministicAnswerView`'s
 * `offersPresentation === "popup"` branch only; `/workbench` keeps the chip
 * panel unchanged).
 *
 * Deliberately narrower than `StructureConfirmationNotice`: a VETOED entry
 * still needs the full alert treatment (a caller must not miss a dropped
 * selection), so `DeterministicAnswerView` keeps rendering
 * `StructureConfirmationNotice` verbatim whenever any entry was vetoed —
 * this card only covers the "everything applied cleanly" case, the one that
 * used to collapse to a quiet chip row.
 *
 * codex round 2 finding 2: the ticket's own acceptance ("selection
 * receipts/details remain reachable from the answer's collapsed detail")
 * means this card must not simply DROP the per-entry receipt/source/
 * provenance detail `StructureConfirmationNotice`'s own collapsed
 * "Selection details" `<details>` used to carry — it reuses that SAME
 * record list (`StructureConfirmationRecords`, now exported for this) so
 * the detail is reachable here too, not gone.
 */
export function ChosenAnswersSummaryCard({
    confirmedStructure,
    chosenSubject,
    disposition,
}: ChosenAnswersSummaryCardProps) {
    const rows: Row[] = (confirmedStructure ?? [])
        .filter((entry) => entry.disposition === "applied")
        .map((entry) => ({
            key: entry.member,
            question: structureMemberLabel(entry.member),
            answer: entry.applied_value,
        }));
    if (chosenSubject !== undefined && disposition?.applied === true) {
        rows.push({ key: "subject", question: "Subject", answer: chosenSubject.label });
    }
    if (rows.length === 0) return null;

    // Every entry reaching this component is already "applied" (the
    // vetoed case routes to `StructureConfirmationNotice` instead — see
    // this component's own header) — filtered again here defensively so a
    // future caller change can't silently surface a veto's receipt detail
    // through the wrong (non-alerted) surface.
    const appliedSummaries = summarizeConfirmedStructure(confirmedStructure).filter(
        (summary) => summary.applied,
    );

    return (
        <section aria-label="Chosen answers" className="panel panel--compact chosen-answers">
            <h2 className="panel__title">Your answers</h2>
            <ul className="chosen-answers__list">
                {rows.map((row) => (
                    <li className="chosen-answers__row" key={row.key}>
                        <span className="chosen-answers__question">{row.question}</span>
                        <span className="chosen-answers__answer">{row.answer}</span>
                    </li>
                ))}
            </ul>
            {appliedSummaries.length === 0 ? null : (
                <details className="disclosure">
                    <summary>Selection details</summary>
                    <StructureConfirmationRecords summaries={appliedSummaries} />
                </details>
            )}
        </section>
    );
}
