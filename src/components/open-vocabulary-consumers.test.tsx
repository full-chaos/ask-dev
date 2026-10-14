import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CohortRankingPanel } from "@/components/CohortRankingPanel";
import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { SemanticReadingNotice } from "@/components/SemanticReadingNotice";
import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import type { Cohort, InvestigationResult } from "@/lib/contracts";

const result = canonicalResult as unknown as InvestigationResult;

function cohortOfKind(kind: string): Cohort {
    const base = result.cohort!;
    return {
        ...base,
        kind,
        members: base.members.map((member) => ({
            ...member,
            subject: { ...member.subject, kind },
        })),
    };
}

describe("P1-1: a cohort of an undocumented or person kind never renders a ranking", () => {
    it.each(["person", "user", "contributor", "new_entity_kind"])(
        "renders no ranking rows for cohort kind %s",
        (kind) => {
            render(
                <CohortRankingPanel
                    cohort={cohortOfKind(kind)}
                    result={undefined}
                    shape="explicit_cohort"
                />,
            );
            expect(screen.queryAllByTestId("ranking-row")).toHaveLength(0);
            expect(screen.queryByText(/Ranked/)).not.toBeInTheDocument();
            expect(screen.getByTestId("cohort-ranking-withheld")).toHaveTextContent(
                /does not rank|not ranked/i,
            );
        },
    );

    it("a team cohort whose MEMBER subject is a person also renders no ranking", () => {
        const cohort = cohortOfKind("team");
        const mixed: Cohort = {
            ...cohort,
            members: cohort.members.map((m) => ({
                ...m,
                subject: { ...m.subject, kind: "person" },
            })),
        };
        render(<CohortRankingPanel cohort={mixed} result={undefined} shape="explicit_cohort" />);
        expect(screen.queryAllByTestId("ranking-row")).toHaveLength(0);
    });

    it("the whole answer view ranks nothing and shows no driver footnote table for person", () => {
        const person: InvestigationResult = {
            ...result,
            interpretation: { ...result.interpretation, shape: "explicit_cohort" },
            cohort: cohortOfKind("person"),
        };
        render(<DeterministicAnswerView result={person} />);
        expect(screen.queryAllByTestId("ranking-row")).toHaveLength(0);
    });

    it("still ranks a documented team cohort (positive control)", () => {
        render(
            <CohortRankingPanel
                cohort={cohortOfKind("team")}
                result={undefined}
                shape="explicit_cohort"
            />,
        );
        expect(screen.getAllByTestId("ranking-row").length).toBeGreaterThan(0);
    });
});

describe("P2-4: unknown semantic_reading.reason is not claimed as unreadable", () => {
    it("renders a neutral sentence for an unknown reason", () => {
        const { container } = render(
            <SemanticReadingNotice
                semanticReading={
                    { status: "unavailable", reason: "semantic_state_migrated" } as never
                }
            />,
        );
        expect(container.textContent).not.toMatch(/could not be read/);
        expect(container.textContent).toMatch(/could not check/);
    });

    it("keeps the documented sentences", () => {
        const { container } = render(
            <SemanticReadingNotice
                semanticReading={
                    { status: "unavailable", reason: "semantic_state_unreadable" } as never
                }
            />,
        );
        expect(container.textContent).toMatch(/could not be read/);
    });
});
