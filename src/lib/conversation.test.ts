import { describe, expect, it } from "vitest";

import {
    MAX_CONVERSATION_TURNS_SENT,
    buildConversationTurns,
    type ConversationSourceTurn,
} from "@/lib/conversation";

const userTurn = (id: number, question: string, createdAt = "2026-01-01T00:00:00.000Z") =>
    ({ role: "user", id, question, createdAt }) as const;

const answeredAssistantTurn = (
    id: number,
    deterministicAnswer: string,
    createdAt = "2026-01-01T00:00:01.000Z",
) =>
    ({
        role: "assistant",
        id,
        createdAt,
        outcome: { kind: "answered", result: { deterministic_answer: deterministicAnswer } },
    }) as const;

const pendingAssistantTurn = (id: number, createdAt = "2026-01-01T00:00:01.000Z") =>
    ({ role: "assistant", id, createdAt, outcome: { kind: "pending" } }) as const;

const failedAssistantTurn = (id: number, createdAt = "2026-01-01T00:00:01.000Z") =>
    ({ role: "assistant", id, createdAt, outcome: { kind: "failed" } }) as const;

describe("buildConversationTurns", () => {
    it("returns nothing for an empty timeline (a turn's own first ask)", () => {
        expect(buildConversationTurns([])).toEqual([]);
    });

    it("maps a settled user/assistant exchange to ConversationTurn entries", () => {
        const turns: readonly ConversationSourceTurn[] = [
            userTurn(0, "What is the status of dev-health-ops?"),
            answeredAssistantTurn(1, "It is on track."),
        ];

        expect(buildConversationTurns(turns)).toEqual([
            {
                turn_id: "turn_0",
                role: "user",
                content: "What is the status of dev-health-ops?",
                created_at: "2026-01-01T00:00:00.000Z",
            },
            {
                turn_id: "turn_1",
                role: "assistant",
                content: "It is on track.",
                created_at: "2026-01-01T00:00:01.000Z",
            },
        ]);
    });

    it("excludes a pending assistant turn — it has no content yet", () => {
        const turns: readonly ConversationSourceTurn[] = [
            userTurn(0, "What is the status of dev-health-ops?"),
            pendingAssistantTurn(1),
        ];

        expect(buildConversationTurns(turns)).toEqual([
            {
                turn_id: "turn_0",
                role: "user",
                content: "What is the status of dev-health-ops?",
                created_at: "2026-01-01T00:00:00.000Z",
            },
        ]);
    });

    /**
     * A failure's message is chrome the Workbench wrote, not something ACR
     * said — it must never be threaded back into ACR as if it were part of
     * the conversation.
     */
    it("excludes a failed assistant turn", () => {
        const turns: readonly ConversationSourceTurn[] = [
            userTurn(0, "What is the status of dev-health-ops?"),
            failedAssistantTurn(1),
        ];

        expect(buildConversationTurns(turns)).toEqual([
            {
                turn_id: "turn_0",
                role: "user",
                content: "What is the status of dev-health-ops?",
                created_at: "2026-01-01T00:00:00.000Z",
            },
        ]);
    });

    it("caps at MAX_CONVERSATION_TURNS_SENT, keeping the MOST RECENT turns", () => {
        const turns: ConversationSourceTurn[] = [];
        for (let i = 0; i < MAX_CONVERSATION_TURNS_SENT + 4; i += 1) {
            turns.push(userTurn(i, `question ${String(i)}`));
        }

        const built = buildConversationTurns(turns);
        expect(built).toHaveLength(MAX_CONVERSATION_TURNS_SENT);
        expect(built[0]?.turn_id).toBe("turn_4");
        expect(built.at(-1)?.turn_id).toBe(`turn_${String(MAX_CONVERSATION_TURNS_SENT + 3)}`);
    });
});
