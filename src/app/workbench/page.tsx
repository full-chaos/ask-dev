"use client";

import Link from "next/link";
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
import type { BoundStructureReceipt, InvestigationResult, SubjectRef } from "@/lib/contracts";
import { literalKindNounsInQuestion } from "@/lib/kind-nouns";
import {
    buildStructureReceiptFields,
    EMPTY_SELECTION_EVENTS,
    pendingStructureBatchOrUndefined,
    type PendingSelectionEvent,
    type StructureSelectionBatch,
} from "@/lib/structure-selections";
import { useCandidateSelections } from "@/lib/use-candidate-selections";
import { useStructureSelections } from "@/lib/use-structure-selections";

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
    | { readonly kind: "answered"; readonly result: InvestigationResult }
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
    // CHAOS-3927 P2, codex round 3 + portability (team-lead): owned by a
    // portable hook, not inline page state — `useStructureSelections` is
    // the ENTIRE dependency a future conversational surface needs to mount
    // StructureNeedsPanel under a chat turn. Shared across BOTH render
    // sites below so a pick made in one view survives a switch to the
    // other (the same "reachable from every view" rule ClarificationPanel
    // already holds for the subject choice). Reset on every fresh ask(),
    // same as chosenSubject: a selection belongs to one result, not to the
    // session.
    const structureSelections = useStructureSelections();
    // CHAOS-4343 items 1/2: multi-select accumulator for candidate picks.
    // The Workbench keeps only ONE `outcome` slot (unlike the chat surface's
    // growing timeline), so it cannot show N stacked result panels — that is
    // the chat surface's job, the one this ticket calls "the target UX" and
    // page.tsx's own doc comment already declares this shell TEMPORARY.
    // Confirming N selections here fires one request per selection,
    // sequentially, and displays only whichever answers last; it is an
    // honest limitation of this single-outcome shell, not a silent drop —
    // multi-select fan-out belongs to the chat surface (`src/app/page.tsx`).
    const candidateSelections = useCandidateSelections();
    // The `structure_needs.candidate_options` twin of `candidateSelections`
    // above — a separate wire field/receipt namespace (CHAOS-4012), same
    // sequential-fan-out limitation for this single-outcome shell.
    const structureCandidateSelections = useCandidateSelections();

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
        structureSelectionsToSend?: StructureSelectionBatch,
        // The COMPLETE set of selection-outcome telemetry to emit with THIS
        // request, computed by the CALLER (codex review round 2): `ask()`
        // itself must never read a selection hook's `pendingSelectionEvents`
        // directly, because `chooseCandidates`/`chooseStructure` below call
        // this SAME function repeatedly from within one sequential loop —
        // every call after the first reuses THIS closure's already-captured
        // hook references, so `.reset()` (also called below) never actually
        // empties what THIS closure sees on a later iteration, and reading
        // the hook again here would resend the identical telemetry once per
        // fired request instead of once per tester action.
        selectionEvents: readonly PendingSelectionEvent[] = EMPTY_SELECTION_EVENTS,
    ) {
        setAskedQuestion(question);
        setChosenSubject(chosen);
        structureSelections.reset();
        // Same reason `structureSelections.reset()` runs on every ask(): a
        // plain new question (or a structure-only re-ask) must not leave a
        // stale candidate selection open against a result it no longer
        // matches. `chooseCandidates` already reset this hook itself before
        // calling `ask()` in its own loop, so this is a no-op there.
        candidateSelections.reset();
        structureCandidateSelections.reset();
        setOutcome({ kind: "pending" });
        // CHAOS-3927 P2: accumulate-and-re-ask-ONCE (design brief §2.2) — every
        // member picked in one StructureNeedsPanel session travels in this
        // SAME request, not one round-trip per member. Omitted entirely (not
        // sent as empty arrays) when nothing was selected — wire minimization,
        // not a correctness requirement now that THE SEAM has landed (acr
        // 7d275c2e; see `@/lib/contracts`'s own header): `structure_needs`
        // is a real field on the pinned contract, so this batch is non-empty
        // exactly when a tester has actually made a selection.
        const structureReceiptFields =
            structureSelectionsToSend === undefined
                ? {}
                : buildStructureReceiptFields(structureSelectionsToSend);
        // CHAOS-4343 item 3: derived from the SAME `question` this request
        // sends — a re-ask resends the ORIGINAL question unchanged, so this
        // stays consistent with whatever hint fired on the first ask.
        const expectedKinds = literalKindNounsInQuestion(question);
        try {
            const response = await fetch("/api/investigations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    question,
                    priorSubjectReceipts,
                    ...structureReceiptFields,
                    ...(expectedKinds.length > 0 ? { expectedKinds } : {}),
                    ...(selectionEvents.length > 0
                        ? { structureSelectionEvents: selectionEvents }
                        : {}),
                }),
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
            setOutcome({ kind: "answered", result: result as InvestigationResult });
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

    // Resolves the receipt to its subject at CONFIRM time, while the issuing
    // result is still on screen — the only place that mapping exists.
    //
    // Mixed-receipt-family unification: a response can carry BOTH subject
    // candidates and a structure_needs disclosure at once. Any structure
    // picks the tester already made for THIS result — accumulated but not
    // yet confirmed — must travel along, or `ask()` resetting the shared
    // selection hook below would silently drop them.
    //
    // CHAOS-4343 items 1/2: confirming fires one request PER selected
    // candidate, sequentially (awaited in order, so the LAST one settles
    // last and is what ends up on screen) — see this page's own
    // `candidateSelections` doc comment for why the Workbench does not fan
    // these out into side-by-side panels the way the chat surface does.
    async function chooseCandidates(choices: readonly ClarificationChoice[]) {
        if (outcome.kind !== "answered" || choices.length === 0) return;
        const { result } = outcome;
        const structureBatch = pendingStructureBatchOrUndefined(structureSelections.batch);
        // Mixed-receipt-family unification (codex review round 2): a
        // pending-but-unconfirmed STRUCTURE-candidate pick must ride along
        // too, not just the ordinary kind/anchor/handle/window batch — same
        // reason the chat surface's own `chooseCandidates` folds in
        // `structureCandidateSelections`.
        const pendingStructureCandidateReceipts = (result.structure_needs?.candidate_options ?? [])
            .filter((option) => structureCandidateSelections.batch.has(option.receipt_id))
            .map((option) => ({ result_id: result.result_id, receipt_id: option.receipt_id }));
        // Captured ONCE, synchronously, before any `.reset()` — `ask()` no
        // longer reads these hooks itself (codex review round 2: it used to,
        // which replayed the SAME pre-reset telemetry on every iteration of
        // this loop, since every call below reuses THIS closure's `ask`
        // reference — see `ask()`'s own parameter doc comment).
        const selectionEvents = [
            ...structureSelections.pendingSelectionEvents,
            ...candidateSelections.pendingSelectionEvents,
            ...structureCandidateSelections.pendingSelectionEvents,
        ];
        structureCandidateSelections.reset();
        let index = 0;
        for (const choice of choices) {
            await ask(
                askedQuestion,
                [choice],
                subjectForReceipt(result, choice.receipt_id),
                structureBatch,
                index === 0 ? selectionEvents : EMPTY_SELECTION_EVENTS,
            );
            index += 1;
        }
        for (const receipt of pendingStructureCandidateReceipts) {
            await ask(
                askedQuestion,
                [],
                undefined,
                { ...structureBatch, subject_candidate: receipt },
                index === 0 ? selectionEvents : EMPTY_SELECTION_EVENTS,
            );
            index += 1;
        }
    }

    // CHAOS-3927 P2: fires the re-ask(s) carrying every structure member
    // the tester picked in this StructureNeedsPanel session. The subject
    // choice (if any) is a SEPARATE re-ask (chooseCandidate, above) — the two
    // flows target different refusal shapes (structure_needs appears when the
    // engine could not even narrow which census to run; subject candidates
    // appear once it can).
    //
    // CHAOS-4343 items 1/2: `candidateReceipts` is every currently-selected
    // `structure_needs.candidate_options` entry. Empty in the ordinary case
    // (one re-ask carrying `batch`, unchanged from before); non-empty fires
    // one request PER entry, sequentially — same single-outcome-shell
    // limitation `chooseCandidates` above documents.
    async function chooseStructure(
        batch: StructureSelectionBatch,
        candidateReceipts: readonly BoundStructureReceipt[] = [],
    ) {
        if (outcome.kind !== "answered") return;
        const { result } = outcome;
        // Mixed-receipt-family unification (codex review round 2): a
        // pending-but-unconfirmed SUBJECT-candidate pick must ride along
        // too — same reason `chooseCandidates` above folds in the structure
        // axis.
        const pendingSubjectChoices = result.subject_resolution.candidates
            .filter((candidate) => candidateSelections.batch.has(candidate.receipt_id))
            .map((candidate) => ({
                result_id: result.result_id,
                receipt_id: candidate.receipt_id,
            }));

        // Captured ONCE, synchronously, before any `.reset()` — see `ask()`'s
        // own parameter doc comment for why it can't safely read these hooks
        // itself across this loop's repeated calls.
        const selectionEvents = [
            ...structureSelections.pendingSelectionEvents,
            ...candidateSelections.pendingSelectionEvents,
            ...structureCandidateSelections.pendingSelectionEvents,
        ];

        if (candidateReceipts.length === 0 && pendingSubjectChoices.length === 0) {
            await ask(askedQuestion, [], undefined, batch, selectionEvents);
            return;
        }
        candidateSelections.reset();
        let index = 0;
        for (const receipt of candidateReceipts) {
            await ask(
                askedQuestion,
                [],
                undefined,
                { ...batch, subject_candidate: receipt },
                index === 0 ? selectionEvents : EMPTY_SELECTION_EVENTS,
            );
            index += 1;
        }
        for (const choice of pendingSubjectChoices) {
            await ask(
                askedQuestion,
                [choice],
                subjectForReceipt(result, choice.receipt_id),
                batch,
                index === 0 ? selectionEvents : EMPTY_SELECTION_EVENTS,
            );
            index += 1;
        }
    }

    return (
        <main className="workbench">
            <header className="workbench__masthead">
                <Link className="workbench__back-link" href="/">
                    ← Ask Dev
                </Link>
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
                    // Captured explicitly (codex review round 2): a plain new
                    // question must not silently drop telemetry for a
                    // candidate the tester toggled but never confirmed.
                    const selectionEvents = [
                        ...structureSelections.pendingSelectionEvents,
                        ...candidateSelections.pendingSelectionEvents,
                        ...structureCandidateSelections.pendingSelectionEvents,
                    ];
                    void ask(question, [], undefined, undefined, selectionEvents);
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
                                // own comment on the same fix. `batch`/`onToggle`
                                // are the SAME shared state DeterministicAnswerView's
                                // own instance uses, so a pick here survives a
                                // switch to the deterministic view.
                                <StructureNeedsPanel
                                    key={outcome.result.result_id}
                                    batch={structureSelections.batch}
                                    onConfirm={(batch, candidateReceipts) => {
                                        void chooseStructure(batch, candidateReceipts);
                                    }}
                                    onReject={structureSelections.reject}
                                    onToggle={structureSelections.toggle}
                                    onToggleCandidate={structureCandidateSelections.toggle}
                                    resultId={outcome.result.result_id}
                                    selectedCandidateReceiptIds={structureCandidateSelections.batch}
                                    structureNeeds={outcome.result.structure_needs}
                                />
                            )}
                            {outcome.result.status === "clarification_required" ? (
                                <ClarificationPanel
                                    onConfirm={(choices) => {
                                        void chooseCandidates(choices);
                                    }}
                                    onToggle={candidateSelections.toggle}
                                    result={outcome.result}
                                    selectedReceiptIds={candidateSelections.batch}
                                />
                            ) : null}
                            <CanonicalResultInspector result={outcome.result} />
                        </>
                    ) : (
                        <DeterministicAnswerView
                            onConfirmCandidates={(choices) => {
                                void chooseCandidates(choices);
                            }}
                            onConfirmStructure={(batch, candidateReceipts) => {
                                void chooseStructure(batch, candidateReceipts);
                            }}
                            onRejectStructure={structureSelections.reject}
                            onToggleCandidate={candidateSelections.toggle}
                            onToggleStructure={structureSelections.toggle}
                            onToggleStructureCandidate={structureCandidateSelections.toggle}
                            result={outcome.result}
                            selectedCandidateReceiptIds={candidateSelections.batch}
                            selectedStructureCandidateReceiptIds={
                                structureCandidateSelections.batch
                            }
                            structureBatch={structureSelections.batch}
                        />
                    )}
                </>
            ) : null}
        </main>
    );
}
