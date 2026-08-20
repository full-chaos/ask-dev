"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { ChatComposer } from "@/components/chat/ChatComposer";
import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { FailurePanel } from "@/components/FailurePanel";
import type { ClarificationChoice } from "@/components/ClarificationPanel";
import type { WorkbenchFailure } from "@/lib/acr/errors";
import { subjectForReceipt } from "@/lib/clarification";
import type { PivotAwareInvestigationResult, SubjectRef } from "@/lib/contracts";
import {
    buildStructureReceiptFields,
    type StructureSelectionBatch,
} from "@/lib/structure-selections";
import { useStructureSelections } from "@/lib/use-structure-selections";

/**
 * Ask Dev — the chat surface (chat pivot, Phase 1).
 *
 * The Workbench (`/workbench`) is a panel-stack shell chris has declared
 * TEMPORARY; this is the target UX — a Claude/ChatGPT-style conversation:
 * a growing timeline of user/assistant turns and a composer at the bottom.
 * It calls the SAME server hop the Workbench does (`/api/investigations`),
 * which calls the real ACR investigation API — there is no mock path here
 * either (CHAOS-3738's hard boundary holds for every surface, not just the
 * Workbench).
 *
 * Every assistant turn is rendered with `DeterministicAnswerView` UNCHANGED
 * from the Workbench — it already composes the answer, the subject
 * clarification prompt, and the P2 structure-need offers
 * (`StructureNeedsPanel`/`StructureConfirmationNotice`) as one unit, which is
 * exactly the portability those components were built for. Nothing here
 * reimplements that composition; the "clarification chips" a chat turn shows
 * ARE those components, mounted as-is.
 *
 * Only the MOST RECENT assistant turn is "live": asking again always appends
 * a new turn rather than mutating an old one, so an older turn's chips (if
 * it had any) are handed no callback and render as the read-only echoes
 * `ClarificationPanel`/`StructureNeedsPanel` already support — the same rule
 * that keeps a frozen chat transcript from looking like it can still be
 * acted on.
 */

type AssistantOutcome =
    | { readonly kind: "pending" }
    | { readonly kind: "answered"; readonly result: PivotAwareInvestigationResult }
    | { readonly kind: "failed"; readonly failure: WorkbenchFailure };

type Turn =
    | { readonly role: "user"; readonly id: number; readonly question: string }
    | {
          readonly role: "assistant";
          readonly id: number;
          readonly outcome: AssistantOutcome;
          /** The subject the tester chose, when this turn answers a re-ask that carried one. */
          readonly chosenSubject: SubjectRef | undefined;
      };

function isFailure(value: unknown): value is WorkbenchFailure {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { code?: unknown }).code === "string" &&
        typeof (value as { message?: unknown }).message === "string"
    );
}

export default function ChatPage() {
    const [turns, setTurns] = useState<readonly Turn[]>([]);
    // A monotonic counter, not crypto.randomUUID(): turn identity only needs
    // to be unique within this session, and a counter keeps the ask/settle
    // pairing trivially traceable in a debugger.
    const nextId = useRef(0);
    // Portable P2 hook (CHAOS-3927), consumed exactly as the Workbench
    // consumes it: one instance, reset on every fresh ask().
    const structureSelections = useStructureSelections();

    const isPending = turns.some(
        (turn) => turn.role === "assistant" && turn.outcome.kind === "pending",
    );

    /**
     * Appends a user turn and a pending assistant turn, then settles the
     * assistant turn in place once the server hop answers. Mirrors the
     * Workbench's own `ask()` (same request shape, same failure mapping) —
     * see that component for why the question travels UNCHANGED alongside a
     * chosen receipt rather than being rewritten to mention it.
     */
    async function ask(
        question: string,
        priorSubjectReceipts: readonly ClarificationChoice[] = [],
        chosen?: SubjectRef,
        structureSelectionsToSend?: StructureSelectionBatch,
    ) {
        const userTurnId = nextId.current++;
        const assistantTurnId = nextId.current++;
        structureSelections.reset();
        setTurns((current) => [
            ...current,
            { role: "user", id: userTurnId, question },
            {
                role: "assistant",
                id: assistantTurnId,
                outcome: { kind: "pending" },
                chosenSubject: chosen,
            },
        ]);

        function settle(outcome: AssistantOutcome) {
            setTurns((current) =>
                current.map((turn) =>
                    turn.role === "assistant" && turn.id === assistantTurnId
                        ? { ...turn, outcome }
                        : turn,
                ),
            );
        }

        const structureReceiptFields =
            structureSelectionsToSend === undefined
                ? {}
                : buildStructureReceiptFields(structureSelectionsToSend);
        try {
            const response = await fetch("/api/investigations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question, priorSubjectReceipts, ...structureReceiptFields }),
            });
            const payload: unknown = await response.json();
            const failure = (payload as { failure?: unknown }).failure;
            if (isFailure(failure)) {
                settle({ kind: "failed", failure });
                return;
            }
            const result = (payload as { result?: unknown }).result;
            if (result === undefined || result === null) {
                settle({
                    kind: "failed",
                    failure: {
                        code: "acr_contract_violation",
                        message: "Ask Dev's server returned neither a result nor a failure.",
                        retryable: false,
                    },
                });
                return;
            }
            settle({ kind: "answered", result: result as PivotAwareInvestigationResult });
        } catch (error) {
            // Never swallow: a dead server hop is itself a reportable outcome.
            console.error("investigation request failed", error);
            settle({
                kind: "failed",
                failure: {
                    code: "acr_unreachable",
                    message: "Ask Dev's server could not be reached.",
                    retryable: true,
                },
            });
        }
    }

    const latestAssistantTurn = [...turns].reverse().find((turn) => turn.role === "assistant");

    function chooseCandidate(choice: ClarificationChoice) {
        if (
            latestAssistantTurn?.role !== "assistant" ||
            latestAssistantTurn.outcome.kind !== "answered"
        ) {
            return;
        }
        const { result } = latestAssistantTurn.outcome;
        void ask(result.question, [choice], subjectForReceipt(result, choice.receipt_id));
    }

    function chooseStructure(batch: StructureSelectionBatch) {
        if (
            latestAssistantTurn?.role !== "assistant" ||
            latestAssistantTurn.outcome.kind !== "answered"
        ) {
            return;
        }
        void ask(latestAssistantTurn.outcome.result.question, [], undefined, batch);
    }

    return (
        <main className="chat">
            <header className="chat__header">
                <h1>Ask Dev</h1>
                <p>Ask a real question about a project, a repository, or a team.</p>
                <Link className="chat__workbench-link" href="/workbench">
                    Context Fabric Workbench →
                </Link>
            </header>

            <div aria-label="Conversation" className="chat__timeline" role="log" aria-live="polite">
                {turns.length === 0 ? (
                    <p className="chat__empty">Ask a question to start an investigation.</p>
                ) : (
                    turns.map((turn) => {
                        if (turn.role === "user") {
                            return (
                                <div className="chat__turn chat__turn--user" key={turn.id}>
                                    <p className="chat__bubble">{turn.question}</p>
                                </div>
                            );
                        }

                        const isLatest = turn.id === latestAssistantTurn?.id;

                        return (
                            <div className="chat__turn chat__turn--assistant" key={turn.id}>
                                {turn.outcome.kind === "pending" ? (
                                    <p className="chat__pending" role="status">
                                        Investigating…
                                    </p>
                                ) : null}
                                {turn.outcome.kind === "failed" ? (
                                    <FailurePanel failure={turn.outcome.failure} />
                                ) : null}
                                {turn.outcome.kind === "answered" ? (
                                    <DeterministicAnswerView
                                        chosenSubject={turn.chosenSubject}
                                        onChooseCandidate={isLatest ? chooseCandidate : undefined}
                                        onConfirmStructure={isLatest ? chooseStructure : undefined}
                                        onToggleStructure={
                                            isLatest ? structureSelections.toggle : undefined
                                        }
                                        result={turn.outcome.result}
                                        structureBatch={
                                            isLatest ? structureSelections.batch : undefined
                                        }
                                    />
                                ) : null}
                            </div>
                        );
                    })
                )}
            </div>

            <div className="chat__composer-bar">
                <ChatComposer
                    pending={isPending}
                    onAsk={(question) => {
                        void ask(question);
                    }}
                />
            </div>
        </main>
    );
}
