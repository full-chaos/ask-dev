import { describe, expect, it } from "vitest";

import unsupportedResult from "@/contracts/examples/context_fabric_investigation_result_unsupported.v1.json";
import { buildInvestigationRequest } from "@/lib/acr/client";
import { validateContract } from "@/lib/acr/validate";
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

    /**
     * acr #504: an UNSUPPORTED result may carry `deterministic_answer: ""`
     * (its disclosure is in limitations/coverage/completeness, not an answer
     * sentence). Threaded as-is, that answer became a `ConversationTurn`
     * with `content: ""`, which the request contract refuses
     * (`content.minLength: 1`) -- so every later re-ask in the same chat
     * failed as `acr_rejected_request` before it was sent. An answered turn
     * with no answer sentence is excluded, like a pending or failed one:
     * there is nothing ACR said as an answer to thread. Blankness is judged
     * by the one swept `nonBlank` predicate, not a local `.trim()`.
     */
    it("excludes an answered assistant turn whose answer sentence is blank (acr's unsupported example), so the re-ask still validates", () => {
        expect(unsupportedResult.deterministic_answer).toBe("");
        const turns: readonly ConversationSourceTurn[] = [
            userTurn(0, "What is the actual status of Ask Dev?"),
            answeredAssistantTurn(1, unsupportedResult.deterministic_answer),
            userTurn(2, "What about last month?", "2026-01-01T00:00:02.000Z"),
            answeredAssistantTurn(3, "\u200b \n", "2026-01-01T00:00:03.000Z"),
        ];

        const conversation = buildConversationTurns(turns);
        expect(conversation.map((turn) => turn.turn_id)).toEqual(["turn_0", "turn_2"]);

        const request = buildInvestigationRequest("And now?", [], {}, conversation);
        const validation = validateContract(
            "context_fabric_investigation_request.v1.schema.json",
            request,
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
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
