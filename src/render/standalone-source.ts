/**
 * The standalone app's `ChatSource` (CHAOS-12382): the turns and the `/api/investigations` hop
 * that lived inside `AskDevChat` before the seam, moved here unchanged.
 *
 * It calls the SAME server hop the Workbench does (`/api/investigations`), which calls the real
 * ACR investigation API — there is no mock path here either (CHAOS-3738's hard boundary holds for
 * every surface, not just the Workbench).
 *
 * It never sends a `status` outcome, never sends `pending.progress`, and has no `stop`: the
 * standalone route answers in one response, so there is no run to report on or stop.
 *
 * A small external store: `subscribe`/`getSnapshot` for `useSyncExternalStore`. Every change makes
 * a new frozen snapshot; nothing else does.
 */
import type {
    AskIntent,
    AssistantOutcome,
    BatchItem,
    ChatAssistantTurn,
    ChatSnapshot,
    ChatSource,
    ChatTurn,
    SubmittedSelections,
} from "./source";
import type { ClarificationChoice } from "../components/ClarificationPanel";
import type { WorkbenchFailure } from "../lib/acr/errors";
import type { ConversationTurn, InvestigationResult, SubjectHint } from "../lib/contracts";
import {
    buildConversationTurns,
    deriveParentReference,
    type UnsentSubject,
} from "../lib/conversation";
import { literalKindNounsInQuestion } from "../lib/kind-nouns";
import { type RankingWithheld, withholdUnrankableRankings } from "../lib/ranking-withheld";
import {
    buildStructureReceiptFields,
    EMPTY_SELECTION_EVENTS,
    type PendingSelectionEvent,
} from "../lib/structure-selections";

function isFailure(value: unknown): value is WorkbenchFailure {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { code?: unknown }).code === "string" &&
        typeof (value as { message?: unknown }).message === "string"
    );
}

type InvestigationParams = {
    readonly question: string;
    readonly priorSubjectReceipts: readonly ClarificationChoice[];
    readonly conversation: readonly ConversationTurn[];
    // CHAOS-5837: same-conversation carry. Undefined/empty on a first turn —
    // see `deriveParentReference`'s own doc comment, this function's only
    // producer of both.
    readonly parentResultId: string | undefined;
    readonly subjectHints: readonly SubjectHint[];
    /** Committed subjects that could not ride as hints; the route words the notice. */
    readonly unsentSubjects: readonly UnsentSubject[];
    readonly structureReceiptFields: Record<string, unknown>;
    readonly selectionEvents: readonly PendingSelectionEvent[];
};

/**
 * The one place a request actually goes out over the wire, shared by `ask`
 * (one request) and `askBatch` (N independent requests, CHAOS-4343
 * items 1/2) — both build the SAME body shape and interpret the SAME
 * response shape, and duplicating that between them would be the
 * two-branches-one-tested trap: a fix to one would silently not apply to
 * the other.
 *
 * Takes no turn ids and touches no timeline state: the caller owns settling
 * whichever turn(s) this outcome belongs to, which is what lets `askBatch`
 * fire several of these concurrently and settle each independently as it
 * resolves, rather than waiting for the slowest.
 */
async function fireInvestigation(
    fetchImpl: typeof fetch,
    params: InvestigationParams,
): Promise<AssistantOutcome> {
    // CHAOS-4343 item 3: derived from the SAME `question` text this request
    // sends, every time — a fresh ask and a receipt-carrying re-ask (which
    // resends the ORIGINAL question unchanged) both get the literal-noun
    // hint consistently, with no separate call site to keep in sync.
    const expectedKinds = literalKindNounsInQuestion(params.question);
    try {
        const response = await fetchImpl("/api/investigations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                question: params.question,
                priorSubjectReceipts: params.priorSubjectReceipts,
                conversation: params.conversation,
                ...(params.parentResultId !== undefined
                    ? { parentResultId: params.parentResultId }
                    : {}),
                ...(params.subjectHints.length > 0 ? { subjectHints: params.subjectHints } : {}),
                ...(params.unsentSubjects.length > 0
                    ? { unsentSubjects: params.unsentSubjects }
                    : {}),
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
        const scopeLossNotice = (payload as { scopeLossNotice?: unknown }).scopeLossNotice;
        // The route already withholds; applying the same idempotent boundary
        // where the result enters client state keeps a caller that bypasses
        // the route from ever holding the unwithheld form. The route's own
        // marker (beside the result) wins: a second pass returns none.
        const boundary = withholdUnrankableRankings(result as InvestigationResult);
        const routeMarker = (payload as { rankingWithheld?: unknown }).rankingWithheld;
        const rankingWithheld =
            boundary.rankingWithheld ??
            (typeof routeMarker === "object" && routeMarker !== null
                ? (routeMarker as RankingWithheld)
                : undefined);
        return {
            kind: "answered",
            result: boundary.result,
            ...(rankingWithheld !== undefined ? { rankingWithheld } : {}),
            ...(typeof scopeLossNotice === "string" ? { scopeLossNotice } : {}),
        };
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

/** A pending assistant turn, frozen, with nothing submitted from it yet. */
function pendingAssistantTurn(
    fields: Pick<
        ChatAssistantTurn,
        "id" | "createdAt" | "chosenSubject" | "retryQuestion" | "rootQuestion"
    >,
): ChatAssistantTurn {
    const turn: ChatAssistantTurn = {
        role: "assistant",
        ...fields,
        outcome: { kind: "pending" },
        submittedStructureBatch: undefined,
        submittedCandidateReceiptIds: undefined,
        submittedStructureCandidateReceiptIds: undefined,
    };
    return Object.freeze(turn);
}

/** Records what the superseded turn submitted on that turn (see `AskIntent.supersedes`). */
function markSubmitted(
    turns: readonly ChatTurn[],
    supersedes: SubmittedSelections | undefined,
): readonly ChatTurn[] {
    if (supersedes === undefined) return turns;
    return turns.map((turn) =>
        turn.role === "assistant" && turn.id === supersedes.turnId
            ? Object.freeze({
                  ...turn,
                  submittedStructureBatch: supersedes.submittedStructureBatch,
                  submittedCandidateReceiptIds: supersedes.submittedCandidateReceiptIds,
                  submittedStructureCandidateReceiptIds:
                      supersedes.submittedStructureCandidateReceiptIds,
              })
            : turn,
    );
}

/**
 * Creates the standalone source. `fetchImpl` defaults to the global `fetch`, read at request time
 * (as the component read it before the seam), so a test that stubs the global after creation is
 * still honoured.
 */
export function createStandaloneSource(
    fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): ChatSource {
    let snapshot: ChatSnapshot = Object.freeze({ turns: Object.freeze([]), stoppable: false });
    // A monotonic counter, not crypto.randomUUID(): turn identity only needs
    // to be unique within this session, and a counter keeps the ask/settle
    // pairing trivially traceable in a debugger.
    let nextId = 0;
    const listeners = new Set<() => void>();

    function commit(turns: readonly ChatTurn[]): void {
        snapshot = Object.freeze({ turns: Object.freeze([...turns]), stoppable: false });
        for (const listener of [...listeners]) listener();
    }

    function settleTurn(assistantTurnId: number, outcome: AssistantOutcome): void {
        if (!snapshot.turns.some((turn) => turn.id === assistantTurnId)) {
            // The conversation was started over while this request ran: there is no turn left
            // to settle, and the fresh conversation must not change.
            return;
        }
        commit(
            snapshot.turns.map((turn) =>
                turn.role === "assistant" && turn.id === assistantTurnId
                    ? Object.freeze({ ...turn, outcome })
                    : turn,
            ),
        );
    }

    /**
     * Appends a user turn and a pending assistant turn, then settles the
     * assistant turn in place once the server hop answers — see the
     * Workbench's own `ask()` for why the question travels UNCHANGED
     * alongside a chosen receipt rather than being rewritten to mention it.
     *
     * Returns whether the turn answered (`true`) or failed (`false`), so the
     * composer can decide whether to clear its draft — the only thing that
     * return value is for.
     */
    async function ask(question: string, intent: AskIntent = {}): Promise<boolean> {
        const priorSubjectReceipts = intent.priorSubjectReceipts ?? [];
        const chosen = intent.chosenSubject;
        const structureBatch = intent.structureBatch;
        const userTurnId = nextId++;
        const assistantTurnId = nextId++;
        const isPlainAsk =
            priorSubjectReceipts.length === 0 &&
            chosen === undefined &&
            structureBatch === undefined;
        // Captured from the CURRENT timeline, BEFORE the pending pair below
        // is appended — a re-ask's own not-yet-answered turn must never be
        // threaded as its own prior context.
        const prior = snapshot.turns;
        const conversation = buildConversationTurns(prior);
        // Same "before the pending pair" capture, same source —
        // the immediately preceding turn's own result_id/committed subjects.
        const { parentResultId, subjectHints, unsentSubjects } = deriveParentReference(prior);
        const askedAt = new Date().toISOString();
        commit([
            ...markSubmitted(prior, intent.supersedes),
            Object.freeze({
                role: "user",
                id: userTurnId,
                question,
                createdAt: askedAt,
                showBubble: isPlainAsk,
            }),
            pendingAssistantTurn({
                id: assistantTurnId,
                createdAt: askedAt,
                chosenSubject: chosen,
                retryQuestion: isPlainAsk ? question : undefined,
                rootQuestion: isPlainAsk ? (intent.narrowingRoot ?? question) : undefined,
            }),
        ]);
        const outcome = await fireInvestigation(fetchImpl, {
            question,
            priorSubjectReceipts,
            conversation,
            parentResultId,
            subjectHints,
            unsentSubjects,
            structureReceiptFields:
                structureBatch === undefined ? {} : buildStructureReceiptFields(structureBatch),
            selectionEvents: intent.selectionEvents ?? EMPTY_SELECTION_EVENTS,
        });
        settleTurn(assistantTurnId, outcome);
        return outcome.kind === "answered";
    }

    /**
     * CHAOS-4343 items 1/2: one independent request PER item, each landing as
     * its OWN stacked assistant turn with its own pending/answered/failed
     * status. Never blocked on the others (each settles the moment ITS OWN
     * response arrives).
     *
     * The question is appended as a SINGLE silent user turn shared by every
     * fired request below it — it is the identical, unchanged text on every
     * one of them, so repeating it once per item would only look like N
     * separate things were asked when exactly one was.
     */
    function askBatch(
        items: readonly BatchItem[],
        hiddenQuestion: string,
        supersedes?: SubmittedSelections,
    ): void {
        if (items.length === 0) return;
        const prior = snapshot.turns;
        const conversation = buildConversationTurns(prior);
        // Same source and same "before the append" timing as `conversation`
        // above — the receipts fired below already name a subject explicitly,
        // but the carry still applies (this re-ask follows the latest result
        // exactly as much as a plain typed follow-up would).
        const { parentResultId, subjectHints, unsentSubjects } = deriveParentReference(prior);
        const askedAt = new Date().toISOString();
        const userTurnId = nextId++;
        const assistantTurns = items.map((item) => ({ id: nextId++, item }));
        commit([
            ...markSubmitted(prior, supersedes),
            // CHAOS-4670: always silent — every batch is a receipt-carrying
            // re-ask of a question already shown as a user bubble on the
            // turn(s) it supersedes.
            Object.freeze({
                role: "user",
                id: userTurnId,
                question: hiddenQuestion,
                createdAt: askedAt,
                showBubble: false,
            }),
            ...assistantTurns.map(({ id, item }) =>
                pendingAssistantTurn({
                    id,
                    createdAt: askedAt,
                    chosenSubject: item.chosenSubject,
                    retryQuestion: undefined,
                    rootQuestion: undefined,
                }),
            ),
        ]);
        for (const { id, item } of assistantTurns) {
            void fireInvestigation(fetchImpl, {
                question: hiddenQuestion,
                priorSubjectReceipts: item.priorSubjectReceipts,
                conversation,
                parentResultId,
                subjectHints,
                unsentSubjects,
                structureReceiptFields: buildStructureReceiptFields(item.structureBatch),
                selectionEvents: item.selectionEvents,
            }).then((outcome) => {
                settleTurn(id, outcome);
            });
        }
    }

    /** Sends a plain turn again. A receipt re-ask has no `retryQuestion`, so nothing is sent. */
    function retry(turnId: number, intent?: AskIntent): Promise<boolean> {
        const turn = snapshot.turns.find(
            (candidate) => candidate.role === "assistant" && candidate.id === turnId,
        );
        if (turn?.role !== "assistant" || turn.retryQuestion === undefined) {
            return Promise.resolve(false);
        }
        return ask(turn.retryQuestion, intent);
    }

    return {
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        getSnapshot() {
            return snapshot;
        },
        ask,
        askBatch,
        retry,
        newConversation() {
            commit([]);
        },
    };
}
