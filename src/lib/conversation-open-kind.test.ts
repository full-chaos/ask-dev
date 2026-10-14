import { describe, expect, it } from "vitest";

import { deriveParentReference, type ConversationSourceTurn } from "@/lib/conversation";

const turns = (kind: string): readonly ConversationSourceTurn[] => [
    { role: "user", id: 0, question: "q", createdAt: "2026-01-01T00:00:00.000Z" },
    {
        role: "assistant",
        id: 1,
        createdAt: "2026-01-01T00:00:01.000Z",
        outcome: {
            kind: "answered",
            result: {
                deterministic_answer: "a",
                result_id: "result_1",
                subject_resolution: {
                    committed: [
                        { kind, canonical_id: "x:1", label: "Alpha" },
                        { kind: "team", canonical_id: "team:1", label: "Core" },
                    ],
                },
            },
        },
    },
];

describe("P2-3: an unsendable subject kind is disclosed, not silently dropped", () => {
    it("keeps parentResultId, hints the known kind, and names the unsent subject", () => {
        const ref = deriveParentReference(turns("new_entity"));
        expect(ref.parentResultId).toBe("result_1");
        expect(ref.subjectHints.map((h) => h.id)).toEqual(["team:1"]);
        expect(ref.unsentSubjects).toEqual([{ kind: "new_entity", label: "Alpha" }]);
    });

    it("reports nothing unsent when every kind is documented", () => {
        expect(deriveParentReference(turns("project")).unsentSubjects).toEqual([]);
    });
});
