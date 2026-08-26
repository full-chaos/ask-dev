"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ChatComposer, type ChatComposerHandle } from "@/components/chat/ChatComposer";
import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { FailurePanel } from "@/components/FailurePanel";
import type { ClarificationChoice } from "@/components/ClarificationPanel";
import type { WorkbenchFailure } from "@/lib/acr/errors";
import { EMPTY_CANDIDATE_SELECTION_BATCH } from "@/lib/candidate-selections";
import { subjectForReceipt } from "@/lib/clarification";
import { buildConversationTurns } from "@/lib/conversation";
import type { ConversationTurn, InvestigationResult, SubjectRef } from "@/lib/contracts";
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
 *
 * CHAOS-4343 adds two more, both selection-first:
 *
 *  1. Selecting a candidate no longer fires immediately. `ClarificationPanel`
 *     accumulates picks (mirroring `StructureNeedsPanel`'s own "select, then
 *     confirm" discipline) and the confirm action — the thing that actually
 *     composes and sends the next request — follows the selection, never the
 *     other way around.
 *  2. Confirming N selected candidates fires N INDEPENDENT turn-2 requests,
 *     each landing as its own stacked assistant turn with its own
 *     pending/answered/failed status (`askMany` below) — not one request
 *     carrying several candidate receipts.
 *
 * Item 3 (literal kind nouns bind as an explicit receipt) needs no timeline
 * change: `literalKindNounsInQuestion` runs on every outgoing `question`
 * (fresh asks and unchanged-text re-asks alike) and rides the request as
 * `expectedKinds` — see `@/lib/kind-nouns`'s own header for why this needs no
 * ACR change.
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
          /** ISO timestamp, threaded into a later re-ask's `conversation` (see `buildConversationTurns`). */
          readonly createdAt: string;
      }
    | {
          readonly role: "assistant";
          readonly id: number;
          /** ISO timestamp, threaded into a later re-ask's `conversation` (see `buildConversationTurns`). */
          readonly createdAt: string;
          readonly outcome: AssistantOutcome;
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
           * over the shared selection hook.
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

function formatTurnTime(isoTimestamp: string): string {
    return new Date(isoTimestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Treated as "at the bottom" within this many pixels — content settling
// (fonts, an answer's own height) shifts scrollHeight by a few px even while
// a tester is genuinely pinned to the bottom.
const BOTTOM_PIN_THRESHOLD_PX = 48;

/**
 * The one place a request actually goes out over the wire, shared by `ask`
 * (one request) and `askMany` (N independent requests, CHAOS-4343 item 2) —
 * both build the SAME body shape and interpret the SAME response shape, and
 * duplicating that between them would be the two-branches-one-tested trap:
 * a fix to one would silently not apply to the other.
 *
 * Takes no turn ids and touches no timeline state: the caller owns settling
 * whichever turn(s) this outcome belongs to, which is what lets `askMany`
 * fire several of these concurrently and settle each independently as it
 * resolves, rather than waiting for the slowest.
 */
async function fireInvestigation(params: {
    readonly question: string;
    readonly priorSubjectReceipts: readonly ClarificationChoice[];
    readonly conversation: readonly ConversationTurn[];
    readonly structureReceiptFields: Record<string, unknown>;
    readonly selectionEvents: readonly PendingSelectionEvent[];
}): Promise<AssistantOutcome> {
    // CHAOS-4343 item 3: derived from the SAME `question` text this request
    // sends, every time — a fresh ask and a receipt-carrying re-ask (which
    // resends the ORIGINAL question unchanged) both get the literal-noun
    // hint consistently, with no separate call site to keep in sync.
    const expectedKinds = literalKindNounsInQuestion(params.question);
    try {
        const response = await fetch("/api/investigations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                question: params.question,
                priorSubjectReceipts: params.priorSubjectReceipts,
                conversation: params.conversation,
                ...params.structureReceiptFields,
                ...(expectedKinds.length > 0 ? { expectedKinds } : {}),
                ...(params.selectionEvents.length > 0
                    ? { structureSelectionEvents: params.selectionEvents }
                    : {}),
            }),
        });
        const payload: unknown = await response.json();
        const failure = (payload as { failure?: unknown }).failure;
        if (isFailure(failure)) {
            return { kind: "failed", failure };
        }
        const result = (payload as { result?: unknown }).result;
        if (result === undefined || result === null) {
            return {
                kind: "failed",
                failure: {
                    code: "acr_contract_violation",
                    message: "Ask Dev's server returned neither a result nor a failure.",
                    retryable: false,
                },
            };
        }
        return { kind: "answered", result: result as InvestigationResult };
    } catch (error) {
        // Never swallow: a dead server hop is itself a reportable outcome.
        console.error("investigation request failed", error);
        return {
            kind: "failed",
            failure: {
                code: "acr_unreachable",
                message: "Ask Dev's server could not be reached.",
                retryable: true,
            },
        };
    }
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
    // CHAOS-4343 items 1/2: a SEPARATE accumulator from `structureSelections`
    // above — a tester may select several distinct candidates at once, each
    // becoming its own turn-2 request, which is not the "one pick per
    // member" shape `StructureSelectionBatch` models.
    const candidateSelections = useCandidateSelections();

    const timelineRef = useRef<HTMLDivElement>(null);
    const composerRef = useRef<ChatComposerHandle>(null);
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

    function settleTurn(assistantTurnId: number, outcome: AssistantOutcome) {
        setTurns((current) =>
            current.map((turn) =>
                turn.role === "assistant" && turn.id === assistantTurnId
                    ? { ...turn, outcome }
                    : turn,
            ),
        );
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
        const isPlainAsk =
            priorSubjectReceipts.length === 0 &&
            chosen === undefined &&
            structureSelectionsToSend === undefined;
        // Captured from the CURRENT timeline, BEFORE the pending pair below
        // is appended — a re-ask's own not-yet-answered turn must never be
        // threaded as its own prior context.
        const conversation = buildConversationTurns(turns);
        structureSelections.reset();
        // A plain new ask (the common composer path) must clear any
        // unconfirmed candidate picks left over from the turn it supersedes
        // too — otherwise the NEXT result's candidate panel would open with
        // stale selections from a different result's candidates.
        candidateSelections.reset();
        const askedAt = new Date().toISOString();
        setTurns((current) => [
            ...current,
            { role: "user", id: userTurnId, question, createdAt: askedAt },
            {
                role: "assistant",
                id: assistantTurnId,
                createdAt: askedAt,
                outcome: { kind: "pending" },
                chosenSubject: chosen,
                submittedStructureBatch: undefined,
                retryQuestion: isPlainAsk ? question : undefined,
            },
        ]);

        const structureReceiptFields =
            structureSelectionsToSend === undefined
                ? {}
                : buildStructureReceiptFields(structureSelectionsToSend);
        // CHAOS-4171: every selection outcome observed since the last
        // reset() rides this SAME request — the route is the sink (see
        // `useStructureSelections`'s own `pendingSelectionEvents` header).
        // Read AFTER `structureSelections.reset()` above but still the
        // pre-reset value: `setState` schedules a re-render, it does not
        // mutate this closure's already-captured array.
        const selectionEvents = structureSelections.pendingSelectionEvents;
        const outcome = await fireInvestigation({
            question,
            priorSubjectReceipts,
            conversation,
            structureReceiptFields,
            selectionEvents,
        });
        settleTurn(assistantTurnId, outcome);
        return outcome.kind === "answered";
    }

    /**
     * CHAOS-4343 item 2: fires N independent turn-2 requests, one per
     * confirmed candidate selection, each landing as its OWN stacked
     * assistant turn with its own pending/answered/failed status — never one
     * request carrying several candidate receipts, and never blocked on the
     * others (each settles the moment ITS OWN response arrives).
     *
     * The question is appended as a SINGLE user turn shared by every fired
     * request below it — it is the identical, unchanged text on every one of
     * them (same "the question travels unchanged" rule `ask()` holds), so
     * repeating it once per candidate would only look like N separate things
     * were asked when exactly one was.
     */
    function askMany(
        question: string,
        choices: readonly ClarificationChoice[],
        chosenSubjects: readonly (SubjectRef | undefined)[],
        structureSelectionsToSend?: StructureSelectionBatch,
    ): void {
        if (choices.length === 0) return;
        const conversation = buildConversationTurns(turns);
        structureSelections.reset();
        candidateSelections.reset();
        const askedAt = new Date().toISOString();

        const structureReceiptFields =
            structureSelectionsToSend === undefined
                ? {}
                : buildStructureReceiptFields(structureSelectionsToSend);
        // Both selection hooks' queued outcomes belong to this ONE tester
        // action (picking N candidates, optionally alongside a structure
        // pick) — emitted once, on the first of the N fired requests below,
        // never once per request: N identical telemetry events would
        // overcount one action as N (see the per-request comment below).
        const selectionEvents = [
            ...structureSelections.pendingSelectionEvents,
            ...candidateSelections.pendingSelectionEvents,
        ];

        const userTurnId = nextId.current++;
        const assistantTurns = choices.map((choice, index) => ({
            id: nextId.current++,
            choice,
            chosenSubject: chosenSubjects[index],
        }));

        setTurns((current) => [
            ...current,
            { role: "user", id: userTurnId, question, createdAt: askedAt },
            ...assistantTurns.map(({ id, chosenSubject }) => ({
                role: "assistant" as const,
                id,
                createdAt: askedAt,
                outcome: { kind: "pending" as const },
                chosenSubject,
                submittedStructureBatch: undefined,
                retryQuestion: undefined,
            })),
        ]);

        assistantTurns.forEach(({ id, choice }, index) => {
            void fireInvestigation({
                question,
                priorSubjectReceipts: [choice],
                conversation,
                structureReceiptFields,
                selectionEvents: index === 0 ? selectionEvents : EMPTY_SELECTION_EVENTS,
            }).then((outcome) => {
                settleTurn(id, outcome);
            });
        });
    }

    const latestAssistantTurn = [...turns].reverse().find((turn) => turn.role === "assistant");

    function chooseCandidates(choices: readonly ClarificationChoice[]) {
        if (
            latestAssistantTurn?.role !== "assistant" ||
            latestAssistantTurn.outcome.kind !== "answered" ||
            choices.length === 0
        ) {
            return;
        }
        const { result } = latestAssistantTurn.outcome;
        // Mixed-receipt-family unification: a response can carry BOTH subject
        // candidates and a structure_needs disclosure at once. Any structure
        // picks the tester already made in this SAME turn — accumulated but
        // not yet confirmed — must travel alongside EVERY fired candidate
        // request, or `askMany()` resetting the shared selection hook below
        // would silently drop them.
        const pendingStructureBatch = pendingStructureBatchOrUndefined(structureSelections.batch);
        if (pendingStructureBatch !== undefined) {
            // Snapshotted BEFORE `askMany()` resets the shared hook and
            // appends new turns, same reason `chooseStructure` below does —
            // otherwise this turn's own frozen echo would render as if
            // nothing had ever been picked (codex review round 1, finding 3).
            const supersededTurnId = latestAssistantTurn.id;
            setTurns((current) =>
                current.map((turn) =>
                    turn.role === "assistant" && turn.id === supersededTurnId
                        ? { ...turn, submittedStructureBatch: pendingStructureBatch }
                        : turn,
                ),
            );
        }
        const chosenSubjects = choices.map((choice) =>
            subjectForReceipt(result, choice.receipt_id),
        );
        askMany(result.question, choices, chosenSubjects, pendingStructureBatch);
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
                                            You · {formatTurnTime(turn.createdAt)}
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
                                        Ask Dev · {formatTurnTime(turn.createdAt)}
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
                                                          // Through the composer's OWN submit
                                                          // path (draft-clear-on-success,
                                                          // preserve-and-select-on-failure) —
                                                          // never `ask()` directly, which would
                                                          // leave the composer showing stale,
                                                          // already-answered text after a
                                                          // successful retry (codex review
                                                          // round 2).
                                                          composerRef.current?.retry(
                                                              turn.retryQuestion!,
                                                          );
                                                      }
                                                    : undefined
                                            }
                                        />
                                    ) : null}
                                    {turn.outcome.kind === "answered" ? (
                                        <DeterministicAnswerView
                                            chosenSubject={turn.chosenSubject}
                                            onConfirmCandidates={
                                                isLatest ? chooseCandidates : undefined
                                            }
                                            onConfirmStructure={
                                                isLatest ? chooseStructure : undefined
                                            }
                                            onRejectStructure={
                                                isLatest ? structureSelections.reject : undefined
                                            }
                                            onToggleCandidate={
                                                isLatest ? candidateSelections.toggle : undefined
                                            }
                                            onToggleStructure={
                                                isLatest ? structureSelections.toggle : undefined
                                            }
                                            result={turn.outcome.result}
                                            selectedCandidateReceiptIds={
                                                isLatest
                                                    ? candidateSelections.batch
                                                    : EMPTY_CANDIDATE_SELECTION_BATCH
                                            }
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
                <ChatComposer pending={isPending} onAsk={ask} ref={composerRef} />
            </div>
        </main>
    );
}
