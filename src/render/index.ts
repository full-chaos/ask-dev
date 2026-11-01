/**
 * ask-dev's render entry (CHAOS-12381; CHAOS-12378 part A). One render of Ask Dev exists, here in
 * ask-dev; a host such as web imports it from this entry (`@full-chaos/ask-dev/render`, a git
 * dependency pinned to an ask-dev commit) and never copies or redraws it.
 *
 * `AskDevChat` takes an optional `source` (CHAOS-12382): a host passes its own `ChatSource`; with
 * none it runs on `createStandaloneSource()`.
 *
 * What this entry may reach is held by `render-entry.test.ts`: no `@/` import (a host resolves
 * `@/` against its own tree), no `next`, no `server-only`, no Node built-in, and no Workbench
 * library at run time. ask-dev's server code (`lib/acr/*`, the API routes) and its standalone
 * chrome (`shell/AppHeader`) are not part of it. The stylesheet is exported beside it
 * (`@full-chaos/ask-dev/ask-dev.css`); a host renders inside an element with the class `ask-dev`.
 */
export { AskDevChat, type AskDevChatProps } from "../components/chat/AskDevChat";
export {
    DeterministicAnswerView,
    type DeterministicAnswerViewProps,
} from "../components/DeterministicAnswerView";
export { createStandaloneSource } from "./standalone-source";
export {
    INVESTIGATION_STAGES,
    type AnsweredOutcome,
    type AskIntent,
    type AssistantOutcome,
    type BatchItem,
    type ChatAssistantTurn,
    type ChatProgress,
    type ChatSnapshot,
    type ChatSource,
    type ChatStatus,
    type ChatTurn,
    type ChatUserTurn,
    type FailedOutcome,
    type InvestigationStage,
    type NotRunReason,
    type PendingOutcome,
    type StatusOutcome,
    type StoppedReason,
    type SubmittedSelections,
} from "./source";
export {
    CHAT_PROGRESS_COPY,
    CHAT_STAGE_COPY,
    CHAT_STATUS_COPY,
    chatStatusWords,
    formatElapsed,
    NOT_RUN_COPY,
    retryAfterText,
    STOPPED_COPY,
} from "./chat-copy";
