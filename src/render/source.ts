/**
 * The data seam of Ask Dev's render (CHAOS-12382; CHAOS-12378 part B1).
 *
 * One render of Ask Dev exists, here in ask-dev. `AskDevChat` reads its conversation from a
 * `ChatSource` and asks through it; it never builds a request body and never calls the network
 * itself. The standalone app passes no source and gets `createStandaloneSource()` (today's
 * `/api/investigations` behaviour, moved out of the component). A host such as web passes its own
 * source, driven by its own store, and gets the same render.
 *
 * What stays in the component is UI state only: the selection hooks, the clarification popup's
 * dismissal and auto-confirm, scroll pinning, the composer, the rails. What a source owns is the
 * turns and the wire.
 *
 * This file holds types and small pure helpers. It imports React only as a type.
 */
import type { ReactNode } from "react";

import type { ClarificationChoice } from "../components/ClarificationPanel";
import type { WorkbenchFailure } from "../lib/acr/errors";
import type { InvestigationResult, SubjectRef } from "../lib/contracts";
import type { RankingWithheld } from "../lib/ranking-withheld";
import type { PendingSelectionEvent, StructureSelectionBatch } from "../lib/structure-selections";

/** ACR's investigation stages, in the one order a run reports them. */
export const INVESTIGATION_STAGES = [
    "interpreting",
    "resolving_subjects",
    "reading_facts",
    "synthesizing",
    "validating",
] as const;

export type InvestigationStage = (typeof INVESTIGATION_STAGES)[number];

/** What a host knows about a run that has not ended. The standalone source never sends it. */
export type ChatProgress = {
    readonly stage?: InvestigationStage;
    readonly stages?: readonly {
        readonly stage: InvestigationStage;
        readonly state: "started" | "completed";
    }[];
    readonly phase?: "running" | "recovering" | "observing" | "restoring";
    /** ISO timestamp of when this run began: the elapsed line counts from it. */
    readonly startedAt?: string;
    readonly stop?: "idle" | "requested" | "canceling" | "not_leased";
};

/** Why ACR refused a question before anything ran. Each reason has its own guidance. */
export type NotRunReason =
    | "access_denied"
    | "no_repository"
    | "not_entitled"
    | "repo_forbidden"
    | "budget_refusal"
    | "rate_limited";

/** Why ACR stopped a run after it started. The way on is a new question, never a retry. */
export type StoppedReason = "rate_limited" | "interpretation_rejected" | "synthesis_rejected";

/**
 * A turn that ended, or stands, without an answer and without a failure the Workbench words: a
 * deadline, a limit, a lost stream, and so on. The render shows `CHAT_STATUS_COPY`'s words for
 * it. The standalone source never sends it.
 */
export type ChatStatus =
    /** No state of its own. `reference` is a correlation code to quote. */
    | { readonly kind: "failed"; readonly reference?: string }
    | {
          readonly kind: "deadline";
          readonly which: "model" | "request" | "admission" | "budget_exhausted";
      }
    | {
          readonly kind: "limited";
          readonly which: "principal" | "org" | "concurrency" | "allowance";
          readonly retryAfterSeconds?: number;
      }
    | { readonly kind: "not_run"; readonly reason: NotRunReason }
    | { readonly kind: "stopped"; readonly reason: StoppedReason }
    | { readonly kind: "stream_unavailable" }
    | { readonly kind: "mismatch"; readonly reference?: string }
    | { readonly kind: "unsaved" }
    | { readonly kind: "abandoned" }
    | { readonly kind: "interrupted" }
    | { readonly kind: "stalled" }
    | { readonly kind: "canceled" }
    | { readonly kind: "halted" }
    | { readonly kind: "thread_closed" }
    | { readonly kind: "connect" }
    | { readonly kind: "unavailable" }
    | { readonly kind: "restore_failed" }
    | {
          readonly kind: "unconfirmed";
          /**
           * ISO timestamp of the last status read that succeeded and said running, if any: a failed
           * read confirms nothing, so this is the only state such a turn may name.
           */
          readonly lastSeenRunningAt?: string;
      };

export type PendingOutcome = {
    readonly kind: "pending";
    /** Absent from the standalone source: the render then shows today's pending line, unchanged. */
    readonly progress?: ChatProgress;
};

export type AnsweredOutcome = {
    readonly kind: "answered";
    readonly result: InvestigationResult;
    /**
     * Typed marker beside the result: parts were withheld by the boundary. The render applies that
     * boundary to every answered turn, so a source cannot skip it; a source that already applied
     * it passes the marker here, because a second pass returns none.
     */
    readonly rankingWithheld?: RankingWithheld | undefined;
    /** Built once, server side (the route); rendered here, never rebuilt. */
    readonly scopeLossNotice?: string;
};

/** Unchanged from before the seam. Refusals keep using it. */
export type FailedOutcome = { readonly kind: "failed"; readonly failure: WorkbenchFailure };

export type StatusOutcome = {
    readonly kind: "status";
    readonly status: ChatStatus;
    /**
     * Whether this turn may be sent again. The render offers Retry only on the latest turn, only
     * for the kinds web may retry (`failed`, `limited`, `not_run`), and only with the turn's
     * `retryQuestion` set.
     */
    readonly retry: boolean;
};

export type AssistantOutcome = PendingOutcome | AnsweredOutcome | FailedOutcome | StatusOutcome;

export type ChatUserTurn = {
    readonly role: "user";
    readonly id: number;
    readonly question: string;
    /** ISO timestamp, threaded into a later re-ask's `conversation` (see `buildConversationTurns`). */
    readonly createdAt: string;
    /**
     * CHAOS-4670: a receipt-carrying re-ask (a panel selection's turn-2 request) resends this SAME
     * question text — the turn still runs for real on the wire (receipts/supersession unchanged,
     * still threaded into `buildConversationTurns` exactly as before), but showing it as a second
     * user bubble reads as though the tester asked twice. `false` for every receipt-carrying
     * re-ask (`askBatch`, and an `ask()` whose intent carries receipts, a chosen subject or a
     * structure batch); `true` for a plain composer ask or a plain-ask retry, which are genuinely
     * new/repeated questions and must render. The compact record of what a silent re-run carried
     * is the superseded assistant turn's own selection chips (`submittedStructureBatch`/
     * `submittedCandidateReceiptIds` below), already rendered — nothing else needs to change.
     */
    readonly showBubble: boolean;
};

export type ChatAssistantTurn = {
    readonly role: "assistant";
    readonly id: number;
    /** ISO timestamp, threaded into a later re-ask's `conversation` (see `buildConversationTurns`). */
    readonly createdAt: string;
    readonly outcome: AssistantOutcome;
    /** The subject the tester chose, when this turn answers a re-ask that carried one. */
    readonly chosenSubject: SubjectRef | undefined;
    /**
     * A SNAPSHOT of the structure-need batch this turn's own "Ask again with these selections"
     * confirmed, if it ever did — distinct from `useStructureSelections()`'s live `batch`, which
     * this turn stops owning the instant it is no longer the latest (codex review round 1, finding
     * 3). Without this, a frozen turn's own `StructureNeedsPanel` echo would render EMPTY rather
     * than what was actually submitted, the moment a newer turn takes over the shared selection
     * hook. Set by the ask that supersedes this turn (`AskIntent.supersedes`).
     */
    readonly submittedStructureBatch: StructureSelectionBatch | undefined;
    /**
     * The SAME snapshot discipline as `submittedStructureBatch`, for the two multi-select
     * candidate axes (codex review, round on CHAOS-4343: without this, a frozen turn's own
     * candidate panel loses every "selected" badge the instant a newer turn takes over the shared
     * selection hook). `subjectCandidates` is `subject_resolution.candidates`
     * (ClarificationPanel); `structureCandidates` is `structure_needs.candidate_options`
     * (StructureNeedsPanel) — two independent axes, two independent snapshots.
     */
    readonly submittedCandidateReceiptIds: ReadonlySet<string> | undefined;
    readonly submittedStructureCandidateReceiptIds: ReadonlySet<string> | undefined;
    /**
     * The exact question to retry, set ONLY when this turn came from a plain composer ask (no
     * prior receipts, no chosen subject, no structure batch). A receipt-carrying re-ask is never
     * retried from the failure or status panel — re-deriving which receipts to resend is not
     * presentation's job, so that turn's panel gets no retry action at all.
     */
    readonly retryQuestion: string | undefined;
    /**
     * CHAOS-5107 (codex review round 3): the tester's ORIGINAL typed question that started this
     * exchange, carried forward across a CHAIN of narrower re-asks — distinct from
     * `retryQuestion`, which is the exact (possibly already-narrowed) text this turn itself sent.
     * Without this, a second consecutive budget refusal would narrow the ALREADY-narrowed text
     * instead of narrowing the tester's real question again. Set ONLY alongside `retryQuestion`
     * (same plain-ask condition).
     */
    readonly rootQuestion: string | undefined;
};

/** One entry of the conversation timeline. */
export type ChatTurn = ChatUserTurn | ChatAssistantTurn;

export type ChatSnapshot = {
    readonly turns: readonly ChatTurn[];
    /** Whether a run can be stopped now. The render shows Stop only when this and `stop` hold. */
    readonly stoppable: boolean;
};

/**
 * What the superseded (latest answered) turn submitted, recorded on that turn by the ask that
 * supersedes it, so its frozen echo keeps showing the picks (see `ChatAssistantTurn`).
 */
export type SubmittedSelections = {
    /** The assistant turn being superseded. */
    readonly turnId: number;
    readonly submittedStructureBatch: StructureSelectionBatch;
    readonly submittedCandidateReceiptIds: ReadonlySet<string>;
    readonly submittedStructureCandidateReceiptIds: ReadonlySet<string>;
};

/**
 * What the render knows when it asks: the parameters `ask()` took before the seam, plus the
 * selection telemetry the selection hooks queued. The SOURCE turns this into a request
 * (conversation, parent reference, receipts, `expectedKinds`); the render never builds one.
 *
 * An intent with no receipts, no chosen subject and no structure batch is a PLAIN ask: its user
 * turn shows a bubble and its assistant turn carries `retryQuestion`/`rootQuestion`.
 */
export type AskIntent = {
    readonly priorSubjectReceipts?: readonly ClarificationChoice[] | undefined;
    /** The subject the tester chose, shown on the new turn (ChoiceNotice). */
    readonly chosenSubject?: SubjectRef | undefined;
    /** The structure-need batch this re-ask carries. */
    readonly structureBatch?: StructureSelectionBatch | undefined;
    /** CHAOS-5107: the chain's original question, when this plain ask is a narrower re-ask. */
    readonly narrowingRoot?: string | undefined;
    /** CHAOS-4171: every selection outcome observed since the hooks' last reset. */
    readonly selectionEvents?: readonly PendingSelectionEvent[] | undefined;
    /** Recorded on the superseded turn in the same update that appends this ask's turns. */
    readonly supersedes?: SubmittedSelections | undefined;
};

/**
 * One request of the parallel confirm (CHAOS-4343 items 1/2): each item becomes its own assistant
 * turn and its own request, under one silent user turn. The render decides the fan-out (which
 * receipts travel together, CHAOS-12003); the source builds each request from its item.
 */
export type BatchItem = {
    readonly priorSubjectReceipts: readonly ClarificationChoice[];
    /** The structure batch this item's request carries (wire fields built by the source). */
    readonly structureBatch: StructureSelectionBatch;
    readonly chosenSubject: SubjectRef | undefined;
    /** Selection telemetry: the first item carries it, the rest carry none. */
    readonly selectionEvents: readonly PendingSelectionEvent[];
};

export type ChatSource = {
    /** Calls `listener` after every snapshot change; returns the unsubscribe. Stable identity. */
    subscribe(listener: () => void): () => void;
    /** The current snapshot: the same object until something changes. Stable identity. */
    getSnapshot(): ChatSnapshot;
    /** Asks one question; resolves `true` when the new turn ended answered. */
    ask(question: string, intent?: AskIntent): Promise<boolean>;
    /**
     * The parallel confirm: one silent user turn holding `hiddenQuestion`, then one assistant turn
     * and one request per item, each settling on its own. `supersedes` is recorded as in
     * `AskIntent.supersedes`.
     */
    askBatch(
        items: readonly BatchItem[],
        hiddenQuestion: string,
        supersedes?: SubmittedSelections,
    ): void;
    /**
     * Sends assistant turn `turnId` again, and resolves `true` when it ended answered. The render's
     * Retry comes here, never to `ask`: a host re-sends under the same submission key, where `ask`
     * would mint a new key and start a second run. `intent` carries what the render read for this
     * send (the selection telemetry), exactly as it would for `ask`.
     *
     * A host that offers a retry sets the turn's `retryQuestion`: the render shows Retry only with
     * it, and the composer holds that text as the draft while the retry runs.
     */
    retry(turnId: number, intent?: AskIntent): Promise<boolean>;
    /** Present only when the source can stop a run. */
    stop?(): void;
    /**
     * Reads the answer of a `restore_failed` turn again. A GET re-read, never a resend. The render
     * shows "Load again" only when the source offers this.
     */
    reloadTurn?(turnId: number): void;
    /** Starts a fresh conversation: the next ask threads no prior turns. */
    newConversation(): void;
    slots?: {
        /**
         * The Connect affordance, rendered after the `connect` status words. ask-dev cannot hold
         * this because the auth flow (OAuth start, consent, token store) belongs to the host:
         * ask-dev has no credential of the viewer's and no route to start one.
         */
        readonly connect?: () => ReactNode;
    };
    // Reserved for the next ticket; comment-only, not implemented here:
    // history?: the host's saved conversations (list, open, delete) for the left rail.
    // feedback?: the host's per-answer feedback sink (helpful / not helpful, with a reason).
    // pageContext?: what the host page is showing (a team, a project), offered as ask context.
};

/**
 * Whether a status offers Retry: only these kinds may be sent again, and only when the source says
 * so. Web's `retryable()`. A `retry: true` on any other kind offers nothing.
 */
export function isRetryableStatus(outcome: StatusOutcome): boolean {
    const { kind } = outcome.status;
    return (kind === "failed" || kind === "limited" || kind === "not_run") && outcome.retry;
}

/** How one stage row of the checklist reads. */
export type StageRowState = "done" | "active" | "skipped" | "pending";

/**
 * Each stage's row, in ACR's order. A stage the run completed is done. A started stage (or the
 * `stage` the progress names) is active while it is the last one named, and done once a later one
 * began. A stage never named is skipped when a later one was named (ACR may skip stages), else
 * not started yet. The same rule web's checklist uses.
 */
export function stageRows(
    progress: ChatProgress,
): readonly { readonly stage: InvestigationStage; readonly state: StageRowState }[] {
    const reached = new Map<InvestigationStage, "started" | "completed">();
    for (const entry of progress.stages ?? []) {
        if (reached.get(entry.stage) !== "completed") reached.set(entry.stage, entry.state);
    }
    if (progress.stage !== undefined && !reached.has(progress.stage)) {
        reached.set(progress.stage, "started");
    }
    let lastNamed = -1;
    INVESTIGATION_STAGES.forEach((stage, index) => {
        if (reached.has(stage)) lastNamed = index;
    });
    return INVESTIGATION_STAGES.map((stage, index) => {
        const state = reached.get(stage);
        const later = index < lastNamed;
        if (state === "completed") return { stage, state: "done" };
        if (state === "started") return { stage, state: later ? "done" : "active" };
        return { stage, state: later ? "skipped" : "pending" };
    });
}
