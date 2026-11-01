import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import type { InvestigationResult } from "@/lib/contracts";
import { mockScenarios } from "@/test/fixtures/investigations";

/**
 * CHAOS-12429: rules a host panel and sheet set for the one render.
 *  - AI output is labelled where a model wrote the analysis (AGENTS.md "Label AI output").
 *  - A panel inside a transcript is a named group, never a landmark: two turns repeat the names
 *    (axe `landmark-unique`).
 */
const complete = (): InvestigationResult =>
    mockScenarios().find((scenario) => scenario.id === "complete")!.result;

function withSynthesis(result: InvestigationResult, synthesis: string | undefined) {
    const { synthesis_version: _dropped, ...rest } = result.versions;
    const versions = synthesis === undefined ? rest : { ...rest, synthesis_version: synthesis };
    return { ...result, versions } as unknown as InvestigationResult;
}

describe("the AI label", () => {
    it("shows AI-written on an answer a model wrote", () => {
        render(<DeterministicAnswerView result={withSynthesis(complete(), "synthesis-v1")} />);

        expect(screen.getByTestId("answer-ai-label")).toHaveTextContent("AI-written");
    });

    it("reads a missing synthesis version as model-written: a label too many is safer", () => {
        render(<DeterministicAnswerView result={withSynthesis(complete(), undefined)} />);

        expect(screen.getByTestId("answer-ai-label")).toBeInTheDocument();
    });

    it("shows no label where no model wrote the answer", () => {
        render(<DeterministicAnswerView result={withSynthesis(complete(), "not_synthesized")} />);

        expect(screen.queryByTestId("answer-ai-label")).toBeNull();
        expect(screen.queryByText("AI-written")).toBeNull();
    });

    it("labels a clarification a model wrote too: the old render did not gate on status", () => {
        const clarification = mockScenarios().find((s) => s.id === "clarification")!.result;
        render(<DeterministicAnswerView result={withSynthesis(clarification, "synthesis-v1")} />);

        expect(screen.getByTestId("answer-ai-label")).toBeInTheDocument();
    });
});

describe("panels in a transcript", () => {
    it("two stacked turns hold no region landmark, and every panel keeps its name", () => {
        render(
            <>
                <DeterministicAnswerView result={complete()} />
                <DeterministicAnswerView result={complete()} />
            </>,
        );

        expect(screen.queryAllByRole("region")).toEqual([]);
        for (const name of ["Answer", "Coverage"]) {
            // `article` is also named Answer: count the group only.
            expect(screen.getAllByRole("group", { name })).toHaveLength(2);
        }
    });
});
