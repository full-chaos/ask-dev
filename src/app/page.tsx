"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ChatComposer, type ChatComposerHandle } from "@/components/chat/ChatComposer";
import { ClarificationPopup } from "@/components/chat/ClarificationPopup";
import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { FailurePanel } from "@/components/FailurePanel";
import type { ClarificationChoice } from "@/components/ClarificationPanel";
import type { WorkbenchFailure } from "@/lib/acr/errors";
import { EMPTY_CANDIDATE_SELECTION_BATCH } from "@/lib/candidate-selections";
import { subjectForReceipt } from "@/lib/clarification";
import { buildClarificationPages, type PopupOptionSource } from "@/lib/clarification-popup";
import { buildConversationTurns } from "@/lib/conversation";
import type {
    BoundStructureReceipt,
    ConversationTurn,
    InvestigationResult,
    SubjectRef,
} from "@/lib/contracts";
import { literalKindNounsInQuestion } from "@/lib/kind-nouns";
import {
    buildStructureReceiptFields,
    EMPTY_SELECTION_EVENTS,
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
          /**
           * CHAOS-4670: a receipt-carrying re-ask (a panel selection's
           * turn-2 request) resends this SAME question text — the turn
           * still runs for real on the wire (receipts/supersession
           * unchanged, still threaded into `buildConversationTurns` below
           * exactly as before), but showing it as a second user bubble
           * reads as though the tester asked twice. `false` for every
           * receipt-carrying re-ask (`confirmSelections`, and `ask()`'s own
           * non-plain call from `chooseStructure`'s single-batch fallback);
           * `true` for a plain composer ask or a plain-ask retry, which are
           * genuinely new/repeated questions and must render. The compact
           * record of what a silent re-run carried is the superseded
           * assistant turn's own selection chips
           * (`submittedStructureBatch`/`submittedCandidateReceiptIds`
           * below), already rendered — nothing else needs to change.
           */
          readonly showBubble: boolean;
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
    // CHAOS-4671: the popup clarification flow's own two small pieces of
    // state — everything ELSE it needs (what to render, what a pick means)
    // stays derived from the three selection hooks above, exactly as the
    // old inline panels already were.
    //
    // `dismissedPopupTurnId`: the assistant turn id whose popup the tester
    // closed via X — "proceed without the selection" (ticket). Compared by
    // id, not cleared explicitly: a fresh `ask()`/`confirmSelections()` call
    // always mints a NEW turn id, so a stale dismissal can never suppress a
    // later turn's popup by accident.
    const [dismissedPopupTurnId, setDismissedPopupTurnId] = useState<number | undefined>(undefined);
    // `popupAutoConfirmRef`/`popupAutoConfirmTick`: set by the popup's
    // `onComplete` the instant the flow reaches its last page, INSTEAD of
    // reading the selection hooks' `.batch` synchronously right there. A
    // same-tick toggle-then-read would see the toggle's PRE-update value
    // (React batches `setState` inside one event handler) — deferring the
    // actual `chooseStructure` call to the effect below, which runs only
    // after React has applied every batched update and re-rendered, is what
    // keeps the LAST pick counted. The ref (not a second piece of state)
    // carries WHICH turn to confirm; `popupAutoConfirmTick` only exists to
    // give that effect a dependency to fire on — the effect clears the ref
    // directly rather than calling `setState` on it, since a bare `setState`
    // inside an effect body is exactly what `react-hooks/set-state-in-effect`
    // flags, and a ref write is not state.
    const popupAutoConfirmRef = useRef<number | undefined>(undefined);
    const [popupAutoConfirmTick, setPopupAutoConfirmTick] = useState(0);

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
        structureCandidateSelections.reset();
        const askedAt = new Date().toISOString();
        setTurns((current) => [
            ...current,
            { role: "user", id: userTurnId, question, createdAt: askedAt, showBubble: isPlainAsk },
            {
                role: "assistant",
                id: assistantTurnId,
                createdAt: askedAt,
                outcome: { kind: "pending" },
                chosenSubject: chosen,
                submittedStructureBatch: undefined,
                submittedCandidateReceiptIds: undefined,
                submittedStructureCandidateReceiptIds: undefined,
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
        // Read AFTER every hook's `reset()` above but still the pre-reset
        // value: `setState` schedules a re-render, it does not mutate this
        // closure's already-captured array. All THREE selection hooks are
        // merged here (codex review: a tester can toggle a candidate, then
        // fire a PLAIN ask or a structure confirm without ever confirming
        // that candidate pick — `reset()` above would otherwise discard its
        // queued telemetry silently, since only THIS path's own request
        // would have carried it).
        const selectionEvents = [
            ...structureSelections.pendingSelectionEvents,
            ...candidateSelections.pendingSelectionEvents,
            ...structureCandidateSelections.pendingSelectionEvents,
        ];
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

        const structureReceiptFieldsBase = buildStructureReceiptFields(otherStructureBatch);

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

        const userTurnId = nextId.current++;
        const assistantTurns = items.map((item) => ({ id: nextId.current++, item }));

        setTurns((current) => [
            ...current,
            // CHAOS-4670: always silent — every `confirmSelections` call is
            // a receipt-carrying re-ask of a question already shown as a
            // user bubble on the turn(s) it supersedes.
            { role: "user", id: userTurnId, question, createdAt: askedAt, showBubble: false },
            ...assistantTurns.map(({ id, item }) => ({
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
                retryQuestion: undefined,
            })),
        ]);

        assistantTurns.forEach(({ id, item }, index) => {
            const priorSubjectReceipts = item.kind === "subject" ? [item.choice] : [];
            const structureReceiptFields =
                item.kind === "structure"
                    ? buildStructureReceiptFields({
                          ...otherStructureBatch,
                          subject_candidate: item.receipt,
                      })
                    : structureReceiptFieldsBase;
            void fireInvestigation({
                question,
                priorSubjectReceipts,
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

    /**
     * CHAOS-4671: fires the SAME re-ask `StructureNeedsPanel`'s "Ask again
     * with these selections" button always called — `chooseStructure`
     * itself already folds in every OTHER axis's pending picks (the
     * structure-candidate axis via `candidateReceipts` below, the
     * subject-resolution axis internally via `candidateSelections.batch`),
     * so this ONE call is correct regardless of which page(s) the tester
     * actually interacted with. See the `popupAutoConfirmTurnId` effect
     * below for why this runs on ITS OWN render rather than inline in the
     * popup's click handler.
     */
    useEffect(() => {
        const turnId = popupAutoConfirmRef.current;
        if (turnId === undefined) return;
        // Always consume the ref, even when it no longer names the latest
        // answered turn (a new ask() started before this effect ran) — an
        // effect that "consumes" by simply not going down the fire branch
        // would re-fire on every later render. A ref write, unlike
        // `setState`, is not itself flagged inside an effect body.
        popupAutoConfirmRef.current = undefined;
        if (
            latestAssistantTurn?.role !== "assistant" ||
            latestAssistantTurn.id !== turnId ||
            latestAssistantTurn.outcome.kind !== "answered"
        ) {
            return;
        }
        const { result } = latestAssistantTurn.outcome;
        chooseStructure(
            structureSelections.batch,
            structureCandidateReceiptsInAcrOrder(result, structureCandidateSelections.batch),
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps -- chooseStructure/structureCandidateReceiptsInAcrOrder are stable per-render closures over this component's own state, not external values that need their own dep entries (same pattern the file's other effects already follow).
    }, [
        popupAutoConfirmTick,
        latestAssistantTurn,
        structureSelections.batch,
        structureCandidateSelections.batch,
        candidateSelections.batch,
    ]);

    /** Applies one popup pick to whichever selection hook owns that offer's axis — zero wire changes, same three `toggle` functions the old inline panels already called. */
    function applyPopupSelection(source: PopupOptionSource) {
        if (source.kind === "structure") {
            structureSelections.toggle(source.member, source.receipt);
        } else if (source.kind === "structure-candidate") {
            structureCandidateSelections.toggle(source.receipt.receipt_id);
        } else {
            candidateSelections.toggle(source.receiptId);
        }
    }

    const popupPages =
        latestAssistantTurn?.role === "assistant" &&
        latestAssistantTurn.outcome.kind === "answered" &&
        latestAssistantTurn.id !== dismissedPopupTurnId
            ? buildClarificationPages(
                  latestAssistantTurn.outcome.result,
                  structureSelections.batch,
                  structureCandidateSelections.batch,
                  candidateSelections.batch,
              )
            : [];

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
                                // CHAOS-4670: a silent receipt-carrying
                                // re-ask renders nothing here — see
                                // `Turn`'s `showBubble` doc comment.
                                if (!turn.showBubble) return null;
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
                                            onToggleStructureCandidate={
                                                isLatest
                                                    ? structureCandidateSelections.toggle
                                                    : undefined
                                            }
                                            result={turn.outcome.result}
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
                                            offersPresentation="popup"
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
                {popupPages.length === 0 ? null : (
                    // Floats above the composer via CSS (`.clarification-popup`
                    // is `position: absolute`, this wrapper `position:
                    // relative`) — a DOM SIBLING of `ChatComposer`, never a
                    // wrapper around it, so the composer stays fully
                    // interactive underneath exactly as the ticket requires
                    // ("typing a normal reply is always allowed").
                    <ClarificationPopup
                        key={latestAssistantTurn?.id}
                        onComplete={() => {
                            if (latestAssistantTurn !== undefined) {
                                popupAutoConfirmRef.current = latestAssistantTurn.id;
                                setPopupAutoConfirmTick((tick) => tick + 1);
                            }
                        }}
                        onDismiss={() => setDismissedPopupTurnId(latestAssistantTurn?.id)}
                        onFreeText={(text) => void ask(text)}
                        onSelect={applyPopupSelection}
                        pages={popupPages}
                        pending={isPending}
                    />
                )}
                <ChatComposer pending={isPending} onAsk={ask} ref={composerRef} />
            </div>
        </main>
    );
}
