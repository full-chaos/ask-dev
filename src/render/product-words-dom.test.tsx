import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { InspectorRail } from "@/components/chat/InspectorRail";
import type { InvestigationResult } from "@/lib/contracts";
import { mockScenarios } from "@/test/fixtures/investigations";
import { structureMockScenarios } from "@/test/fixtures/structure-needs";

import {
    ANSWER_STATUS_LABEL,
    CANDIDATE_STATE_WORDS,
    COHORT_OUTCOME_WORDS,
    COMPLETENESS_STATE_WORDS,
    COVERAGE_STATE_WORDS,
    RECEIPT_DISPOSITION_WORDS,
    REQUIREMENT_OUTCOME_WORDS,
    STANDING_LABEL,
    STRUCTURE_DISPOSITION_WORDS,
} from "./answer-copy";

/**
 * CHAOS-12406: what `product-words.test.ts` cannot see, because it is a value at run time. Every
 * result the repo holds is rendered, and a raw state value must not reach a badge or a tooltip.
 * Served prose stays as served, so this reads the render's own chrome: badges and the attributes a
 * browser shows, never the answer's text.
 */
const EXAMPLES_DIR = path.resolve(import.meta.dirname, "../contracts/examples");

const examples: readonly (readonly [string, InvestigationResult])[] = readdirSync(EXAMPLES_DIR)
    .filter((file) => file.includes("investigation_result") && file.endsWith(".json"))
    .map((file) => [
        file,
        JSON.parse(readFileSync(path.join(EXAMPLES_DIR, file), "utf8")) as InvestigationResult,
    ]);

const results: readonly (readonly [string, InvestigationResult])[] = [
    ...examples,
    ...mockScenarios().map((scenario) => [scenario.id, scenario.result] as const),
    ...structureMockScenarios().map((scenario) => [scenario.id, scenario.result] as const),
];

const STATE_TABLES: readonly Readonly<Record<string, string>>[] = [
    ANSWER_STATUS_LABEL,
    CANDIDATE_STATE_WORDS,
    COHORT_OUTCOME_WORDS,
    COMPLETENESS_STATE_WORDS,
    COVERAGE_STATE_WORDS,
    RECEIPT_DISPOSITION_WORDS,
    REQUIREMENT_OUTCOME_WORDS,
    STANDING_LABEL,
    STRUCTURE_DISPOSITION_WORDS,
];

/** The raw values, and their old spaced form. A value that is its own word ("stale") is allowed. */
const RAW_STATES = new Set(
    STATE_TABLES.flatMap((table) =>
        Object.entries(table)
            .filter(([value, word]) => value !== word)
            .flatMap(([value]) => [value, value.replaceAll("_", " ")]),
    ),
);

afterEach(cleanup);

describe("the render's chrome over every result the repo holds", () => {
    it("holds results to read", () => {
        expect(results.length).toBeGreaterThan(10);
        expect(RAW_STATES.has("not_derived")).toBe(true);
        expect(RAW_STATES.has("not derived")).toBe(true);
    });

    it.each(results)("%s: no raw state in a badge", (_name, result) => {
        const { container } = render(<DeterministicAnswerView result={result} />);

        const badges = [...container.querySelectorAll(".badge")].map(
            (badge) => badge.textContent ?? "",
        );
        expect(badges.filter((text) => RAW_STATES.has(text))).toEqual([]);
    });

    it.each(results)("%s: no raw value in an attribute a browser shows", (_name, result) => {
        const { container } = render(
            <>
                <DeterministicAnswerView result={result} />
                <InspectorRail result={result} />
            </>,
        );

        const shown = [...container.querySelectorAll("[title]")].map(
            (node) => node.getAttribute("title") ?? "",
        );
        expect(shown.filter((title) => RAW_STATES.has(title) || /_/u.test(title))).toEqual([]);
    });

    it.each(results)("%s: no receipt and no canonical id on the page", (_name, result) => {
        const { container } = render(<DeterministicAnswerView result={result} />);

        const candidates = result.subject_resolution.candidates;
        const text = container.textContent ?? "";
        for (const candidate of candidates) {
            expect(text).not.toContain(candidate.receipt_id);
            if (candidate.subject.canonical_id.includes(":")) {
                expect(text).not.toContain(candidate.subject.canonical_id);
            }
        }
        expect(within(container).queryAllByText(/^receipt\b/u)).toEqual([]);
    });
});
