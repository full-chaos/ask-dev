/**
 * ask-dev's render entry (CHAOS-12381; CHAOS-12378 part A). One render of Ask Dev exists, here in
 * ask-dev; a host such as web imports it from this entry (`@full-chaos/ask-dev/render`, a git
 * dependency pinned to an ask-dev commit) and never copies or redraws it.
 *
 * What this entry may reach is held by `render-entry.test.ts`: no `@/` import (a host resolves
 * `@/` against its own tree), no `next`, no `server-only`, no Node built-in, and no Workbench
 * library at run time. ask-dev's server code (`lib/acr/*`, the API routes) and its standalone
 * chrome (`shell/AppHeader`) are not part of it. The stylesheet is exported beside it
 * (`@full-chaos/ask-dev/ask-dev.css`); a host renders inside an element with the class `ask-dev`.
 */
export { AskDevChat } from "../components/chat/AskDevChat";
export {
    DeterministicAnswerView,
    type DeterministicAnswerViewProps,
} from "../components/DeterministicAnswerView";
