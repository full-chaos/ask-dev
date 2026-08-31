import { describe, expect, it } from "vitest";

import { buildClarificationPages } from "@/lib/clarification-popup";
import type { InvestigationResult } from "@/lib/contracts";
import { EMPTY_STRUCTURE_SELECTION_BATCH } from "@/lib/structure-selections";
import { mockScenarios } from "@/test/fixtures/investigations";
import { structureMockScenarios } from "@/test/fixtures/structure-needs";

const clarification = mockScenarios().find((scenario) => scenario.id === "clarification")!.result;
const answered = mockScenarios().find((scenario) => scenario.id === "complete")!.result;
const structureKind = structureMockScenarios().find(
    (scenario) => scenario.id === "structure-kind",
)!.result;
const structureCandidate = structureMockScenarios().find(
    (scenario) => scenario.id === "structure-candidate",
)!.result;
const structureAnchorWindow = structureMockScenarios().find(
    (scenario) => scenario.id === "structure-anchor-window",
)!.result;
const structureAggregate = structureMockScenarios().find(
    (scenario) => scenario.id === "structure-aggregate-never-elicit",
)!.result;

const EMPTY_IDS: ReadonlySet<string> = new Set();

describe("buildClarificationPages", () => {
    it("returns no pages for a decisive result with nothing to clarify", () => {
        expect(
            buildClarificationPages(
                answered,
                EMPTY_STRUCTURE_SELECTION_BATCH,
                EMPTY_IDS,
                EMPTY_IDS,
            ),
        ).toEqual([]);
    });

    it("builds one single-select page per structure_needs member, in priority order, options verbatim", () => {
        const pages = buildClarificationPages(
            structureAnchorWindow,
            EMPTY_STRUCTURE_SELECTION_BATCH,
            EMPTY_IDS,
            EMPTY_IDS,
        );

        expect(pages.map((page) => page.key)).toEqual(["subject_anchor", "window"]);
        expect(pages[0]!.selectMode).toBe("single");
        expect(pages[0]!.title).toBe("Which repository, project, or team?");
        expect(pages[0]!.options).toEqual([
            {
                id: "anchor_repo_atlas",
                label: "full-chaos/atlas",
                displayText: "full-chaos/atlas",
                selected: false,
                source: {
                    kind: "structure",
                    member: "subject_anchor",
                    receipt: {
                        result_id: structureAnchorWindow.result_id,
                        receipt_id: "ancr_repo_atlas_0001",
                    },
                },
            },
        ]);
    });

    it("marks the option matching the batch's current pick as selected, and no other", () => {
        const pages = buildClarificationPages(
            structureKind,
            {
                expected_kind: {
                    result_id: structureKind.result_id,
                    receipt_id: "kindr_pull_request_0001",
                },
            },
            EMPTY_IDS,
            EMPTY_IDS,
        );

        const kindPage = pages.find((page) => page.key === "expected_kind")!;
        expect(kindPage.options.map((option) => [option.label, option.selected])).toEqual([
            ["CI pipeline run", false],
            ["Pull request", true],
        ]);
    });

    it("gives a member with zero offered options no page at all (no dead filler)", () => {
        // `structureKind`'s own scenario carries ONLY kind_options — every
        // other member has none, and none of them appear.
        const pages = buildClarificationPages(
            structureKind,
            EMPTY_STRUCTURE_SELECTION_BATCH,
            EMPTY_IDS,
            EMPTY_IDS,
        );
        expect(pages).toHaveLength(1);
        expect(pages[0]!.key).toBe("expected_kind");
    });

    it("builds the structure-candidate axis as a MULTI-select page, reading selection from the structure-candidate id set", () => {
        const [first, second] = structureCandidate.structure_needs!.candidate_options!;
        const pages = buildClarificationPages(
            structureCandidate,
            EMPTY_STRUCTURE_SELECTION_BATCH,
            new Set([first!.receipt_id]),
            EMPTY_IDS,
        );

        expect(pages).toHaveLength(1);
        expect(pages[0]!.key).toBe("subject_candidate");
        expect(pages[0]!.selectMode).toBe("multi");
        expect(pages[0]!.options.map((option) => option.selected)).toEqual([true, false]);
        expect(pages[0]!.options[0]!.source).toEqual({
            kind: "structure-candidate",
            receipt: { result_id: structureCandidate.result_id, receipt_id: first!.receipt_id },
        });
        void second;
    });

    it("appends the subject_resolution candidate page LAST, only when status is clarification_required", () => {
        const pages = buildClarificationPages(
            clarification,
            EMPTY_STRUCTURE_SELECTION_BATCH,
            EMPTY_IDS,
            EMPTY_IDS,
        );

        expect(pages).toHaveLength(1);
        expect(pages[0]!.key).toBe("subject_resolution");
        expect(pages[0]!.selectMode).toBe("multi");
        expect(pages[0]!.title).toBe(clarification.subject_resolution.clarification_prompt);
        expect(pages[0]!.options.map((option) => option.source)).toEqual(
            clarification.subject_resolution.candidates.map((candidate) => ({
                kind: "subject-candidate",
                receiptId: candidate.receipt_id,
            })),
        );
    });

    /**
     * The bug this pins: `subject_resolution.candidates` can be non-empty on
     * a DECISIVE result too (ranked candidates riding along even once
     * committed) — without the status gate, a plain complete answer would
     * wrongly pop up a "did you mean" page over nothing to clarify.
     */
    it("never builds the subject_resolution page for a DECISIVE result, even when candidates are present", () => {
        const decisiveWithCandidates: InvestigationResult = {
            ...structuredClone(answered),
            subject_resolution: {
                ...structuredClone(answered.subject_resolution),
                candidates: structuredClone(clarification.subject_resolution.candidates),
            },
        };
        expect(decisiveWithCandidates.status).not.toBe("clarification_required");

        const pages = buildClarificationPages(
            decisiveWithCandidates,
            EMPTY_STRUCTURE_SELECTION_BATCH,
            EMPTY_IDS,
            EMPTY_IDS,
        );
        expect(pages).toEqual([]);
    });

    it("carries structure_needs pages on a DECISIVE result unconditionally (structure_needs is not status-gated)", () => {
        expect(structureAggregate.status).not.toBe("clarification_required");
        const pages = buildClarificationPages(
            structureAggregate,
            EMPTY_STRUCTURE_SELECTION_BATCH,
            EMPTY_IDS,
            EMPTY_IDS,
        );
        expect(pages).toHaveLength(1);
        expect(pages[0]!.key).toBe("window");
    });

    it("orders BOTH families on the same result: structure members first, subject_resolution last", () => {
        const mixed: InvestigationResult = {
            ...structuredClone(clarification),
            structure_needs: structureKind.structure_needs!,
        };
        const pages = buildClarificationPages(
            mixed,
            EMPTY_STRUCTURE_SELECTION_BATCH,
            EMPTY_IDS,
            EMPTY_IDS,
        );
        expect(pages.map((page) => page.key)).toEqual(["expected_kind", "subject_resolution"]);
    });

    it("prefers an offer's model `phrasing` for displayText but keeps the structural `label` on the option itself", () => {
        const [first] = structureKind.structure_needs!.kind_options!;
        // `structureKind`'s own fixture carries no phrasing (isolated
        // elsewhere) — this proves the fail-open path: no phrasing means
        // displayText falls back to label exactly.
        const pages = buildClarificationPages(
            structureKind,
            EMPTY_STRUCTURE_SELECTION_BATCH,
            EMPTY_IDS,
            EMPTY_IDS,
        );
        expect(pages[0]!.options[0]).toMatchObject({
            label: first!.label,
            displayText: first!.label,
        });
    });
});
