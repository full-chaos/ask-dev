"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ChatComposer } from "@/components/chat/ChatComposer";
import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { FailurePanel } from "@/components/FailurePanel";
import type { ClarificationChoice } from "@/components/ClarificationPanel";
import type { WorkbenchFailure } from "@/lib/acr/errors";
import { subjectForReceipt } from "@/lib/clarification";
import type { InvestigationResult, SubjectRef } from "@/lib/contracts";
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
 *
 * UX-equivalence pass adds, all presentation-only: a real timestamp/role
 * label per turn, pin-to-bottom autoscroll with a scroll-away override and a
 * "Jump to latest" affordance (`timelineRef`/`isPinnedToBottom`/
 * `hasUnseenBelow` below), and a Retry action on a FAILED plain ask (never on
 * a receipt-carrying re-ask — that stays this lane's boundary, not
 * presentation's).
 */

type AssistantOutcome =
    | { readonly kind: "pending" }
    | { readonly kind: "answered"; readonly result: InvestigationResult }
    | { readonly kind: "failed"; readonly failure: WorkbenchFailure };

type Turn =
    | {
          readonly role: "user";
          readonly id: number;
          readonly question: string;
          readonly askedAt: number;
      }
    | {
          readonly role: "assistant";
          readonly id: number;
          readonly outcome: AssistantOutcome;
          readonly askedAt: number;
          /** The subject the tester chose, when this turn answers a re-ask that carried one. */
          readonly chosenSubject: SubjectRef | undefined;
          /**
           * A SNAPSHOT of the structure-need batch this turn's own "Ask
           * again with these selections" confirmed, if it ever did —
           * distinct from `useStructureSelections()`'s live `batch`, which
           * this turn stops owning the instant it is no longer the latest
           * (codex review round 1, finding 3). Without this, a frozen
           * turn's own `StructureNeedsPanel` echo would render EMPTY rather
           * than what was actually submitted, the moment a newer turn takes
           * over the shared hook.
           */
          readonly submittedStructureBatch: StructureSelectionBatch | undefined;
          /**
           * The exact question to retry, set ONLY when this turn came from a
           * plain composer ask (no prior receipts, no chosen subject, no
           * structure batch). A receipt-carrying re-ask is never retried
           * from the failure panel — re-deriving which receipts to resend is
           * this lane's boundary, not presentation's, so that turn's
           * `FailurePanel` gets no retry action at all.
           */
          readonly retryQuestion: string | undefined;
      };

function isFailure(value: unknown): value is WorkbenchFailure {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { code?: unknown }).code === "string" &&
        typeof (value as { message?: unknown }).message === "string"
    );
}

function formatTurnTime(epochMs: number): string {
    return new Date(epochMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Treated as "at the bottom" within this many pixels — content settling
// (fonts, an answer's own height) shifts scrollHeight by a few px even while
// a tester is genuinely pinned to the bottom.
const BOTTOM_PIN_THRESHOLD_PX = 48;

export default function ChatPage() {
    const [turns, setTurns] = useState<readonly Turn[]>([]);
    // A monotonic counter, not crypto.randomUUID(): turn identity only needs
    // to be unique within this session, and a counter keeps the ask/settle
    // pairing trivially traceable in a debugger.
    const nextId = useRef(0);
    // Portable P2 hook (CHAOS-3927), consumed exactly as the Workbench
    // consumes it: one instance, reset on every fresh ask().
    const structureSelections = useStructureSelections();

    const timelineRef = useRef<HTMLDivElement>(null);
    const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
    const [hasUnseenBelow, setHasUnseenBelow] = useState(false);
    // Mirrors `turns` so the block below can tell "new content just landed"
    // apart from an ordinary re-render, and adjust derived state DURING
    // render rather than in an effect (react-hooks/set-state-in-effect: an
    // effect may only SYNC WITH the DOM — the scrollTop write below — never
    // call a state setter itself; this is React's own documented escape
    // hatch for "adjusting state when a value changes").
    const [syncedTurns, setSyncedTurns] = useState(turns);
    if (turns !== syncedTurns) {
        setSyncedTurns(turns);
        // A settle() (pending -> answered/failed) changes this array's
        // identity exactly like a brand new turn does, and both can grow
        // the timeline's height — so both count as "new content" here.
        if (!isPinnedToBottom) {
            setHasUnseenBelow(true);
        }
    }

    const isPending = turns.some(
        (turn) => turn.role === "assistant" && turn.outcome.kind === "pending",
    );

    // Autoscroll: follows the conversation while the tester is at (or near)
    // the bottom. This effect only WRITES TO THE DOM (scrollTop) — it never
    // calls a state setter, which is what keeps it clear of
    // react-hooks/set-state-in-effect; `hasUnseenBelow` is adjusted above,
    // during render, instead.
    useEffect(() => {
        const el = timelineRef.current;
        if (el === null || !isPinnedToBottom) return;
        el.scrollTop = el.scrollHeight;
    }, [turns, isPinnedToBottom]);

    function handleTimelineScroll() {
        const el = timelineRef.current;
        if (el === null) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        const pinned = distanceFromBottom <= BOTTOM_PIN_THRESHOLD_PX;
        setIsPinnedToBottom(pinned);
        if (pinned) setHasUnseenBelow(false);
    }

    function jumpToLatest() {
        const el = timelineRef.current;
        if (el !== null) el.scrollTop = el.scrollHeight;
        setIsPinnedToBottom(true);
        setHasUnseenBelow(false);
    }

    /**
     * Appends a user turn and a pending assistant turn, then settles the
     * assistant turn in place once the server hop answers. Mirrors the
     * Workbench's own `ask()` (same request shape, same failure mapping) —
     * see that component for why the question travels UNCHANGED alongside a
     * chosen receipt rather than being rewritten to mention it.
     *
     * Returns whether the turn answered (`true`) or failed (`false`), so the
     * composer can decide whether to clear its draft — the only thing that
     * return value is for.
     */
    async function ask(
        question: string,
        priorSubjectReceipts: readonly ClarificationChoice[] = [],
        chosen?: SubjectRef,
        structureSelectionsToSend?: StructureSelectionBatch,
    ): Promise<boolean> {
        const userTurnId = nextId.current++;
        const assistantTurnId = nextId.current++;
        // `ask` only ever runs from a DOM event (composer submit, a chip's
        // onClick) — this stamps that event, it is not a render-time read.
        // eslint-disable-next-line react-hooks/purity -- event-driven timestamp, not a render read
        const askedAt = Date.now();
        const isPlainAsk =
            priorSubjectReceipts.length === 0 &&
            chosen === undefined &&
            structureSelectionsToSend === undefined;
        structureSelections.reset();
        setTurns((current) => [
            ...current,
            { role: "user", id: userTurnId, question, askedAt },
            {
                role: "assistant",
                id: assistantTurnId,
                outcome: { kind: "pending" },
                askedAt,
                chosenSubject: chosen,
                submittedStructureBatch: undefined,
                retryQuestion: isPlainAsk ? question : undefined,
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
                return false;
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
                return false;
            }
            settle({ kind: "answered", result: result as InvestigationResult });
            return true;
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
            return false;
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
        // Snapshot what was actually submitted onto the turn being
        // superseded BEFORE `ask()` resets the shared hook and appends a
        // new turn — otherwise this turn's own frozen echo would render as
        // if nothing had ever been picked (codex review round 1, finding 3).
        const supersededTurnId = latestAssistantTurn.id;
        setTurns((current) =>
            current.map((turn) =>
                turn.role === "assistant" && turn.id === supersededTurnId
                    ? { ...turn, submittedStructureBatch: batch }
                    : turn,
            ),
        );
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

            <div className="chat__timeline-wrap">
                <div
                    aria-label="Conversation"
                    className="chat__timeline"
                    role="log"
                    aria-live="polite"
                    onScroll={handleTimelineScroll}
                    ref={timelineRef}
                >
                    {turns.length === 0 ? (
                        <p className="chat__empty">Ask a question to start an investigation.</p>
                    ) : (
                        turns.map((turn) => {
                            if (turn.role === "user") {
                                return (
                                    <div className="chat__turn chat__turn--user" key={turn.id}>
                                        <p className="chat__meta chat__meta--user">
                                            You · {formatTurnTime(turn.askedAt)}
                                        </p>
                                        <p className="chat__bubble">{turn.question}</p>
                                    </div>
                                );
                            }

                            const isLatest = turn.id === latestAssistantTurn?.id;

                            return (
                                <div
                                    className={
                                        isLatest
                                            ? "chat__turn chat__turn--assistant"
                                            : "chat__turn chat__turn--assistant chat__turn--frozen"
                                    }
                                    key={turn.id}
                                >
                                    <p className="chat__meta">
                                        Ask Dev · {formatTurnTime(turn.askedAt)}
                                    </p>
                                    {turn.outcome.kind === "pending" ? (
                                        <p className="chat__pending" role="status">
                                            Investigating…
                                        </p>
                                    ) : null}
                                    {turn.outcome.kind === "failed" ? (
                                        <FailurePanel
                                            failure={turn.outcome.failure}
                                            pending={isPending}
                                            onRetry={
                                                isLatest &&
                                                turn.retryQuestion !== undefined &&
                                                turn.outcome.failure.retryable
                                                    ? () => {
                                                          void ask(turn.retryQuestion!);
                                                      }
                                                    : undefined
                                            }
                                        />
                                    ) : null}
                                    {turn.outcome.kind === "answered" ? (
                                        <DeterministicAnswerView
                                            chosenSubject={turn.chosenSubject}
                                            onChooseCandidate={
                                                isLatest ? chooseCandidate : undefined
                                            }
                                            onConfirmStructure={
                                                isLatest ? chooseStructure : undefined
                                            }
                                            onToggleStructure={
                                                isLatest ? structureSelections.toggle : undefined
                                            }
                                            result={turn.outcome.result}
                                            structureBatch={
                                                isLatest
                                                    ? structureSelections.batch
                                                    : turn.submittedStructureBatch
                                            }
                                        />
                                    ) : null}
                                </div>
                            );
                        })
                    )}
                </div>
                {hasUnseenBelow ? (
                    <button className="chat__jump-to-latest" onClick={jumpToLatest} type="button">
                        Jump to latest ↓
                    </button>
                ) : null}
            </div>

            <div className="chat__composer-bar">
                <ChatComposer pending={isPending} onAsk={ask} />
            </div>
        </main>
    );
}
