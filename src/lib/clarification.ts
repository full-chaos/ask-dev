import type { InvestigationResult, SubjectRef } from "@/lib/contracts";

/**
 * Was the tester's clarification choice actually applied? (CHAOS-3738,
 * CHAOS-3813.)
 *
 * ACR drops a receipt SILENTLY. Verified at pin `0ed4e1a`: a receipt is skipped
 * when the prior result is unloadable, when no candidate matches, or when the
 * subject fails the graph authorization check — and `engine.go:417-427` states
 * that "Investigate itself never errors or otherwise surfaces the skip". The
 * only signal is a server-side counter, and the result schema contains no
 * receipt disposition at all.
 *
 * So a tester can choose a subject, have the choice discarded, and be shown a
 * confident answer about something else — or asked the very same question
 * again, and again, with the Workbench looking like it is working throughout.
 *
 * This is DETECTION, not repair. Nothing here retries, re-resolves, or
 * substitutes; it reports that the choice was not applied so the answer is not
 * read as being about the chosen subject. When CHAOS-3813 lands a wire-visible
 * receipt disposition, this becomes redundant — and is KEPT anyway. Defense in
 * depth on a measurement instrument is not dead code, and a future pin bump
 * should not delete it as such.
 */

/** Identity of record. Labels are display text; canonical ids are the identity. */
function sameSubject(left: SubjectRef, right: SubjectRef): boolean {
    return left.kind === right.kind && left.canonical_id === right.canonical_id;
}

/**
 * The subject a receipt names, looked up in the result that issued it.
 *
 * Returns `undefined` when the receipt names no candidate of this result, which
 * is itself a reason not to proceed as though a choice was made.
 */
export function subjectForReceipt(
    result: InvestigationResult,
    receiptId: string,
): SubjectRef | undefined {
    return result.subject_resolution.candidates.find(
        (candidate) => candidate.receipt_id === receiptId,
    )?.subject;
}

export type ChoiceDisposition =
    /** The chosen subject is committed in the new result. */
    | { readonly applied: true }
    /**
     * The chosen subject is absent from the new result's committed subjects.
     * `answered` distinguishes the two shapes this takes: an answer about some
     * other subject, or another clarification with nothing committed — which
     * would otherwise read as an ordinary second clarification and let a tester
     * loop indefinitely.
     */
    | { readonly applied: false; readonly answered: boolean };

export function choiceDisposition(
    result: InvestigationResult,
    chosen: SubjectRef,
): ChoiceDisposition {
    const applied = result.subject_resolution.committed.some((subject) =>
        sameSubject(subject, chosen),
    );
    if (applied) return { applied: true };
    return { applied: false, answered: result.status !== "clarification_required" };
}
