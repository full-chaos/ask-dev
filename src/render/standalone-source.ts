/**
 * The standalone app's `ChatSource` (CHAOS-12382): the turns and the investigation call that lived
 * inside `AskDevChat` before the seam, moved here.
 *
 * The call is injected (CHAOS-12106). The app passes `investigateFromBrowser`, which asks the real
 * ACR investigation API as the signed-in user: there is no mock path here either (CHAOS-3738's
 * hard boundary holds for every surface, not just the Workbench). This file is in the render entry
 * graph, so it imports types only and none of the client behind them.
 *
 * It never sends a `status` outcome, never sends `pending.progress`, and has no `stop`: the call
 * answers once, so there is no run to report on or stop.
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
import type {
    AnswerProjection,
    BoundStructureReceipt,
    ConversationTurn,
    InvestigationResult,
    StructureSubjectKind,
    SubjectHint,
} from "../lib/contracts";
import {
    buildConversationTurns,
    deriveParentReference,
    unsentSubjectsNotice,
    type UnsentSubject,
} from "../lib/conversation";
import { literalKindNounsInQuestion } from "../lib/kind-nouns";
import { withholdUnrankableRankings } from "../lib/ranking-withheld";
import { buildStructureReceiptFields } from "../lib/structure-selections";

/**
 * What the source asks of the investigation call. A local type, so that this file imports none of
 * the client: `InvestigationOptions` in `lib/acr/investigate.ts` is assignable from it.
 */
export type StandaloneInvestigationOptions = {
    readonly question: string;
    readonly priorSubjectReceipts: readonly ClarificationChoice[];
    readonly conversation: readonly ConversationTurn[];
    readonly parentResultId?: string | undefined;
    readonly subjectHints?: readonly SubjectHint[] | undefined;
    readonly expectedKinds?: readonly StructureSubjectKind[] | undefined;
    readonly priorKindReceipts?: readonly BoundStructureReceipt[] | undefined;
    readonly priorAnchorReceipts?: readonly BoundStructureReceipt[] | undefined;
    readonly priorHandleReceipts?: readonly BoundStructureReceipt[] | undefined;
    readonly priorWindowReceipts?: readonly BoundStructureReceipt[] | undefined;
    readonly priorCandidateReceipts?: readonly BoundStructureReceipt[] | undefined;
};

/** The call's answer: a result, or a failure in the Workbench's own words. */
export type StandaloneInvestigateOutcome =
    | { readonly kind: "answered"; readonly result: InvestigationResult }
    | { readonly kind: "bounded"; readonly projection: AnswerProjection }
    | { readonly kind: "failed"; readonly failure: WorkbenchFailure };

export type StandaloneInvestigate = (
    options: StandaloneInvestigationOptions,
) => Promise<StandaloneInvestigateOutcome>;

type InvestigationParams = {
    readonly question: string;
    readonly priorSubjectReceipts: readonly ClarificationChoice[];
    readonly conversation: readonly ConversationTurn[];
    // CHAOS-5837: same-conversation carry. Undefined/empty on a first turn —
    // see `deriveParentReference`'s own doc comment, this function's only
    // producer of both.
    readonly parentResultId: string | undefined;
    readonly subjectHints: readonly SubjectHint[];
    /** Committed subjects that could not ride as hints; the notice below words them. */
    readonly unsentSubjects: readonly UnsentSubject[];
    readonly structureReceiptFields: Partial<ReturnType<typeof buildStructureReceiptFields>>;
};

/**
 * The one place a question actually goes out, shared by `ask` (one request) and `askBatch` (N
 * independent requests, CHAOS-4343 items 1/2): both build the SAME options and interpret the SAME
 * outcome, and duplicating that between them would be the two-branches-one-tested trap: a fix to
 * one would silently not apply to the other.
 *
 * Takes no turn ids and touches no timeline state: the caller owns settling whichever turn(s) this
 * outcome belongs to, which is what lets `askBatch` fire several of these concurrently and settle
 * each independently as it resolves, rather than waiting for the slowest.
 */
async function fireInvestigation(
    investigate: StandaloneInvestigate,
    params: InvestigationParams,
): Promise<AssistantOutcome> {
    // CHAOS-4343 item 3: derived from the SAME `question` text this request
    // sends, every time — a fresh ask and a receipt-carrying re-ask (which
    // resends the ORIGINAL question unchanged) both get the literal-noun
    // hint consistently, with no separate call site to keep in sync.
    const expectedKinds = literalKindNounsInQuestion(params.question);
    try {
        const outcome = await investigate({
            question: params.question,
            priorSubjectReceipts: params.priorSubjectReceipts,
            conversation: params.conversation,
            ...(params.parentResultId !== undefined
                ? { parentResultId: params.parentResultId }
                : {}),
            ...(params.subjectHints.length > 0 ? { subjectHints: params.subjectHints } : {}),
            ...params.structureReceiptFields,
            ...(expectedKinds.length > 0 ? { expectedKinds } : {}),
        });
        if (outcome.kind === "failed" || outcome.kind === "bounded") return outcome;
        // The boundary: unrankable cohorts are withheld where the result enters client state, and
        // the scope-loss notice is built here, once.
        const boundary = withholdUnrankableRankings(outcome.result);
        const scopeLossNotice = unsentSubjectsNotice(params.unsentSubjects);
        return {
            kind: "answered",
            result: boundary.result,
            ...(boundary.rankingWithheld !== undefined
                ? { rankingWithheld: boundary.rankingWithheld }
                : {}),
            ...(scopeLossNotice !== undefined ? { scopeLossNotice } : {}),
        };
    } catch (error) {
        // Never swallow: a dead call is itself a reportable outcome.
        console.error("investigation request failed", error);
        return {
            kind: "failed",
            failure: {
                code: "acr_unreachable",
                message: "Ask Dev could not be reached.",
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

/** Creates the standalone source over an investigation call (`investigateFromBrowser`). */
export function createStandaloneSource(investigate: StandaloneInvestigate): ChatSource {
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
     * assistant turn in place once the call answers — see the
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
        const outcome = await fireInvestigation(investigate, {
            question,
            priorSubjectReceipts,
            conversation,
            parentResultId,
            subjectHints,
            unsentSubjects,
            structureReceiptFields:
                structureBatch === undefined ? {} : buildStructureReceiptFields(structureBatch),
        });
        settleTurn(assistantTurnId, outcome);
        return outcome.kind === "answered" || outcome.kind === "bounded";
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
            void fireInvestigation(investigate, {
                question: hiddenQuestion,
                priorSubjectReceipts: item.priorSubjectReceipts,
                conversation,
                parentResultId,
                subjectHints,
                unsentSubjects,
                structureReceiptFields: buildStructureReceiptFields(item.structureBatch),
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
