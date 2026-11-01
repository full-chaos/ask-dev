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
 * CHAOS-12387 adds what only a host has: saved conversations, feedback on an answer, page context,
 * the states of a conversation opened from History, and a composer that may refuse. Each is
 * optional, on both the snapshot and the source. The standalone source offers none, so none of it
 * renders there.
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
    /** `queued`: an item of a batch that has not started, because earlier items hold its place. */
    readonly phase?: "queued" | "running" | "recovering" | "observing" | "restoring";
    /** ISO timestamp of when this run began: the elapsed line counts from it. */
    readonly startedAt?: string;
    readonly stop?: "idle" | "requested" | "canceling" | "not_leased";
    /** This turn's place in a batch, 1-based. A `total` of 1 shows no line. */
    readonly batch?: { readonly position: number; readonly total: number };
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
    /**
     * `null`: ACR admitted this turn before it recorded questions (a host's restored turn). The
     * render says so, offers no choice and no re-ask of the turn, and never sends it again. The
     * standalone source always has the question.
     */
    readonly question: string | null;
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

/** The kinds of subject a page may propose: web's `ScopeKind`. */
export type ScopeKind =
    "organization" | "team" | "project" | "repository" | "work_item" | "pull_request";

/**
 * One saved conversation, as a view row the host builds. No ACR body crosses the seam. A
 * `firstQuestion` is the user's own text: the render draws it as inert text and never logs it.
 */
export type ChatHistoryRow = {
    readonly id: string;
    /** `null` when none is served, or a blank one: the row is then named by its date and count. */
    readonly firstQuestion: string | null;
    /** ISO timestamp of the conversation's last turn. */
    readonly lastTurnAt: string;
    readonly turnCount: number;
};

/** The saved conversations of the signed-in viewer. The host owns all of it. */
export type ChatHistorySnapshot = {
    /** `connect`: the host holds no access for the list. The render shows the Connect slot. */
    /**
     * `no_repository`: ACR's 409, the viewer has no repository in scope. It is not a failed read,
     * so it offers no Try again, and not an empty list: conversations may exist that this viewer
     * cannot reach now. The render shows no row while it holds.
     */
    readonly status: "idle" | "loading" | "ready" | "read_failed" | "connect" | "no_repository";
    readonly rows: readonly ChatHistoryRow[];
    /** The conversation shown now, or `null`. A change reads the list again. */
    readonly currentId: string | null;
    readonly hasMore: boolean;
    readonly loadingMore: boolean;
    readonly moreFailed: boolean;
    /** Ids whose delete is in flight. */
    readonly deleting: readonly string[];
    /** The id whose last delete failed, if any. */
    readonly deleteFailed: string | null;
    /** The current conversation has a question running: a delete says it does not stop it. */
    readonly running: boolean;
};

/**
 * The saved conversations' actions. The render owns none of their state: it draws
 * `ChatSnapshot.history` and calls these. A delete is confirmed in the render first, and `remove`
 * means the user confirmed.
 */
export type ChatHistorySource = {
    /**
     * Reads the first page. `ChatSurface` calls this, once per surface, not per place the list is
     * drawn: on mount, when `history.currentId` changes (a new conversation appears once it is
     * admitted), and from "Try again". It waits for `ChatSnapshot.history`: a host that cannot read
     * yet (no session) publishes none, and its first history starts the read.
     */
    load(): void;
    loadMore(): void;
    /** Shows this conversation. Opening the one already shown is the host's to ignore. */
    open(id: string): void;
    remove(id: string): void;
};

/** The two questions asked of an answer, in the order the controls show them. */
export const FEEDBACK_QUESTIONS = ["correct", "useful"] as const;

export type FeedbackQuestion = (typeof FEEDBACK_QUESTIONS)[number];

/** One flag, as web's store holds it (`FeedbackFlag`). `unset` is a value, not a missing one. */
export type FeedbackValue = "yes" | "no" | "unset";

/** The feedback on one answer. One entry per `result_id`, shared by every turn that shows it. */
export type ChatFeedbackEntry = {
    /**
     * `loading`: the first read is out. `ready`: the controls work. `unavailable`: not this
     * viewer's answer, or not served now, so the render draws nothing. `read_failed`: the controls
     * stay disabled, with "Try again".
     */
    readonly state: "loading" | "ready" | "unavailable" | "read_failed";
    /** What the controls show: the viewer's latest choice, sent or about to be. */
    readonly desired: Readonly<Record<FeedbackQuestion, FeedbackValue>>;
    readonly saving: boolean;
    /** The last failed write was rolled back. The host clears this on the next choice. */
    readonly notSaved: boolean;
};

/**
 * The per-answer feedback store. The host owns the entries, the reads and the writes, and sends no
 * product telemetry from them. The render reads through `subscribe` and `entryFor`, so one store
 * serves every answer without a new snapshot.
 */
export type ChatFeedbackSource = {
    /** Calls `listener` after any entry or `isReady` changes; returns the unsubscribe. Stable. */
    subscribe(listener: () => void): () => void;
    /** Whether `ensure` may read now. False, for example, before the session is known. */
    isReady(): boolean;
    /** `undefined` before `ensure`. The same object until it changes. */
    entryFor(resultId: string): ChatFeedbackEntry | undefined;
    /**
     * Reads a result's feedback once. The render calls this when ready and the entry is absent,
     * and Strict Mode runs that effect twice, so a second call while the read is out does nothing.
     */
    ensure(resultId: string): void;
    /** "Try again" on a failed read: a GET. */
    retryRead(resultId: string): void;
    /** The press of a value. Pressing the chosen value again clears it: that is the store's job. */
    choose(resultId: string, question: FeedbackQuestion, value: "yes" | "no"): void;
};

/**
 * One entity of the host's page, offered with the next question: web's `PageEntityRef`. The render
 * draws it as an inert chip. The hints a question carries stay in the source.
 */
export type ChatContextRef = {
    readonly kind: ScopeKind;
    readonly id: string;
    readonly label: string;
};

/**
 * Whether the conversation shown can be read and take a question: web's `ThreadAccess`.
 *
 * - `new`: no thread yet.
 * - `restoring`: the thread is being read. No question yet.
 * - `loaded`: the thread is the host's. `earlier` says whether earlier turns can be read.
 * - `unavailable`: not served, for a cause the render does not name. Read-only.
 * - `read_failed`: the read failed. Read-only, with "Try again" (`reloadThread`).
 * - `connect`: the host holds no access. Read-only, with the Connect slot and no "Try again".
 */
export type ChatThreadAccess =
    | { readonly kind: "new" }
    | { readonly kind: "restoring" }
    | {
          readonly kind: "loaded";
          readonly earlier: "none" | "available" | "loading" | "failed";
      }
    | { readonly kind: "unavailable" }
    | { readonly kind: "read_failed" }
    | { readonly kind: "connect" };

export type ChatSnapshot = {
    readonly turns: readonly ChatTurn[];
    /** Whether a run can be stopped now. The render shows Stop only when this and `stop` hold. */
    readonly stoppable: boolean;
    /**
     * The saved conversations. Absent from the standalone source, and from a host that cannot read
     * them yet: with `ChatSource.history` offered, the render then says it is loading and waits.
     */
    readonly history?: ChatHistorySnapshot;
    /** The entities offered with the next question. Absent or empty: no chips. */
    readonly pageContext?: readonly ChatContextRef[];
    /**
     * Names the conversation shown. It changes only when ANOTHER conversation is shown, never for a
     * turn of this one, so it is not a thread id: a new conversation gets its id at its first
     * question. Web's `selection` fits. All of the render's per-conversation state (a popup
     * dismissal, a selection, a pending retry, the draft) goes with it, because turn ids may repeat
     * across conversations of one source.
     */
    readonly conversationKey?: string | number;
    /** Absent from the standalone source: the render then shows no thread state. */
    readonly thread?: ChatThreadAccess;
    /**
     * The composer refuses to send, and the last turn is read-only like every earlier one. On a
     * `loaded` thread this means an answer of it is being read (web's `replaying`); on a `new` or
     * absent one, that the viewer is signed out (web's `!ready`). The other thread kinds lock the
     * composer by themselves: see `composerLockOf`.
     */
    readonly composerLocked?: boolean;
    /**
     * The host has no way to send at all, so the render draws no composer bar: no composer, no
     * chips, no popup, no Stop. Not the same as `composerLocked`, which says why a composer that
     * exists is waiting, and would tell a viewer with no transport to sign in again.
     */
    readonly composerHidden?: boolean;
    /**
     * A conversation of this tab was lost to a reload. The host owns the marker; the render says so
     * while nothing else is shown. The standalone source never sends it.
     */
    readonly notSaved?: boolean;
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

/**
 * What one evidence reference names when a person opens it (CHAOS-12426). The render builds this
 * and hands it to the host; it reads nothing.
 */
export type ChatEvidenceRef = {
    readonly refId: string;
    /** The answer the reference was cited in. Two answers may cite one ref, each with its own citation. */
    readonly resultId: string;
    /** The label shown on the button: served, or the floor "Evidence". */
    readonly label: string;
};

/**
 * Present only when the host can show one evidence reference. The HOST reads it, with its own
 * credential, and keeps the state it reads; the render holds no token, URL or transport, never
 * fetches, and gets only a `ChatEvidenceState` to draw (`ChatEvidenceBody`). The standalone source
 * offers none, so its references stay plain text.
 */
export type ChatEvidenceSource = { open(ref: ChatEvidenceRef): void };

/** What a host read of one evidence reference. `ChatEvidenceBody` draws each kind. */
export type ChatEvidenceState =
    | { readonly kind: "loading" }
    | { readonly kind: "ready"; readonly detail: ChatEvidenceDetail }
    | { readonly kind: "stale"; readonly detail: ChatEvidenceDetail }
    | { readonly kind: "redacted"; readonly reason?: string; readonly detail?: ChatEvidenceDetail }
    /**
     * Deliberately says nothing of whether the evidence exists: the same state for a reference that
     * is gone and one the viewer may not know of. The body shows no ref id for it.
     */
    | { readonly kind: "not_found" }
    | { readonly kind: "denied" }
    /**
     * Its own state, never folded into `denied` or `unavailable`: ACR's 409 says the viewer has no
     * repository, which is not a failure to reach anything.
     */
    | { readonly kind: "no_repository" }
    | { readonly kind: "unavailable" }
    | { readonly kind: "connect" };

export type ChatEvidenceDetail = {
    readonly refId: string;
    /** Served text; shown as served. */
    readonly citation: string;
    /** Served text; shown as served. */
    readonly excerpt?: string;
    /** ISO timestamp. */
    readonly observedAt?: string;
    /** Raw values; shown only inside a closed fold. */
    readonly structuredFields?: Readonly<Record<string, unknown>>;
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
     *
     * A host may run the items in sequence (ACR allows 2 running per principal). It then publishes
     * each item that waits as a pending turn with `phase: "queued"` and its `batch` place, so the
     * composer holds and a batch never stalls silently. The render does not depend on the order: it
     * draws each turn from its own outcome.
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
         * The Connect affordance, rendered after the `connect` words of a turn, the history list
         * or a conversation that cannot be shown. ask-dev cannot hold this because the auth flow
         * (OAuth start, consent, token store) belongs to the host: ask-dev has no credential of
         * the viewer's and no route to start one.
         */
        readonly connect?: () => ReactNode;
    };
    /** Present only when the host has saved conversations. Absent: no list and no toggle. */
    history?: ChatHistorySource;
    /** Present only when the host stores feedback. Absent: no controls on any answer. */
    feedback?: ChatFeedbackSource;
    /**
     * Present only when the host offers page context. The render calls `remove` and draws what the
     * next snapshot lists; it keeps no removal of its own, and never reads a hint.
     */
    pageContext?: { remove(ref: ChatContextRef): void };
    /** "Try again" on a `read_failed` thread: a GET. Web's `retryThreadRead`. */
    reloadThread?(): void;
    /** "Show earlier turns" on a `loaded` thread. Web's `loadEarlierTurns`. */
    loadEarlier?(): void;
    /**
     * Present only when the host can show an evidence reference. Absent: references stay plain
     * text, with no button.
     */
    evidence?: ChatEvidenceSource;
};

/** A clarification or a no-match asks nothing to judge, so it takes no feedback. Web's rule. */
export function isNonAnswer(status: string): boolean {
    return status === "clarification_required" || status === "no_match";
}

/** Why the composer takes no question: each lock has its own words (`COMPOSER_LOCK_WORDS`). */
export type ComposerLock = "signed_out" | "restoring" | "read_only";

/**
 * Why the composer refuses now, or `undefined` when it takes a question. Web's `lockedReason` and
 * its composer's `!ready`, read from the seam: a `restoring` thread and a thread that cannot be
 * shown lock it whatever `composerLocked` says, so a host cannot open a read-only conversation.
 */
export function composerLockOf(
    snapshot: Pick<ChatSnapshot, "thread" | "composerLocked">,
): ComposerLock | undefined {
    const locked = snapshot.composerLocked === true;
    switch (snapshot.thread?.kind) {
        case "restoring":
            return "restoring";
        case "unavailable":
        case "read_failed":
        case "connect":
            return "read_only";
        case "loaded":
            return locked ? "restoring" : undefined;
        default:
            return locked ? "signed_out" : undefined;
    }
}

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
