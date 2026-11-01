"use client";

import {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type ReactNode,
} from "react";

import { ChatComposer, type ChatComposerHandle } from "./ChatComposer";
import { ChatContextChips } from "./ChatContextChips";
import { ChatFeedback } from "./ChatFeedback";
import { ChatHistory } from "./ChatHistory";
import { ChatProgressView } from "./ChatProgressView";
import { ChatStatusPanel } from "./ChatStatusPanel";
import {
    ChatEarlierTurns,
    ChatNotSavedNotice,
    ChatThreadNotShown,
    isNotShownThread,
} from "./ChatThreadState";
import { ClarificationPopup } from "./ClarificationPopup";
import { InspectorRail } from "./InspectorRail";
import { DeterministicAnswerView } from "../DeterministicAnswerView";
import { EvidenceOpenContext, type EvidenceOpen } from "../EvidenceOpenContext";
import { FailurePanel } from "../FailurePanel";
import type { ClarificationChoice } from "../ClarificationPanel";
import { EMPTY_CANDIDATE_SELECTION_BATCH } from "../../lib/candidate-selections";
import { subjectForReceipt } from "../../lib/clarification";
import { buildClarificationPages, type PopupOptionSource } from "../../lib/clarification-popup";
import type { BoundStructureReceipt, InvestigationResult } from "../../lib/contracts";
import { withholdUnrankableRankings } from "../../lib/ranking-withheld";
import {
    EMPTY_SELECTION_EVENTS,
    type StructureSelectionBatch,
} from "../../lib/structure-selections";
import { useCandidateSelections } from "../../lib/use-candidate-selections";
import { useStructureSelections } from "../../lib/use-structure-selections";
import { CHAT_STATUS_COPY, CTA_LABELS, TRANSCRIPT_COPY } from "../../render/chat-copy";
import {
    type AskIntent,
    type BatchItem,
    type ChatEvidenceSource,
    type ChatHistorySnapshot,
    type ChatSource,
    type ChatTurn,
    type ChatUserTurn,
    composerLockOf,
    isNonAnswer,
    isRetryableStatus,
    type SubmittedSelections,
} from "../../render/source";
import { createStandaloneSource } from "../../render/standalone-source";

/**
 * Ask Dev — the chat surface (chat pivot, Phase 1), as one embeddable unit:
 * conversation rail, timeline + composer, and the latest answer's sources
 * rail. It renders no app chrome and no <main> landmark, and sizes itself to
 * its container, so a host (the standalone page, or dev-health-web's
 * AppShell later) supplies both.
 *
 * The Workbench (`/workbench`) is a panel-stack shell chris has declared
 * TEMPORARY; this is the target UX — a Claude/ChatGPT-style conversation:
 * a growing timeline of user/assistant turns and a composer at the bottom.
 *
 * CHAOS-12382: the conversation comes from a `ChatSource` (`@/render/source`).
 * The component holds UI state only — the selection hooks, the popup's
 * dismissal and auto-confirm, scroll pinning, the composer — and asks
 * through the source with an intent; it never builds a request body. With
 * no `source` prop it creates `createStandaloneSource()`, which calls the
 * SAME server hop the Workbench does (`/api/investigations`), which calls
 * the real ACR investigation API — there is no mock path here either
 * (CHAOS-3738's hard boundary holds for every surface, not just the
 * Workbench). A host (web) passes its own source and gets this same render,
 * including the outcomes only a host reports: a pending turn's progress, a
 * no-answer `status`, and Stop.
 *
 * CHAOS-12387: the same seam carries what only a host has. The left rail
 * gains the saved conversations (`ChatHistory`), an answer gains feedback
 * (`ChatFeedback`), the composer gains the page's context
 * (`ChatContextChips`) and a lock, and the timeline gains the states of a
 * conversation opened from History (`ChatThreadState`). All of it is
 * optional on the source: the standalone source offers none, so the
 * standalone app is unchanged.
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

function formatTurnTime(isoTimestamp: string): string {
    return new Date(isoTimestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Treated as "at the bottom" within this many pixels — content settling
// (fonts, an answer's own height) shifts scrollHeight by a few px even while
// a tester is genuinely pinned to the bottom.
const BOTTOM_PIN_THRESHOLD_PX = 48;

/**
 * The withheld boundary where a result enters this render (`@/lib/ranking-withheld`). No person
 * ranking may reach a screen, and a host's turns reach this component without passing through
 * ask-dev's route or `createStandaloneSource`, so the render applies the boundary itself and no
 * source can skip it. A result that needs nothing keeps its turn's object identity; a result the
 * boundary has already rebuilt has no cohort, so a second pass keeps the marker beside it.
 */
export function withheldTurn(turn: ChatTurn): ChatTurn {
    if (turn.role !== "assistant" || turn.outcome.kind !== "answered") return turn;
    // A host's value crosses the seam here: its type proves nothing at run time.
    const result: unknown = turn.outcome.result;
    const boundary = withholdUnrankableRankings(result as InvestigationResult);
    if (boundary.result === result) return turn;
    return {
        ...turn,
        outcome: {
            ...turn.outcome,
            result: boundary.result,
            rankingWithheld: boundary.rankingWithheld,
        },
    };
}

/**
 * CHAOS-12426: gives one answered turn's evidence buttons their opener. The value is memoized per
 * turn, and `open` names this turn's own result id, so two answers citing one reference each open
 * their own citation. Without `evidence` it is a pass-through and the references stay plain.
 */
function EvidenceOpenProvider({
    evidence,
    resultId,
    children,
}: {
    readonly evidence: ChatEvidenceSource | undefined;
    readonly resultId: string;
    readonly children: ReactNode;
}) {
    const value = useMemo<EvidenceOpen | null>(
        () =>
            evidence === undefined
                ? null
                : {
                      open: (refId, label) => {
                          evidence.open({ refId, resultId, label });
                      },
                  },
        [evidence, resultId],
    );
    return <EvidenceOpenContext.Provider value={value}>{children}</EvidenceOpenContext.Provider>;
}

export type AskDevChatProps = {
    /** Where the conversation comes from. Absent: one standalone source per mount. */
    readonly source?: ChatSource;
};

/** What the chat column shows. `history` is reachable only under the left rail's width. */
type ChatView = "conversation" | "history";

/** A source that offers history and has not published one: the list says it is loading. */
const HISTORY_NOT_READ: ChatHistorySnapshot = {
    status: "idle",
    rows: [],
    currentId: null,
    hasMore: false,
    loadingMore: false,
    moreFailed: false,
    deleting: [],
    deleteFailed: null,
    running: false,
};

const NO_TURNS: readonly ChatTurn[] = [];

/**
 * The assistant turns under a user turn whose question was not recorded. A batch's turns share one
 * user turn, so each reads the nearest one before it. Web's rule: such a question is never sent
 * again, so its turn offers no choice and no re-ask, and its answer still renders.
 */
function turnsOfUnrecordedQuestions(turns: readonly ChatTurn[]): ReadonlySet<number> {
    const ids = new Set<number>();
    let recorded = true;
    for (const turn of turns) {
        if (turn.role === "user") recorded = turn.question !== null;
        else if (!recorded) ids.add(turn.id);
    }
    return ids;
}

export function AskDevChat({ source }: AskDevChatProps = {}) {
    const [standaloneSource] = useState(() => createStandaloneSource());
    const chat = source ?? standaloneSource;
    // All of `ChatSurface`'s state belongs to one source: a turn id is unique
    // per source only, so a dismissal, a selection or a pending retry must
    // not reach the next source's turns. A new generation remounts it.
    const [mounted, setMounted] = useState({ chat, generation: 0 });
    // Above `ChatSurface`, because it outlives a conversation: deleting the
    // conversation shown leaves the viewer on the list, as web's panel does.
    const [view, setView] = useState<ChatView>("conversation");
    if (mounted.chat !== chat) {
        setMounted({ chat, generation: mounted.generation + 1 });
        setView("conversation");
    }
    // The same rule inside one source (CHAOS-12387): turn ids may repeat across
    // its conversations, so another conversation remounts `ChatSurface` too.
    // Read by its own store hook: a primitive is stable, so a turn of this
    // conversation does not render this component. See
    // `ChatSnapshot.conversationKey`.
    const subscribe = useCallback((listener: () => void) => chat.subscribe(listener), [chat]);
    const getConversationKey = () => chat.getSnapshot().conversationKey;
    const conversationKey = useSyncExternalStore(subscribe, getConversationKey, getConversationKey);
    return (
        <ChatSurface
            chat={chat}
            key={JSON.stringify([mounted.generation, conversationKey ?? null])}
            onViewChange={setView}
            view={view}
        />
    );
}

function ChatSurface({
    chat,
    view,
    onViewChange,
}: {
    readonly chat: ChatSource;
    readonly view: ChatView;
    readonly onViewChange: (view: ChatView) => void;
}) {
    const domId = useId();
    // Called through the source (never detached), so a source whose methods
    // read `this` still works; stable per source, so React subscribes once.
    const subscribe = useCallback((listener: () => void) => chat.subscribe(listener), [chat]);
    const getSnapshot = () => chat.getSnapshot();
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const { thread } = snapshot;
    // A conversation that cannot be shown draws none of its turns: not in the
    // timeline, the rail, the popup or the sources rail.
    const threadNotShown = isNotShownThread(thread) ? thread : undefined;
    const turnsToShow = threadNotShown === undefined ? snapshot.turns : NO_TURNS;
    const turns = useMemo(() => turnsToShow.map(withheldTurn), [turnsToShow]);
    const unrecorded = useMemo(() => turnsOfUnrecordedQuestions(turns), [turns]);
    const composerLock = composerLockOf(snapshot);
    const composerHidden = snapshot.composerHidden === true;
    const offersStop =
        snapshot.stoppable && chat.stop !== undefined && threadNotShown === undefined;
    // The list is read only while it is on screen (CHAOS-12429): a host's narrow panel hides the
    // rail, and opening that panel sends nothing. The stylesheet alone knows the rail's width, so
    // this reads what it did, not a second copy of the breakpoint.
    const historyRail = useRef<HTMLElement>(null);
    const [railOnScreen, setRailOnScreen] = useState(false);
    const offersHistory = chat.history !== undefined;
    useEffect(() => {
        const rail = historyRail.current;
        if (!offersHistory || rail === null) return;
        const measure = () => {
            setRailOnScreen(window.getComputedStyle(rail).display !== "none");
        };
        measure();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(measure);
        observer.observe(rail.parentElement ?? rail);
        return () => {
            observer.disconnect();
        };
    }, [offersHistory]);
    const historyOnScreen = railOnScreen || view === "history";
    // The first read of the list waits for the host's first history (see
    // `ChatHistorySource.load`). Here and not in `ChatHistory`: that component
    // is drawn in two places, and neither may read on its own.
    const historyPublished = snapshot.history !== undefined;
    const currentHistoryId = snapshot.history?.currentId ?? null;
    // Held in a ref, because Strict Mode runs a mount's effect twice and one
    // surface reads a conversation's list once. A list that left the screen
    // is read again when it comes back: it may have been hidden for hours.
    const historyReadFor = useRef<string | null | undefined>(undefined);
    useEffect(() => {
        if (!historyOnScreen) {
            historyReadFor.current = undefined;
            return;
        }
        if (!historyPublished || historyReadFor.current === currentHistoryId) return;
        historyReadFor.current = currentHistoryId;
        chat.history?.load();
    }, [chat, historyOnScreen, historyPublished, currentHistoryId]);
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
    // CHAOS-5107 (codex review round 3): set by a narrower re-ask's own
    // click handler, immediately before it calls `composerRef.current.
    // retry(narrowedQuestion)`, and consumed synchronously at the START of
    // the resulting `ask()` call, before any `await` — a ref rather than
    // state for the same reason `popupAutoConfirmRef` above is a ref: `ask`
    // runs inside the SAME synchronous call stack `retry` starts, well
    // before React could apply a `setState`, so a state variable read here
    // would still see its PRE-update value. Carries the chain's ORIGINAL
    // question through any number of consecutive narrower re-asks; a plain
    // composer ask (typed by hand, or a bare Retry) never sets it, so `ask`
    // falls back to the text actually being sent.
    const pendingNarrowingRootRef = useRef<string | undefined>(undefined);
    // CHAOS-12382: the turn a Retry sends again, set by `retryTurn` and
    // consumed synchronously at the START of the `ask()` call it triggers,
    // for the same reason `pendingNarrowingRootRef` above is a ref. A Retry
    // reaches `source.retry`, never `source.ask`: a host re-sends under the
    // SAME key, and `ask` would start a second run.
    const pendingRetryTurnRef = useRef<number | undefined>(undefined);
    const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
    const [hasUnseenBelow, setHasUnseenBelow] = useState(false);
    // A source's update renders synchronously, BEFORE the ask resolves and
    // the composer clears its draft. The emptied composer then takes another
    // height, which moves the timeline's bottom, so the autoscroll below
    // runs once more for that commit.
    const [draftClears, setDraftClears] = useState(0);
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
    }, [turns, isPinnedToBottom, draftClears, view]);

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
     * Asks through the source. Reads and resets the selection hooks first,
     * so every selection outcome observed since the last reset rides this
     * request (CHAOS-4171), and a plain new ask (the common composer path)
     * clears any unconfirmed candidate picks left over from the turn it
     * supersedes too — otherwise the NEXT result's candidate panel would
     * open with stale selections from a different result's candidates.
     *
     * A Retry (`retryTurn`) comes through here too, so it keeps the same
     * selection reads and resets, and goes to `source.retry` instead.
     *
     * Returns whether the turn answered (`true`) or not (`false`), so the
     * composer can decide whether to clear its draft — the only thing that
     * return value is for.
     */
    function ask(
        question: string,
        intent: Omit<AskIntent, "narrowingRoot" | "selectionEvents"> = {},
    ): Promise<boolean> {
        // Consumed ONCE, synchronously, before anything else in this
        // function can yield — see each ref's own doc comment.
        const retryTurnId = pendingRetryTurnRef.current;
        pendingRetryTurnRef.current = undefined;
        const narrowingRoot = pendingNarrowingRootRef.current;
        pendingNarrowingRootRef.current = undefined;
        // CHAOS-4171: every selection outcome observed since the last
        // reset() rides this SAME request — the route is the sink (see
        // `useStructureSelections`'s own `pendingSelectionEvents` header).
        // Read before every hook's `reset()` below. All THREE selection
        // hooks are merged here (codex review: a tester can toggle a
        // candidate, then fire a PLAIN ask or a structure confirm without
        // ever confirming that candidate pick — `reset()` would otherwise
        // discard its queued telemetry silently).
        const selectionEvents = [
            ...structureSelections.pendingSelectionEvents,
            ...candidateSelections.pendingSelectionEvents,
            ...structureCandidateSelections.pendingSelectionEvents,
        ];
        structureSelections.reset();
        candidateSelections.reset();
        structureCandidateSelections.reset();
        return retryTurnId === undefined
            ? chat.ask(question, { ...intent, narrowingRoot, selectionEvents })
            : chat.retry(retryTurnId, { ...intent, narrowingRoot, selectionEvents });
    }

    /**
     * Sends a turn again through the composer's OWN submit path
     * (draft-clear-on-success, preserve-and-select-on-failure) — never
     * `source.retry` directly, which would leave the composer showing stale,
     * already-answered text after a successful retry (codex review round 2).
     *
     * The ref is cleared after the call: `ask()` has already consumed it
     * when the composer submitted, and a composer that refused (a blank
     * question) must not leave it for the next typed question.
     */
    function retryTurn(turnId: number, question: string) {
        pendingRetryTurnRef.current = turnId;
        composerRef.current?.retry(question);
        pendingRetryTurnRef.current = undefined;
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
        supersedes: SubmittedSelections,
    ): void {
        const question = result.question;
        if (subjectChoices.length === 0 && structureCandidateReceipts.length === 0) return;
        // Read BEFORE any reset() — a plain synchronous read at the top of
        // this ONE call, never re-read after a loop iteration's own
        // re-render (codex review: a stale closure re-reading a hook after
        // `.reset()` sees the SAME pre-reset value on every iteration,
        // which is why the per-request fan-out below is built in ONE
        // synchronous pass rather than a sequence of awaited `ask()` calls
        // that could each re-enter this component's hooks).
        const selectionEvents = [
            ...structureSelections.pendingSelectionEvents,
            ...candidateSelections.pendingSelectionEvents,
            ...structureCandidateSelections.pendingSelectionEvents,
        ];
        structureSelections.reset();
        candidateSelections.reset();
        structureCandidateSelections.reset();

        // CHAOS-12003: both axes picked against the SAME `result` (the popup
        // walks them as consecutive pages) must travel in ONE request. Two
        // requests would be sequential against one result, and the second
        // always carries a receipt the first's newer result has superseded
        // (`no_match`, "kind vetoed stale"). The first structure-candidate
        // receipt therefore rides the first subject request; any further
        // ones keep the one-request-per-entry fan-out (CHAOS-4343 design;
        // same-axis multi-pick is tracked in CHAOS-12146).
        const foldedStructureReceipt: BoundStructureReceipt | undefined =
            subjectChoices.length > 0 ? structureCandidateReceipts[0] : undefined;
        const fanOutStructureReceipts =
            foldedStructureReceipt === undefined
                ? structureCandidateReceipts
                : structureCandidateReceipts.slice(1);
        const fanOut: readonly Omit<BatchItem, "selectionEvents">[] = [
            ...subjectChoices.map((choice, index) => ({
                priorSubjectReceipts: [choice],
                structureBatch:
                    index === 0 && foldedStructureReceipt !== undefined
                        ? { ...otherStructureBatch, subject_candidate: foldedStructureReceipt }
                        : otherStructureBatch,
                chosenSubject: subjectForReceipt(result, choice.receipt_id),
            })),
            // Structure `candidate_options` entries carry no `SubjectRef`
            // (unlike `subject_resolution.candidates`) — nothing to show
            // via ChoiceNotice for those.
            ...fanOutStructureReceipts.map((receipt) => ({
                priorSubjectReceipts: [],
                structureBatch: { ...otherStructureBatch, subject_candidate: receipt },
                chosenSubject: undefined,
            })),
        ];
        chat.askBatch(
            fanOut.map((item, index) => ({
                ...item,
                selectionEvents: index === 0 ? selectionEvents : EMPTY_SELECTION_EVENTS,
            })),
            question,
            supersedes,
        );
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
        const supersedes: SubmittedSelections = {
            turnId: latestAssistantTurn.id,
            submittedStructureBatch: pendingStructureBatch,
            submittedCandidateReceiptIds: new Set(choices.map((choice) => choice.receipt_id)),
            submittedStructureCandidateReceiptIds: new Set(
                pendingStructureCandidateReceipts.map((receipt) => receipt.receipt_id),
            ),
        };
        confirmSelections(
            result,
            choices,
            pendingStructureCandidateReceipts,
            pendingStructureBatch,
            supersedes,
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
        const supersedes: SubmittedSelections = {
            turnId: latestAssistantTurn.id,
            submittedStructureBatch: batch,
            submittedStructureCandidateReceiptIds: new Set(
                candidateReceipts.map((receipt) => receipt.receipt_id),
            ),
            submittedCandidateReceiptIds: new Set(
                pendingSubjectChoices.map((choice) => choice.receipt_id),
            ),
        };
        if (candidateReceipts.length === 0 && pendingSubjectChoices.length === 0) {
            // Exact pre-CHAOS-4343 shape: no candidate axis in play at all,
            // one plain re-ask carrying only the ordinary structure batch.
            void ask(result.question, { structureBatch: batch, supersedes });
            return;
        }
        confirmSelections(result, pendingSubjectChoices, candidateReceipts, batch, supersedes);
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
        composerLock === undefined &&
        !composerHidden &&
        latestAssistantTurn?.role === "assistant" &&
        latestAssistantTurn.outcome.kind === "answered" &&
        latestAssistantTurn.id !== dismissedPopupTurnId &&
        !unrecorded.has(latestAssistantTurn.id)
            ? buildClarificationPages(
                  latestAssistantTurn.outcome.result,
                  structureSelections.batch,
                  structureCandidateSelections.batch,
                  candidateSelections.batch,
              )
            : [];

    const askedQuestions = turns.filter(
        (turn): turn is ChatUserTurn => turn.role === "user" && turn.showBubble,
    );
    const latestAnswered =
        latestAssistantTurn?.role === "assistant" && latestAssistantTurn.outcome.kind === "answered"
            ? latestAssistantTurn.outcome.result
            : undefined;

    function turnDomId(turnId: number): string {
        return `${domId}-turn-${turnId}`;
    }

    /**
     * Starts a fresh conversation: the next ask threads no prior turns, so
     * no subject, window or receipt carries over. The selection hooks are
     * NOT reset here — the next `ask()` resets them after reading their
     * pending selection telemetry, so nothing queued is dropped.
     */
    function startOver() {
        chat.newConversation();
        setDismissedPopupTurnId(undefined);
        setIsPinnedToBottom(true);
        setHasUnseenBelow(false);
        onViewChange("conversation");
        composerRef.current?.focus();
    }

    function showTurn(turnId: number) {
        document.getElementById(turnDomId(turnId))?.scrollIntoView({ block: "start" });
    }

    /**
     * One component, drawn where the viewer can reach it. `inColumn`: `rail__new` is not there, so
     * the list brings its own way to start over.
     */
    function historyList(inColumn: boolean) {
        if (chat.history === undefined) return null;
        const { history } = chat;
        return (
            <ChatHistory
                history={snapshot.history ?? HISTORY_NOT_READ}
                onNew={inColumn ? () => startOver() : undefined}
                onOpen={(id) => {
                    history.open(id);
                    onViewChange("conversation");
                }}
                renderConnect={() => chat.slots?.connect?.()}
                source={history}
            />
        );
    }

    return (
        <div className="ask-dev ask-frame">
            <div className="ask">
                <aside
                    aria-label="This conversation"
                    className="ask__rail ask__rail--left"
                    ref={historyRail}
                >
                    <button
                        className="rail__new"
                        disabled={isPending || turns.length === 0}
                        onClick={startOver}
                        type="button"
                    >
                        <svg
                            aria-hidden="true"
                            fill="none"
                            height="16"
                            stroke="currentColor"
                            strokeWidth="2"
                            viewBox="0 0 24 24"
                            width="16"
                        >
                            <path d="M12 5v14M5 12h14" />
                        </svg>
                        New question
                    </button>
                    <div className="rail__section">
                        <h2 className="rail__label">This conversation</h2>
                        {askedQuestions.length === 0 ? (
                            <p className="rail__empty">The questions you ask appear here.</p>
                        ) : (
                            <ol className="rail__list">
                                {askedQuestions.map((turn, index) => (
                                    <li key={turn.id}>
                                        <button
                                            aria-current={
                                                index === askedQuestions.length - 1
                                                    ? "true"
                                                    : undefined
                                            }
                                            className={
                                                index === askedQuestions.length - 1
                                                    ? "rail__item rail__item--current"
                                                    : "rail__item"
                                            }
                                            onClick={() => showTurn(turn.id)}
                                            type="button"
                                        >
                                            <span className="sr-only">Show the question </span>
                                            {turn.question === null ? (
                                                <em>{CHAT_STATUS_COPY.questionNotRecorded}</em>
                                            ) : (
                                                `“${turn.question}”`
                                            )}
                                            <span className="rail__item-meta">
                                                {formatTurnTime(turn.createdAt)}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </div>
                    {/* One list at a time, so its test ids stay unique on a page. */}
                    {view === "conversation" ? historyList(false) : null}
                </aside>

                <section aria-label="Ask Dev conversation" className="chat">
                    {chat.history === undefined ? null : (
                        // The left rail goes away at the container's 860px, and this
                        // bar comes in at that width (ask-dev.css). It stays while the
                        // list is open, so a wider container keeps its way back.
                        <div
                            className={
                                view === "history"
                                    ? "chat__narrow-bar chat__narrow-bar--open"
                                    : "chat__narrow-bar"
                            }
                        >
                            <button
                                aria-pressed={view === "history"}
                                className="chat__action"
                                data-testid="ask-dev-history-toggle"
                                onClick={() => {
                                    onViewChange(view === "history" ? "conversation" : "history");
                                }}
                                type="button"
                            >
                                {view === "history"
                                    ? CTA_LABELS.askDevBackToConversation
                                    : CTA_LABELS.askDevHistory}
                            </button>
                        </div>
                    )}
                    {view === "history" ? (
                        <div className="chat__history">{historyList(true)}</div>
                    ) : null}
                    {/* Hidden, not unmounted: the draft, the scroll and a run's
                        `await` in the composer all outlive a look at the list. */}
                    <div className="chat__timeline-wrap" hidden={view === "history"}>
                        <div
                            aria-label="Conversation"
                            className="chat__timeline"
                            role="log"
                            aria-live="polite"
                            onScroll={handleTimelineScroll}
                            ref={timelineRef}
                        >
                            {thread?.kind === "loaded" &&
                            thread.earlier !== "none" &&
                            chat.loadEarlier !== undefined ? (
                                <ChatEarlierTurns
                                    earlier={thread.earlier}
                                    onLoad={() => {
                                        chat.loadEarlier?.();
                                    }}
                                />
                            ) : null}
                            {threadNotShown !== undefined ? (
                                <ChatThreadNotShown
                                    kind={threadNotShown.kind}
                                    onNew={startOver}
                                    onRetry={
                                        chat.reloadThread === undefined
                                            ? undefined
                                            : () => {
                                                  chat.reloadThread?.();
                                              }
                                    }
                                    renderConnect={() => chat.slots?.connect?.()}
                                />
                            ) : turns.length === 0 && thread?.kind === "restoring" ? (
                                <p
                                    className="chat__status-meta"
                                    data-testid="ask-dev-conversation-loading"
                                >
                                    {TRANSCRIPT_COPY.loading}
                                </p>
                            ) : turns.length === 0 && snapshot.notSaved === true ? (
                                <ChatNotSavedNotice />
                            ) : turns.length === 0 ? (
                                <div className="chat__intro">
                                    <h2 className="chat__intro-title">
                                        Where is your engineering effort{" "}
                                        <span className="chat__intro-accent">actually going?</span>
                                    </h2>
                                    <p className="chat__empty">
                                        {thread === undefined
                                            ? "Ask a question to start an investigation."
                                            : TRANSCRIPT_COPY.empty}
                                    </p>
                                </div>
                            ) : (
                                turns.map((turn) => {
                                    if (turn.role === "user") {
                                        // CHAOS-4670: a silent receipt-carrying
                                        // re-ask renders nothing here — see
                                        // `ChatUserTurn`'s `showBubble` doc comment.
                                        if (!turn.showBubble) return null;
                                        return (
                                            <div
                                                className="chat__turn chat__turn--user"
                                                id={turnDomId(turn.id)}
                                                key={turn.id}
                                            >
                                                <p className="chat__meta chat__meta--user">
                                                    You · {formatTurnTime(turn.createdAt)}
                                                </p>
                                                {turn.question === null ? (
                                                    <p
                                                        className="chat__bubble chat__bubble--not-recorded"
                                                        data-testid="ask-dev-turn-question-not-recorded"
                                                    >
                                                        {CHAT_STATUS_COPY.questionNotRecorded}
                                                    </p>
                                                ) : (
                                                    <p className="chat__bubble">{turn.question}</p>
                                                )}
                                            </div>
                                        );
                                    }

                                    // A locked conversation takes no question, so its
                                    // last turn is read-only like every earlier one:
                                    // web's `usable`, and an old receipt cannot be sent.
                                    const isLatest =
                                        composerLock === undefined &&
                                        turn.id === latestAssistantTurn?.id;
                                    // Web's rule: a question that was not recorded
                                    // cannot be sent again, so its turn reads like an
                                    // earlier one: no choice and no re-ask.
                                    const offersChoice =
                                        isLatest && !unrecorded.has(turn.id) && !composerHidden;
                                    // The turns BEFORE this assistant turn's own user
                                    // turn are what this follow-up derived its carry
                                    // from; say so when a subject could not ride along.
                                    const carryNotice =
                                        turn.outcome.kind === "answered"
                                            ? turn.outcome.scopeLossNotice
                                            : undefined;

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
                                            {carryNotice === undefined ? null : (
                                                <p
                                                    className="record__meta"
                                                    data-testid="follow-up-scope-not-carried"
                                                >
                                                    {carryNotice}
                                                </p>
                                            )}
                                            {turn.outcome.kind === "pending" ? (
                                                turn.outcome.progress === undefined ? (
                                                    <p className="chat__pending" role="status">
                                                        Investigating…
                                                    </p>
                                                ) : (
                                                    <ChatProgressView
                                                        progress={turn.outcome.progress}
                                                    />
                                                )
                                            ) : null}
                                            {turn.outcome.kind === "status" ? (
                                                <ChatStatusPanel
                                                    connect={
                                                        turn.outcome.status.kind === "connect"
                                                            ? chat.slots?.connect?.()
                                                            : undefined
                                                    }
                                                    onReload={
                                                        // A GET re-read, never a resend, so it is
                                                        // not held to the latest turn. Web offers
                                                        // it on any restored turn.
                                                        turn.outcome.status.kind ===
                                                            "restore_failed" &&
                                                        chat.reloadTurn !== undefined
                                                            ? () => {
                                                                  chat.reloadTurn?.(turn.id);
                                                              }
                                                            : undefined
                                                    }
                                                    onRetry={
                                                        // The same rule and the same path as
                                                        // `FailurePanel`'s Retry below: latest
                                                        // turn, plain ask, through the composer.
                                                        offersChoice &&
                                                        isRetryableStatus(turn.outcome) &&
                                                        turn.retryQuestion !== undefined
                                                            ? () => {
                                                                  retryTurn(
                                                                      turn.id,
                                                                      turn.retryQuestion!,
                                                                  );
                                                              }
                                                            : undefined
                                                    }
                                                    pending={isPending}
                                                    retry={turn.outcome.retry}
                                                    status={turn.outcome.status}
                                                />
                                            ) : null}
                                            {turn.outcome.kind === "failed" ? (
                                                <FailurePanel
                                                    failure={turn.outcome.failure}
                                                    pending={isPending}
                                                    originalQuestion={turn.rootQuestion}
                                                    onRetry={
                                                        offersChoice &&
                                                        turn.retryQuestion !== undefined &&
                                                        turn.outcome.failure.retryable
                                                            ? () => {
                                                                  retryTurn(
                                                                      turn.id,
                                                                      turn.retryQuestion!,
                                                                  );
                                                              }
                                                            : undefined
                                                    }
                                                    onNarrowerReask={
                                                        // CHAOS-5107: same availability rule as
                                                        // `onRetry` (plain-ask-only, latest-turn-only),
                                                        // but NOT gated on `retryable` — a 413 budget
                                                        // refusal is never retryable, yet is exactly
                                                        // when this fires. Through the same composer
                                                        // submit path as retry, for the same reason.
                                                        offersChoice &&
                                                        turn.rootQuestion !== undefined &&
                                                        turn.outcome.failure
                                                            .narrowerContinuation !== undefined
                                                            ? (narrowedQuestion: string) => {
                                                                  // CHAOS-5107 (codex review round 3):
                                                                  // carries the CHAIN's root forward so a
                                                                  // second consecutive budget refusal
                                                                  // narrows the tester's real question
                                                                  // again, not the already-narrowed text
                                                                  // this turn itself sent. Set BEFORE
                                                                  // `retry`, consumed synchronously at
                                                                  // the start of the `ask()` call it
                                                                  // triggers — see the ref's own doc
                                                                  // comment.
                                                                  pendingNarrowingRootRef.current =
                                                                      turn.rootQuestion;
                                                                  composerRef.current?.retry(
                                                                      narrowedQuestion,
                                                                  );
                                                              }
                                                            : undefined
                                                    }
                                                />
                                            ) : null}
                                            {turn.outcome.kind === "answered" ? (
                                                <EvidenceOpenProvider
                                                    evidence={chat.evidence}
                                                    resultId={turn.outcome.result.result_id}
                                                >
                                                    <DeterministicAnswerView
                                                        chosenSubject={turn.chosenSubject}
                                                        onConfirmCandidates={
                                                            offersChoice
                                                                ? chooseCandidates
                                                                : undefined
                                                        }
                                                        onConfirmStructure={
                                                            offersChoice
                                                                ? chooseStructure
                                                                : undefined
                                                        }
                                                        onRejectStructure={
                                                            offersChoice
                                                                ? structureSelections.reject
                                                                : undefined
                                                        }
                                                        onToggleCandidate={
                                                            offersChoice
                                                                ? candidateSelections.toggle
                                                                : undefined
                                                        }
                                                        onToggleStructure={
                                                            offersChoice
                                                                ? structureSelections.toggle
                                                                : undefined
                                                        }
                                                        onToggleStructureCandidate={
                                                            offersChoice
                                                                ? structureCandidateSelections.toggle
                                                                : undefined
                                                        }
                                                        rankingWithheld={
                                                            turn.outcome.rankingWithheld
                                                        }
                                                        result={turn.outcome.result}
                                                        selectedCandidateReceiptIds={
                                                            offersChoice
                                                                ? candidateSelections.batch
                                                                : (turn.submittedCandidateReceiptIds ??
                                                                  EMPTY_CANDIDATE_SELECTION_BATCH)
                                                        }
                                                        selectedStructureCandidateReceiptIds={
                                                            offersChoice
                                                                ? structureCandidateSelections.batch
                                                                : (turn.submittedStructureCandidateReceiptIds ??
                                                                  EMPTY_CANDIDATE_SELECTION_BATCH)
                                                        }
                                                        offersPresentation="popup"
                                                        pending={isPending}
                                                        structureBatch={
                                                            offersChoice
                                                                ? structureSelections.batch
                                                                : turn.submittedStructureBatch
                                                        }
                                                    />
                                                </EvidenceOpenProvider>
                                            ) : null}
                                            {turn.outcome.kind === "answered" &&
                                            chat.feedback !== undefined &&
                                            !isNonAnswer(turn.outcome.result.status) ? (
                                                <ChatFeedback
                                                    feedback={chat.feedback}
                                                    resultId={turn.outcome.result.result_id}
                                                />
                                            ) : null}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                        {hasUnseenBelow ? (
                            <button
                                className="chat__jump-to-latest"
                                onClick={jumpToLatest}
                                type="button"
                            >
                                Jump to latest ↓
                            </button>
                        ) : null}
                    </div>

                    <div
                        className="chat__composer-bar"
                        hidden={view === "history" || (composerHidden && !offersStop)}
                    >
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
                                onDismiss={() => {
                                    // codex round 3: move focus BEFORE the popup
                                    // unmounts (same synchronous handler that
                                    // removes it) — see `ChatComposerHandle.focus`'s
                                    // own doc comment for why a later effect is too
                                    // late.
                                    composerRef.current?.focus();
                                    setDismissedPopupTurnId(latestAssistantTurn?.id);
                                }}
                                onFreeText={(text) => void ask(text)}
                                onSelect={applyPopupSelection}
                                pages={popupPages}
                                pending={isPending}
                            />
                        )}
                        {offersStop ? (
                            <div className="chat__stop-row">
                                <button
                                    className="chat__stop"
                                    onClick={() => chat.stop?.()}
                                    type="button"
                                >
                                    <svg
                                        aria-hidden="true"
                                        fill="currentColor"
                                        height="10"
                                        viewBox="0 0 10 10"
                                        width="10"
                                    >
                                        <rect height="10" rx="2" width="10" />
                                    </svg>
                                    Stop
                                </button>
                            </div>
                        ) : null}
                        {chat.pageContext === undefined || composerHidden ? null : (
                            <ChatContextChips
                                onRemove={(ref) => {
                                    chat.pageContext?.remove(ref);
                                }}
                                refs={snapshot.pageContext ?? []}
                            />
                        )}
                        <ChatComposer
                            hidden={composerHidden}
                            lock={composerHidden ? undefined : composerLock}
                            onAsk={ask}
                            onDraftCleared={() => {
                                setDraftClears((count) => count + 1);
                            }}
                            pending={isPending}
                            ref={composerRef}
                        />
                    </div>
                </section>

                <InspectorRail result={latestAnswered} />
            </div>
        </div>
    );
}
