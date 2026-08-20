import type { ConversationTurn } from "@/lib/contracts";

/**
 * Conversation threading (chat-surface follow-up context).
 *
 * The pinned request contract declares `conversation?: ConversationTurn[]`
 * (`@maxItems 50`) — an investigation can be told about the turns that led
 * up to it, so a follow-up question ("and what about last month?") does not
 * have to be answered as an independent investigation with no memory of
 * what "and" refers to. The chat surface is the ONLY caller: the Workbench
 * asks one independent question at a time by design (its own `ask()` resets
 * everything on every call), so it has no conversation to thread and keeps
 * sending none.
 */

/** The contract's own bound on `conversation` (`@maxItems 50`). */
export const MAX_CONVERSATION_TURNS_ON_WIRE = 50;

/**
 * How many of the chat surface's own prior turns are threaded into a
 * re-ask, most-recent-first before the slice.
 *
 * Bounded well under the wire's own 50-turn cap: sending every turn ever
 * asked in a long session would grow the request (and ACR's own prompt)
 * unboundedly for marginal benefit — a tester's most recent exchanges are
 * what actually disambiguates a follow-up. 20 turns is 10 user/assistant
 * exchanges, a generous window for a follow-up to reference.
 */
export const MAX_CONVERSATION_TURNS_SENT = 20;

/**
 * A chat-timeline turn this module can thread into `conversation`.
 *
 * Deliberately NOT imported from `src/app/page.tsx` — that file owns the
 * full `Turn` union (chosenSubject, submittedStructureBatch, and other
 * chat-surface-only fields this module has no use for); this is the minimal
 * structural shape `buildConversationTurns` actually reads, and page.tsx's
 * own `Turn[]` already satisfies it.
 */
export type ConversationSourceTurn =
    | {
          readonly role: "user";
          readonly id: number;
          readonly question: string;
          readonly createdAt: string;
      }
    | {
          readonly role: "assistant";
          readonly id: number;
          readonly createdAt: string;
          readonly outcome:
              | { readonly kind: "pending" }
              | { readonly kind: "failed" }
              | {
                    readonly kind: "answered";
                    readonly result: { readonly deterministic_answer: string };
                };
      };

/**
 * Builds the `conversation` field for a re-ask from the chat timeline's own
 * PRIOR turns — prior meaning already appended to `turns` before the fresh
 * user/assistant pair `ask()` is about to add for the CURRENT question; that
 * pair must never be included here (a re-ask's own not-yet-answered turn is
 * not its own prior context), so callers pass the timeline as it stood
 * before appending it.
 *
 * A pending or failed assistant turn is excluded: pending has no content
 * yet, and a failure's message is chrome the Workbench wrote, not something
 * ACR said, so it does not belong in the conversation ACR sees itself
 * having. A user turn always has content (the question itself).
 *
 * Bounded to the most recent `MAX_CONVERSATION_TURNS_SENT` here; capped
 * again to the wire's own `MAX_CONVERSATION_TURNS_ON_WIRE` by
 * `buildInvestigationRequest`, defense in depth against a future caller
 * that skips this function.
 */
export function buildConversationTurns(
    priorTurns: readonly ConversationSourceTurn[],
): readonly ConversationTurn[] {
    const settled: ConversationTurn[] = [];
    for (const turn of priorTurns) {
        if (turn.role === "user") {
            settled.push({
                turn_id: `turn_${String(turn.id)}`,
                role: "user",
                content: turn.question,
                created_at: turn.createdAt,
            });
            continue;
        }
        if (turn.outcome.kind !== "answered") continue;
        settled.push({
            turn_id: `turn_${String(turn.id)}`,
            role: "assistant",
            content: turn.outcome.result.deterministic_answer,
            created_at: turn.createdAt,
        });
    }
    return settled.slice(-MAX_CONVERSATION_TURNS_SENT);
}
