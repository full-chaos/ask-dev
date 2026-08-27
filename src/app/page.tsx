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
import type {
    BoundStructureReceipt,
    ConversationTurn,
    InvestigationResult,
    StructureNeedKind,
    SubjectRef,
} from "@/lib/contracts";
import { literalKindNounsInQuestion } from "@/lib/kind-nouns";
import {
    type CarriedStructureReceipt,
    mergeStructureCarryIntoBatch,
    structureCarryContribution,
} from "@/lib/structure-carry";
import {
    buildStructureReceiptFields,
    EMPTY_SELECTION_EVENTS,
    EMPTY_STRUCTURE_SELECTION_BATCH,
    recordSelectionEvent,
    type PendingSelectionEvent,
    type StructureSelectionBatch,
} from "@/lib/structure-selections";
import { useCandidateSelections } from "@/lib/use-candidate-selections";
import { useStructureCarry } from "@/lib/use-structure-carry";
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
 *  2. Confirming N selected candidates (across EITHER candidate axis, or
 *     both at once) fires N INDEPENDENT turn-2 requests, each landing as its
 *     own stacked assistant turn with its own pending/answered/failed status
 *     (`confirmSelections` below) — not one request carrying several
 *     candidate receipts.
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
           * The SAME snapshot discipline as `submittedStructureBatch`, for
           * the two multi-select candidate axes (codex review, round on
           * CHAOS-4343: without this, a frozen turn's own candidate panel
           * loses every "selected" badge the instant a newer turn takes
           * over the shared selection hook — the same dead end
           * `submittedStructureBatch` already closes for kind/anchor/
           * handle/window). `subjectCandidates` is `subject_resolution.
           * candidates` (ClarificationPanel); `structureCandidates` is
           * `structure_needs.candidate_options` (StructureNeedsPanel) —
           * two independent axes, two independent snapshots.
           */
          readonly submittedCandidateReceiptIds: ReadonlySet<string> | undefined;
          readonly submittedStructureCandidateReceiptIds: ReadonlySet<string> | undefined;
          /**
           * CHAOS-4355 stopgap: a SNAPSHOT of the structure-carry
           * contribution this turn's own request actually sent — every
           * member `structure-carry.ts` injected that this turn's own
           * explicit picks did not already cover. Same snapshot discipline
           * as `submittedStructureBatch` (frozen once this turn is no
           * longer latest), and the source for `CarriedStructureNotice`'s
           * "carried from turn N" disclosure.
           */
          readonly carriedStructureEntries: readonly CarriedStructureReceipt[] | undefined;
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
 * (one request) and `confirmSelections` (N independent requests, CHAOS-4343
 * items 1/2) — both build the SAME body shape and interpret the SAME
 * response shape, and duplicating that between them would be the
 * two-branches-one-tested trap: a fix to one would silently not apply to
 * the other.
 *
 * Takes no turn ids and touches no timeline state: the caller owns settling
 * whichever turn(s) this outcome belongs to, which is what lets
 * `confirmSelections` fire several of these concurrently and settle each
 * independently as it resolves, rather than waiting for the slowest.
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
    // CHAOS-4355 stopgap (conversation memory): a member confirmed on an
    // earlier turn but not part of THIS turn's own StructureSelectionBatch
    // (which resets every ask/confirm, by design) must still ride along —
    // ACR does not carry it forward server-side yet (CHAOS-4360 is the real
    // fix). See `use-structure-carry.ts`/`structure-carry.ts` for why.
    const structureCarry = useStructureCarry();
    // CHAOS-4343 items 1/2: a SEPARATE accumulator from `structureSelections`
    // above — a tester may select several distinct candidates at once, each
    // becoming its own turn-2 request, which is not the "one pick per
    // member" shape `StructureSelectionBatch` models. Two independent
    // instances: `candidateSelections` for `subject_resolution.candidates`
    // (ClarificationPanel), `structureCandidateSelections` for
    // `structure_needs.candidate_options` (StructureNeedsPanel) — different
    // wire fields (`prior_subject_receipts` vs `prior_candidate_receipts`),
    // different receipt namespaces, so a pick in one must never leak into
    // the other.
    const candidateSelections = useCandidateSelections();
    const structureCandidateSelections = useCandidateSelections();

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
        // CHAOS-4355 stopgap: a brand-new plain question starts a fresh
        // conversation as far as structure carry is concerned — nothing
        // from the old one should ride along silently. A receipt-carrying
        // re-ask (of ANY kind: chosen subject, structure batch, or both)
        // keeps the carry alive, which is the whole point of it.
        if (isPlainAsk) structureCarry.reset();
        const explicitStructureBatch = structureSelectionsToSend ?? EMPTY_STRUCTURE_SELECTION_BATCH;
        const mergedStructureBatch = isPlainAsk
            ? EMPTY_STRUCTURE_SELECTION_BATCH
            : mergeStructureCarryIntoBatch(structureCarry.carry, explicitStructureBatch);
        const carriedContribution = isPlainAsk
            ? []
            : structureCarryContribution(structureCarry.carry, explicitStructureBatch);
        structureSelections.reset();
        // A plain new ask (the common composer path) must clear any
        // unconfirmed candidate picks left over from the turn it supersedes
        // too — otherwise the NEXT result's candidate panel would open with
        // stale selections from a different result's candidates.
        candidateSelections.reset();
        structureCandidateSelections.reset();
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
                submittedCandidateReceiptIds: undefined,
                submittedStructureCandidateReceiptIds: undefined,
                carriedStructureEntries: carriedContribution,
                retryQuestion: isPlainAsk ? question : undefined,
            },
        ]);

        const structureReceiptFields =
            Object.keys(mergedStructureBatch).length === 0
                ? {}
                : buildStructureReceiptFields(mergedStructureBatch);
        // CHAOS-4171: every selection outcome observed since the last
        // reset() rides this SAME request — the route is the sink (see
        // `useStructureSelections`'s own `pendingSelectionEvents` header).
        // Read AFTER every hook's `reset()` above but still the pre-reset
        // value: `setState` schedules a re-render, it does not mutate this
        // closure's already-captured array. All THREE selection hooks are
        // merged here (codex review: a tester can toggle a candidate, then
        // fire a PLAIN ask or a structure confirm without ever confirming
        // that candidate pick — `reset()` above would otherwise discard its
        // queued telemetry silently, since only THIS path's own request
        // would have carried it).
        //
        // CHAOS-4355: the carry's own contribution rides the SAME telemetry
        // channel with its own outcome (`carried_forward`) — see
        // `StructureOfferSelectionOutcome`'s own header for why this is a
        // separate outcome from `submitted` rather than folded into it.
        const selectionEvents = [
            ...structureSelections.pendingSelectionEvents,
            ...candidateSelections.pendingSelectionEvents,
            ...structureCandidateSelections.pendingSelectionEvents,
            ...carriedContribution.reduce(
                (events, entry) => recordSelectionEvent(events, entry.member, "carried_forward"),
                EMPTY_SELECTION_EVENTS,
            ),
        ];
        const outcome = await fireInvestigation({
            question,
            priorSubjectReceipts,
            conversation,
            structureReceiptFields,
            selectionEvents,
        });
        // CHAOS-4355: fold this turn's own `confirmed_structure` echo into
        // the running carry BEFORE settling — a vetoed member must stop
        // riding along starting with the VERY NEXT re-ask, not one turn
        // later (fail closed, no retry loops).
        if (outcome.kind === "answered") {
            structureCarry.recordFromResult(outcome.result.confirmed_structure, assistantTurnId);
        }
        settleTurn(assistantTurnId, outcome);
        return outcome.kind === "answered";
    }

    /**
     * ACR's own order for whichever candidate axis the CURRENT confirm
     * action is NOT driving (codex review round 2: "mixed candidate axes
     * silently lose each other" — confirming one axis used to drop any
     * pending-but-unconfirmed picks in the OTHER one entirely). Mirrors
     * exactly what `ClarificationPanel`/`StructureNeedsPanel` themselves do
     * to build their own `choices`/`candidateReceipts` arrays: filter the
     * result's own candidate list by membership, never re-sort.
     */
    function subjectChoicesInAcrOrder(
        result: InvestigationResult,
        selectedIds: ReadonlySet<string>,
    ): readonly ClarificationChoice[] {
        return result.subject_resolution.candidates
            .filter((candidate) => selectedIds.has(candidate.receipt_id))
            .map((candidate) => ({
                result_id: result.result_id,
                receipt_id: candidate.receipt_id,
            }));
    }

    function structureCandidateReceiptsInAcrOrder(
        result: InvestigationResult,
        selectedIds: ReadonlySet<string>,
    ): readonly BoundStructureReceipt[] {
        return (result.structure_needs?.candidate_options ?? [])
            .filter((option) => selectedIds.has(option.receipt_id))
            .map((option) => ({ result_id: result.result_id, receipt_id: option.receipt_id }));
    }

    /**
     * CHAOS-4343 items 1/2: fires one independent turn-2 request PER entry
     * across BOTH candidate axes combined (`subjectChoices` —
     * `subject_resolution.candidates` via `ClarificationPanel` —
     * and `structureCandidateReceipts` — `structure_needs.candidate_options`
     * via `StructureNeedsPanel`), each landing as its OWN stacked assistant
     * turn with its own pending/answered/failed status. Never one request
     * carrying several candidate receipts, and never blocked on the others
     * (each settles the moment ITS OWN response arrives).
     *
     * Whichever axis the tester actually clicked "confirm" on supplies most
     * of these entries; the OTHER axis's pending-but-unconfirmed picks (if
     * any) ride along too — see `subjectChoicesInAcrOrder`/
     * `structureCandidateReceiptsInAcrOrder` above and this function's two
     * call sites (`chooseCandidates`/`chooseStructure`).
     *
     * Callers must not invoke this with BOTH arrays empty — that case is the
     * ordinary "no candidate axis in play" re-ask, which stays a single
     * plain `ask()` call so its wire shape and existing tests are unchanged.
     *
     * The question is appended as a SINGLE user turn shared by every fired
     * request below it — it is the identical, unchanged text on every one of
     * them (same "the question travels unchanged" rule `ask()` holds), so
     * repeating it once per candidate would only look like N separate things
     * were asked when exactly one was.
     */
    function confirmSelections(
        result: InvestigationResult,
        subjectChoices: readonly ClarificationChoice[],
        structureCandidateReceipts: readonly BoundStructureReceipt[],
        otherStructureBatch: StructureSelectionBatch,
    ): void {
        const question = result.question;
        if (subjectChoices.length === 0 && structureCandidateReceipts.length === 0) return;
        const conversation = buildConversationTurns(turns);
        // Read BEFORE any reset() — a plain synchronous read at the top of
        // this ONE call, never re-read after a loop iteration's own
        // re-render (codex review: a stale closure re-reading a hook after
        // `.reset()` sees the SAME pre-reset value on every iteration,
        // which is why the per-request fan-out below fires everything from
        // ONE synchronous pass rather than a sequence of awaited `ask()`
        // calls that could each re-enter this component's hooks).
        const selectionEvents = [
            ...structureSelections.pendingSelectionEvents,
            ...candidateSelections.pendingSelectionEvents,
            ...structureCandidateSelections.pendingSelectionEvents,
        ];
        structureSelections.reset();
        candidateSelections.reset();
        structureCandidateSelections.reset();
        const askedAt = new Date().toISOString();

        type PendingItem =
            | { readonly kind: "subject"; readonly choice: ClarificationChoice }
            | { readonly kind: "structure"; readonly receipt: BoundStructureReceipt };
        const items: readonly PendingItem[] = [
            ...subjectChoices.map((choice): PendingItem => ({ kind: "subject", choice })),
            ...structureCandidateReceipts.map((receipt): PendingItem => ({
                kind: "structure",
                receipt,
            })),
        ];

        // CHAOS-4355 stopgap: this call site is NEVER a plain ask — every
        // item here already carries a receipt, so the carry always applies
        // (unlike `ask()`, which resets it on a brand-new plain question).
        // Computed PER ITEM: a "structure" item's own explicit
        // `subject_candidate` pick must win over anything carried for that
        // same member, the same "explicit always wins" rule `ask()` holds.
        const preparedItems = items.map((item) => {
            const explicitBatch: StructureSelectionBatch =
                item.kind === "structure"
                    ? { ...otherStructureBatch, subject_candidate: item.receipt }
                    : otherStructureBatch;
            const mergedBatch = mergeStructureCarryIntoBatch(structureCarry.carry, explicitBatch);
            return {
                item,
                structureReceiptFields:
                    Object.keys(mergedBatch).length === 0
                        ? {}
                        : buildStructureReceiptFields(mergedBatch),
                carriedContribution: structureCarryContribution(
                    structureCarry.carry,
                    explicitBatch,
                ),
            };
        });

        const userTurnId = nextId.current++;
        const assistantTurns = preparedItems.map((prepared) => ({
            id: nextId.current++,
            prepared,
        }));

        setTurns((current) => [
            ...current,
            { role: "user", id: userTurnId, question, createdAt: askedAt },
            ...assistantTurns.map(({ id, prepared: { item, carriedContribution } }) => ({
                role: "assistant" as const,
                id,
                createdAt: askedAt,
                outcome: { kind: "pending" as const },
                // Structure `candidate_options` entries carry no `SubjectRef`
                // (unlike `subject_resolution.candidates`) — nothing to show
                // via ChoiceNotice for those.
                chosenSubject:
                    item.kind === "subject"
                        ? subjectForReceipt(result, item.choice.receipt_id)
                        : undefined,
                submittedStructureBatch: undefined,
                submittedCandidateReceiptIds: undefined,
                submittedStructureCandidateReceiptIds: undefined,
                carriedStructureEntries: carriedContribution,
                retryQuestion: undefined,
            })),
        ]);

        assistantTurns.forEach(
            ({ id, prepared: { item, structureReceiptFields, carriedContribution } }, index) => {
                const priorSubjectReceipts = item.kind === "subject" ? [item.choice] : [];
                const itemSelectionEvents = carriedContribution.reduce(
                    (events, entry) =>
                        recordSelectionEvent(events, entry.member, "carried_forward"),
                    index === 0 ? selectionEvents : EMPTY_SELECTION_EVENTS,
                );
                void fireInvestigation({
                    question,
                    priorSubjectReceipts,
                    conversation,
                    structureReceiptFields,
                    selectionEvents: itemSelectionEvents,
                }).then((outcome) => {
                    // CHAOS-4355: same fold-before-settle discipline as `ask()`.
                    if (outcome.kind === "answered") {
                        structureCarry.recordFromResult(outcome.result.confirmed_structure, id);
                    }
                    settleTurn(id, outcome);
                });
            },
        );
    }
    const latestAssistantTurn = [...turns].reverse().find((turn) => turn.role === "assistant");

    /**
     * CHAOS-4355 stopgap: an explicit deselect must stop that member riding
     * along silently on the NEXT re-ask too, not just drop it from the
     * live (single-turn) batch — otherwise unchecking an offer would look
     * like it worked while the carry kept resending the OLD pick anyway.
     * `toggleStructureOffer` deselects exactly when the SAME receipt is
     * clicked again (`structure-selections.ts`'s own toggle semantic), so
     * that is the one case this checks for before delegating.
     */
    function toggleStructure(member: StructureNeedKind, receipt: BoundStructureReceipt) {
        const isDeselecting = structureSelections.batch[member]?.receipt_id === receipt.receipt_id;
        structureSelections.toggle(member, receipt);
        if (isDeselecting) structureCarry.dropMember(member);
    }

    function chooseCandidates(choices: readonly ClarificationChoice[]) {
        if (
            latestAssistantTurn?.role !== "assistant" ||
            latestAssistantTurn.outcome.kind !== "answered"
        ) {
            return;
        }
        const { result } = latestAssistantTurn.outcome;
        const pendingStructureBatch = structureSelections.batch;
        // Mixed-receipt-family unification (codex review round 2): a
        // pending-but-unconfirmed STRUCTURE-candidate pick must ride along
        // too, not just the ordinary kind/anchor/handle/window batch.
        const pendingStructureCandidateReceipts = structureCandidateReceiptsInAcrOrder(
            result,
            structureCandidateSelections.batch,
        );
        if (choices.length === 0 && pendingStructureCandidateReceipts.length === 0) return;

        // Snapshotted BEFORE `confirmSelections()` resets the shared hooks
        // and appends new turns — otherwise this turn's own frozen echo
        // would render as if nothing had ever been picked (codex review
        // round 1, finding 3; extended to the candidate axes in later
        // rounds: without this, a frozen turn's candidate panel loses every
        // "selected" badge the instant a newer turn takes over the shared
        // selection hook).
        const supersededTurnId = latestAssistantTurn.id;
        const submittedCandidateReceiptIds = new Set(choices.map((choice) => choice.receipt_id));
        const submittedStructureCandidateReceiptIds = new Set(
            pendingStructureCandidateReceipts.map((receipt) => receipt.receipt_id),
        );
        setTurns((current) =>
            current.map((turn) =>
                turn.role === "assistant" && turn.id === supersededTurnId
                    ? {
                          ...turn,
                          submittedStructureBatch: pendingStructureBatch,
                          submittedCandidateReceiptIds,
                          submittedStructureCandidateReceiptIds,
                      }
                    : turn,
            ),
        );
        confirmSelections(
            result,
            choices,
            pendingStructureCandidateReceipts,
            pendingStructureBatch,
        );
    }

    /**
     * `candidateReceipts` is every currently-selected `structure_needs.
     * candidate_options` entry (CHAOS-4343 items 1/2) — empty in the
     * ordinary case (no candidate axis, or none picked), in which case this
     * behaves exactly as before: one re-ask carrying `batch`. Non-empty
     * fans out into independent requests via `confirmSelections`, one per
     * entry (plus any pending SUBJECT-candidate picks, codex review round 2
     * — mixed axes must not drop each other), each also carrying every
     * OTHER member `batch` holds.
     */
    function chooseStructure(
        batch: StructureSelectionBatch,
        candidateReceipts: readonly BoundStructureReceipt[] = [],
    ) {
        if (
            latestAssistantTurn?.role !== "assistant" ||
            latestAssistantTurn.outcome.kind !== "answered"
        ) {
            return;
        }
        const { result } = latestAssistantTurn.outcome;
        const pendingSubjectChoices = subjectChoicesInAcrOrder(result, candidateSelections.batch);

        // Snapshot what was actually submitted onto the turn being
        // superseded BEFORE `ask()`/`confirmSelections()` resets the shared
        // hooks and appends a new turn — otherwise this turn's own frozen
        // echo would render as if nothing had ever been picked (codex
        // review round 1, finding 3; extended to the candidate axes in
        // later rounds, same reason `chooseCandidates` above snapshots its
        // own candidate picks).
        const supersededTurnId = latestAssistantTurn.id;
        const submittedStructureCandidateReceiptIds = new Set(
            candidateReceipts.map((receipt) => receipt.receipt_id),
        );
        const submittedCandidateReceiptIds = new Set(
            pendingSubjectChoices.map((choice) => choice.receipt_id),
        );
        setTurns((current) =>
            current.map((turn) =>
                turn.role === "assistant" && turn.id === supersededTurnId
                    ? {
                          ...turn,
                          submittedStructureBatch: batch,
                          submittedStructureCandidateReceiptIds,
                          submittedCandidateReceiptIds,
                      }
                    : turn,
            ),
        );
        if (candidateReceipts.length === 0 && pendingSubjectChoices.length === 0) {
            // Exact pre-CHAOS-4343 shape: no candidate axis in play at all,
            // one plain re-ask carrying only the ordinary structure batch.
            void ask(result.question, [], undefined, batch);
            return;
        }
        confirmSelections(result, pendingSubjectChoices, candidateReceipts, batch);
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
                                                isLatest ? toggleStructure : undefined
                                            }
                                            onToggleStructureCandidate={
                                                isLatest
                                                    ? structureCandidateSelections.toggle
                                                    : undefined
                                            }
                                            result={turn.outcome.result}
                                            carriedStructureEntries={turn.carriedStructureEntries}
                                            selectedCandidateReceiptIds={
                                                isLatest
                                                    ? candidateSelections.batch
                                                    : (turn.submittedCandidateReceiptIds ??
                                                      EMPTY_CANDIDATE_SELECTION_BATCH)
                                            }
                                            selectedStructureCandidateReceiptIds={
                                                isLatest
                                                    ? structureCandidateSelections.batch
                                                    : (turn.submittedStructureCandidateReceiptIds ??
                                                      EMPTY_CANDIDATE_SELECTION_BATCH)
                                            }
                                            pending={isPending}
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
