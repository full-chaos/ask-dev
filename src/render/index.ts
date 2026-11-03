/**
 * ask-dev's render entry (CHAOS-12381; CHAOS-12378 part A). One render of Ask Dev exists, here in
 * ask-dev; a host such as web imports it from this entry (`@full-chaos/ask-dev/render`, a git
 * dependency pinned to an ask-dev commit) and never copies or redraws it.
 *
 * `AskDevChat` takes a `source` (CHAOS-12382): a host passes its own `ChatSource`; the standalone
 * app passes `createStandaloneSource(investigate)` (CHAOS-12106). What only a host offers (saved conversations,
 * feedback, page context, a conversation's own states; CHAOS-12387) renders from that source and
 * never in the standalone app.
 *
 * What this entry may reach is held by `render-entry.test.ts`: no `@/` import (a host resolves
 * `@/` against its own tree), no `next`, no server-side marker import, no Node built-in, and no Workbench
 * library at run time. ask-dev's browser ACR host (`lib/acr/*`) and its standalone
 * chrome (`shell/AppHeader`) are not part of it. The stylesheet is exported beside it
 * (`@full-chaos/ask-dev/ask-dev.css`); a host renders inside an element with the class `ask-dev`.
 */
export { AskDevChat, type AskDevChatProps } from "../components/chat/AskDevChat";
export {
    DeterministicAnswerView,
    type DeterministicAnswerViewProps,
} from "../components/DeterministicAnswerView";
export { BoundedAnswerView, type BoundedAnswerViewProps } from "../components/BoundedAnswerView";
export type { AnswerProjection } from "../lib/contracts";
export type { ShapeSlot } from "../components/ShapeSlotContext";
export type { WorkbenchFailure } from "../lib/acr/errors";
export type { RenderShape } from "../lib/contracts";
export type {
    CompletionForecastSummary,
    ForecastShapeDetail,
    ShapeDetail,
} from "../lib/render-shapes";
export {
    isBudgetRefusal,
    narrowerContinuationCopy,
    REFUSAL_COPY,
} from "../lib/acr/narrower-continuation-copy";
export { ChatEvidenceBody, type ChatEvidenceBodyProps } from "../components/chat/ChatEvidenceBody";
export {
    createStandaloneSource,
    type StandaloneInvestigate,
    type StandaloneInvestigateOutcome,
    type StandaloneInvestigationOptions,
} from "./standalone-source";
export {
    composerLockOf,
    FEEDBACK_QUESTIONS,
    INVESTIGATION_STAGES,
    isNonAnswer,
    type AnsweredOutcome,
    type AskIntent,
    type BoundedOutcome,
    type AssistantOutcome,
    type BatchItem,
    type ChatAssistantTurn,
    type ChatContextRef,
    type ChatEvidenceDetail,
    type ChatEvidenceRef,
    type ChatEvidenceSource,
    type ChatEvidenceState,
    type ChatFeedbackEntry,
    type ChatFeedbackSource,
    type ChatHistoryRow,
    type ChatHistorySnapshot,
    type ChatHistorySource,
    type ChatProgress,
    type ChatSnapshot,
    type ChatSource,
    type ChatStatus,
    type ChatThreadAccess,
    type ChatTurn,
    type ChatUserTurn,
    type ComposerLock,
    type FailedOutcome,
    type FeedbackQuestion,
    type FeedbackValue,
    type InvestigationStage,
    type NotRunReason,
    type PendingOutcome,
    type ScopeKind,
    type StatusOutcome,
    type StoppedReason,
    type SubmittedSelections,
} from "./source";
export {
    CHAT_PROGRESS_COPY,
    CHAT_STAGE_COPY,
    CHAT_STATUS_COPY,
    chatStatusWords,
    COMPOSER_COPY,
    COMPOSER_LOCK_WORDS,
    CONTEXT_CHIPS_COPY,
    CTA_LABELS,
    EVIDENCE_COPY,
    FEEDBACK_COPY,
    formatElapsed,
    HISTORY_COPY,
    historyRowLabel,
    historyRowMeta,
    historyRowTitle,
    NOT_RUN_COPY,
    removeLabel,
    retryAfterText,
    SCOPE_KIND_LABEL,
    STOPPED_COPY,
    TRANSCRIPT_COPY,
} from "./chat-copy";
