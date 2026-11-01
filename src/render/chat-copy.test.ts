import { describe, expect, it } from "vitest";

import { CHAT_STATUS_COPY, formatElapsed, NOT_RUN_COPY, STOPPED_COPY } from "./index";

/** CHAOS-12382: what the entry exports for the C adapter. Web's words, written out. */
describe("the copy the render entry exports", () => {
    it("holds the words a host passes as text, and web's reference and Load again words", () => {
        expect(CHAT_STATUS_COPY.questionNotRecorded).toBe("Question not recorded");
        expect(CHAT_STATUS_COPY.reference).toBe("Reference");
        expect(CHAT_STATUS_COPY.loadAgain).toBe("Load again");
    });

    it("exports the not_run and stopped tables, with every reason", () => {
        expect(Object.keys(NOT_RUN_COPY).sort()).toEqual([
            "access_denied",
            "budget_refusal",
            "no_repository",
            "not_entitled",
            "rate_limited",
            "repo_forbidden",
        ]);
        expect(Object.keys(STOPPED_COPY).sort()).toEqual([
            "interpretation_rejected",
            "rate_limited",
            "synthesis_rejected",
        ]);
    });
});

describe("formatElapsed", () => {
    it.each([
        [0, "0:00"],
        [-5_000, "0:00"],
        [999, "0:00"],
        [65_000, "1:05"],
        [3_599_000, "59:59"],
        [3_600_000, "1:00:00"],
        [3_725_000, "1:02:05"],
    ])("%d ms reads %s", (ms, text) => {
        expect(formatElapsed(ms)).toBe(text);
    });
});
