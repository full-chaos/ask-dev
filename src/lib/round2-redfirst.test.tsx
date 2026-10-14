import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CanonicalResultInspector } from "@/components/CanonicalResultInspector";
import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import { cohortRanking } from "@/lib/cohort-ranking";
import { deriveParentReference, unsentSubjectsNotice } from "@/lib/conversation";
import type { InvestigationResult } from "@/lib/contracts";
import { withholdUnrankableRankings } from "@/lib/ranking-withheld";

const base = canonicalResult as unknown as InvestigationResult;

function personResult(): InvestigationResult {
    return {
        ...base,
        interpretation: { ...base.interpretation, shape: "explicit_cohort" },
        cohort: {
            ...base.cohort!,
            kind: "person",
            members: base.cohort!.members.map((m) => ({
                ...m,
                subject: { ...m.subject, kind: "person" },
            })),
        },
    };
}

describe("P1: CanonicalResultInspector on a person cohort", () => {
    it("shows the withheld marker and no rank or score numbers", () => {
        const withheld = withholdUnrankableRankings(personResult());
        const { container } = render(
            <CanonicalResultInspector
                rankingWithheld={withheld.rankingWithheld}
                result={withheld.result}
            />,
        );
        expect(container.textContent).not.toContain("attention_rank");
        expect(container.textContent).not.toContain('"score"');
        expect(screen.getAllByText(/Ranking not shown/).length).toBeGreaterThan(0);
    });

    it("the boundary is idempotent", () => {
        const once = withholdUnrankableRankings(personResult());
        expect(withholdUnrankableRankings(once.result)).toEqual({ result: once.result });
    });
});

describe("P2-a: the 50-hint cap is disclosed", () => {
    it("names the subject removed by the cap", () => {
        const committed = Array.from({ length: 51 }, (_, i) => ({
            kind: "team",
            canonical_id: `team:${String(i)}`,
            label: `Team ${String(i)}`,
        }));
        const ref = deriveParentReference([
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
                        subject_resolution: { committed },
                    },
                },
            },
        ] as never);
        expect(ref.subjectHints).toHaveLength(50);
        expect(ref.unsentSubjects).toEqual([{ kind: "team", label: "Team 50" }]);
        expect(unsentSubjectsNotice(ref.unsentSubjects)).toMatch(/Team 50/);
    });
});

describe("P3: kind gate precedes ranking_computed", () => {
    it("a person cohort with no ranking_computed member is kind_not_ranked", () => {
        const p = personResult();
        const cohort = {
            ...p.cohort!,
            members: p.cohort!.members.map((m) => ({ ...m, ranking_computed: false })),
        };
        expect(cohortRanking("explicit_cohort", cohort).state).toBe("kind_not_ranked");
    });
    it("a person cohort with ranked members is kind_not_ranked", () => {
        expect(cohortRanking("explicit_cohort", personResult().cohort).state).toBe(
            "kind_not_ranked",
        );
    });
});
