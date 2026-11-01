import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AskDevChat } from "@/components/chat/AskDevChat";
import shapesExample from "@/contracts/examples/context_fabric_investigation_result_render_shapes.v1.json";
import type { InvestigationResult } from "@/lib/contracts";
import type { ChatSnapshot, ChatSource } from "@/render/source";

/**
 * CHAOS-12382 F1: the sources rail reads only fields the boundary keeps, so nothing on screen tells
 * which result it got. This records the prop instead: the rail is handed the withheld result.
 */
const rail = vi.hoisted(() => ({ results: [] as unknown[] }));

vi.mock("@/components/chat/InspectorRail", () => ({
    InspectorRail: ({ result }: { result: unknown }) => {
        rail.results.push(result);
        return null;
    },
}));

function sourceOf(result: InvestigationResult): ChatSource {
    const snapshot: ChatSnapshot = {
        stoppable: false,
        turns: [
            {
                role: "user",
                id: 0,
                question: "Who ships the most?",
                createdAt: "2026-10-30T12:00:00.000Z",
                showBubble: true,
            },
            {
                role: "assistant",
                id: 1,
                createdAt: "2026-10-30T12:00:00.000Z",
                outcome: { kind: "answered", result },
                chosenSubject: undefined,
                submittedStructureBatch: undefined,
                submittedCandidateReceiptIds: undefined,
                submittedStructureCandidateReceiptIds: undefined,
                retryQuestion: undefined,
                rootQuestion: undefined,
            },
        ],
    };
    return {
        subscribe: () => () => undefined,
        getSnapshot: () => snapshot,
        ask: () => Promise.resolve(true),
        askBatch: () => undefined,
        retry: () => Promise.resolve(true),
        newConversation: () => undefined,
    };
}

describe("the sources rail (F1)", () => {
    beforeEach(() => {
        rail.results.length = 0;
    });

    it("is handed the withheld result of a host's raw person cohort", () => {
        const rankable = shapesExample as unknown as InvestigationResult;
        const person: InvestigationResult = {
            ...rankable,
            cohort: { ...rankable.cohort!, kind: "person" },
        };
        render(<AskDevChat source={sourceOf(person)} />);
        const handed = rail.results.at(-1) as InvestigationResult;
        expect(handed.result_id).toBe(rankable.result_id);
        expect(handed.cohort).toBeUndefined();
        expect(handed.render_shapes).toBeUndefined();
    });

    it("is handed a rankable result as it came", () => {
        const rankable = shapesExample as unknown as InvestigationResult;
        render(<AskDevChat source={sourceOf(rankable)} />);
        expect(rail.results.at(-1)).toBe(rankable);
    });
});
