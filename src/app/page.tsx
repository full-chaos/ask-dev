"use client";

import { useState } from "react";

import { CanonicalResultInspector } from "@/components/CanonicalResultInspector";
import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { FailurePanel } from "@/components/FailurePanel";
import { QuestionForm } from "@/components/QuestionForm";
import { ChoiceNotice } from "@/components/ChoiceNotice";
import { ClarificationPanel } from "@/components/ClarificationPanel";
import type { ClarificationChoice } from "@/components/ClarificationPanel";
import { StructureConfirmationNotice } from "@/components/StructureConfirmationNotice";
import { StructureNeedsPanel } from "@/components/StructureNeedsPanel";
import { ViewSwitcher, type WorkbenchView } from "@/components/ViewSwitcher";
import type { WorkbenchFailure } from "@/lib/acr/errors";
import { choiceDisposition, subjectForReceipt } from "@/lib/clarification";
import type { PivotAwareInvestigationResult, SubjectRef } from "@/lib/contracts";
import {
    buildStructureReceiptFields,
    type StructureSelectionBatch,
} from "@/lib/structure-selections";

/**
 * Context Fabric Workbench (CHAOS-3738).
 *
 * A tester asks a question; the server hop runs a REAL ACR investigation; the
 * immutable result is rendered through the canonical inspector and the
 * deterministic answer view side by side. There is no mock path — when ACR
 * cannot answer, the failure is shown as a failure.
 */

type Outcome =
    | { readonly kind: "idle" }
    | { readonly kind: "pending" }
    | { readonly kind: "answered"; readonly result: PivotAwareInvestigationResult }
    | { readonly kind: "failed"; readonly failure: WorkbenchFailure };

// `enriched` joins this list in M3, behind its fail-closed validator.
const AVAILABLE_VIEWS: readonly WorkbenchView[] = ["raw", "deterministic"];

function isFailure(value: unknown): value is WorkbenchFailure {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { code?: unknown }).code === "string" &&
        typeof (value as { message?: unknown }).message === "string"
    );
}

export default function WorkbenchPage() {
    const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
    const [view, setView] = useState<WorkbenchView>("deterministic");
    const [askedQuestion, setAskedQuestion] = useState("");
    // The subject the tester chose, carried across the re-ask so the result can
    // be checked against it. Cleared on a fresh question: a choice belongs to
    // one re-ask, not to the session.
    const [chosenSubject, setChosenSubject] = useState<SubjectRef | undefined>(undefined);

    /**
     * Asks, optionally carrying a subject the tester chose from a previous
     * clarification.
     *
     * The question is re-sent UNCHANGED alongside the receipt. Rewriting it to
     * mention the chosen subject would make the Workbench author part of the
     * question, and ACR would then be answering something the tester never
     * asked — `prior_subject_receipts` exists precisely so the choice travels
     * as an identifier instead.
     */
    async function ask(
        question: string,
        priorSubjectReceipts: readonly ClarificationChoice[] = [],
        chosen?: SubjectRef,
        structureSelections?: StructureSelectionBatch,
    ) {
        setAskedQuestion(question);
        setChosenSubject(chosen);
        setOutcome({ kind: "pending" });
        // CHAOS-3927 P2: accumulate-and-re-ask-ONCE (design brief §2.2) — every
        // member picked in one StructureNeedsPanel session travels in this
        // SAME request, not one round-trip per member. Omitted entirely (not
        // sent as empty arrays) when nothing was selected, which is every
        // request before P1 lands acr-side: ACR does not emit `structure_needs`
        // yet, so this batch is always empty in real use today (see
        // `src/lib/pivot/structure-contracts.ts`'s "THE SEAM").
        const structureReceiptFields =
            structureSelections === undefined
                ? {}
                : buildStructureReceiptFields(structureSelections);
        try {
            const response = await fetch("/api/investigations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question, priorSubjectReceipts, ...structureReceiptFields }),
            });
            const payload: unknown = await response.json();
            const failure = (payload as { failure?: unknown }).failure;
            if (isFailure(failure)) {
                setOutcome({ kind: "failed", failure });
                return;
            }
            const result = (payload as { result?: unknown }).result;
            if (result === undefined || result === null) {
                setOutcome({
                    kind: "failed",
                    failure: {
                        code: "acr_contract_violation",
                        message: "The Workbench server returned neither a result nor a failure.",
                        retryable: false,
                    },
                });
                return;
            }
            setOutcome({ kind: "answered", result: result as PivotAwareInvestigationResult });
        } catch (error) {
            // Never swallow: a dead server hop is itself a reportable outcome.
            console.error("investigation request failed", error);
            setOutcome({
                kind: "failed",
                failure: {
                    code: "acr_unreachable",
                    message: "The Workbench server could not be reached.",
                    retryable: true,
                },
            });
        }
    }

    // Resolves the receipt to its subject at CHOICE time, while the issuing
    // result is still on screen — the only place that mapping exists.
    function chooseCandidate(choice: ClarificationChoice) {
        if (outcome.kind !== "answered") return;
        void ask(askedQuestion, [choice], subjectForReceipt(outcome.result, choice.receipt_id));
    }

    // CHAOS-3927 P2: fires the single re-ask carrying every structure member
    // the tester picked in this StructureNeedsPanel session. The subject
    // choice (if any) is a SEPARATE re-ask (chooseCandidate, above) — the two
    // flows target different refusal shapes (structure_needs appears when the
    // engine could not even narrow which census to run; subject candidates
    // appear once it can).
    function chooseStructure(batch: StructureSelectionBatch) {
        void ask(askedQuestion, [], undefined, batch);
    }

    return (
        <main className="workbench">
            <header className="workbench__masthead">
                <h1>Context Fabric Workbench</h1>
                <p>
                    Standalone answer test platform (CHAOS-3738). Platform/test scoped, separate
                    from the Ask Dev window and /dev. Read-only: it renders investigation results,
                    it does not produce them.
                </p>
            </header>

            <QuestionForm
                initialQuestion=""
                pending={outcome.kind === "pending"}
                onAsk={(question) => {
                    void ask(question);
                }}
            />

            {outcome.kind === "idle" ? (
                <p className="panel__empty">Ask a question to run an investigation.</p>
            ) : null}

            {outcome.kind === "pending" ? (
                <p className="record__meta" role="status">
                    Investigating “{askedQuestion}” …
                </p>
            ) : null}

            {outcome.kind === "failed" ? <FailurePanel failure={outcome.failure} /> : null}

            {outcome.kind === "answered" ? (
                <>
                    <div className="result__head">
                        <h2 className="result__question">{outcome.result.question}</h2>
                        <span className="badge" title={outcome.result.status}>
                            {outcome.result.status.replaceAll("_", " ")}
                        </span>
                    </div>
                    {/* The choice-not-applied notice is likewise view-independent:
                        a dishonoured choice must not become invisible because
                        the tester happened to be looking at the raw inspector.
                        Rendered here rather than inside the deterministic view,
                        which is why that view is given no chosenSubject below —
                        EnrichmentView still passes one through for its own
                        fallback. */}
                    {chosenSubject === undefined ? null : (
                        <ChoiceNotice
                            chosen={chosenSubject}
                            disposition={choiceDisposition(outcome.result, chosenSubject)}
                        />
                    )}
                    <ViewSwitcher active={view} available={AVAILABLE_VIEWS} onSelect={setView} />
                    {view === "raw" ? (
                        <>
                            {/* The clarification interaction is reachable from
                                EVERY view. The raw inspector has no answer
                                surface of its own, so the choice is rendered
                                beside it; the deterministic view renders it
                                intrinsically (see DeterministicAnswerView), so
                                adding it here too would duplicate it. Structure
                                hints/confirmation follow the same rule — read
                                straight off `result`, unlike chosenSubject
                                (client session state, threaded as a prop),
                                DeterministicAnswerView renders its OWN copy
                                from `result` directly, so nothing is passed
                                down for it here either. */}
                            <StructureConfirmationNotice
                                entries={outcome.result.confirmed_structure}
                            />
                            {outcome.result.structure_needs === undefined ? null : (
                                // Keyed by result_id — see DeterministicAnswerView's
                                // own comment on the same fix.
                                <StructureNeedsPanel
                                    key={outcome.result.result_id}
                                    onConfirm={chooseStructure}
                                    resultId={outcome.result.result_id}
                                    structureNeeds={outcome.result.structure_needs}
                                />
                            )}
                            {outcome.result.status === "clarification_required" ? (
                                <ClarificationPanel
                                    onChoose={chooseCandidate}
                                    result={outcome.result}
                                />
                            ) : null}
                            <CanonicalResultInspector result={outcome.result} />
                        </>
                    ) : (
                        <DeterministicAnswerView
                            onChooseCandidate={chooseCandidate}
                            onConfirmStructure={chooseStructure}
                            result={outcome.result}
                        />
                    )}
                </>
            ) : null}
        </main>
    );
}
