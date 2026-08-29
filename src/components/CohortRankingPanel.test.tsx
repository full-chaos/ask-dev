import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CohortRankingPanel } from "@/components/CohortRankingPanel";
import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import type { Cohort, InvestigationResult } from "@/lib/contracts";

const result = canonicalResult as unknown as InvestigationResult;
const cohort = result.cohort!;

describe("CohortRankingPanel", () => {
    it("renders nothing without a cohort", () => {
        const { container } = render(<CohortRankingPanel cohort={undefined} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("renders nothing — not an empty table — when no member was ranked", () => {
        // "Ranking never ran" is a different claim from "ranked, and nothing
        // qualified". An empty table would state the second.
        const unranked: Cohort = {
            ...cohort,
            members: cohort.members.map(({ ranking_computed: _ranking, ...rest }) => rest),
        };
        const { container } = render(<CohortRankingPanel cohort={unranked} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("renders the pinned example's ranked member with score, outcome, completeness and window", () => {
        // Red on the parent pin: the example carried no ranked cohort member,
        // and `CohortMember` had no `score`/`outcome`/`data_completeness` at all.
        render(<CohortRankingPanel cohort={cohort} />);

        const rows = screen.getAllByTestId("ranking-row");
        expect(rows).toHaveLength(1);
        const row = within(rows[0]!);

        expect(row.getByText("CHAOS")).toBeInTheDocument();
        expect(row.getByText("43.5")).toBeInTheDocument();
        expect(row.getByText("qualified")).toBeInTheDocument();
        expect(row.getByText("complete")).toBeInTheDocument();
        expect(row.getByText("current")).toBeInTheDocument();
    });

    it("shows the top two drivers behind the score, strongest first", () => {
        render(<CohortRankingPanel cohort={cohort} />);
        const row = within(screen.getAllByTestId("ranking-row")[0]!);

        expect(row.getByText("operational deficiencies.severity")).toBeInTheDocument();
        expect(row.getByText("health.compounding risk")).toBeInTheDocument();
        // The three weaker drivers stay off the row — it is a summary, and the
        // full set is on the member in the canonical inspector.
        expect(row.queryByText("workload.forecast pressure")).not.toBeInTheDocument();
    });

    it("never shows a score without the drivers that explain it", () => {
        render(<CohortRankingPanel cohort={cohort} />);
        for (const element of screen.getAllByTestId("ranking-row")) {
            const cells = within(element).getAllByRole("cell");
            const scoreShown = cells[2]!.textContent !== "—";
            if (scoreShown) {
                expect(within(element).queryByText("No drivers reported.")).not.toBeInTheDocument();
            }
        }
    });

    it("names the cohort members the service did not rank, rather than dropping them", () => {
        // acr's own reference table drops unranked members; dropping them with
        // no word is the silent-discard shape this repo closes by policy.
        render(<CohortRankingPanel cohort={cohort} />);
        expect(screen.getByTestId("unranked-members")).toHaveTextContent("Platform");
    });

    it("says nothing about unranked members when every member was ranked", () => {
        const allRanked: Cohort = {
            ...cohort,
            members: cohort.members.map((cohortMember, index) => ({
                ...cohortMember,
                ranking_computed: true,
                attention_rank: index + 1,
            })),
        };
        render(<CohortRankingPanel cohort={allRanked} />);
        expect(screen.queryByTestId("unranked-members")).not.toBeInTheDocument();
    });

    it("renders an em dash, not a blank or a zero, for a member carrying no score", () => {
        const scoreless: Cohort = {
            ...cohort,
            members: [
                {
                    ...cohort.members[0]!,
                    outcome: "insufficient_evidence",
                    missing_signals: ["workload.forecast_pressure"],
                    score: undefined,
                    drivers: [],
                },
            ],
        } as unknown as Cohort;
        render(<CohortRankingPanel cohort={scoreless} />);
        const cells = within(screen.getAllByTestId("ranking-row")[0]!).getAllByRole("cell");
        expect(cells[2]!.textContent).toBe("—");
        expect(screen.getByText("No drivers reported.")).toBeInTheDocument();
    });

    it("discloses a member's missing signals", () => {
        const scoreless: Cohort = {
            ...cohort,
            members: [
                {
                    ...cohort.members[0]!,
                    outcome: "insufficient_evidence",
                    missing_signals: ["workload.forecast_pressure"],
                    score: undefined,
                },
            ],
        } as unknown as Cohort;
        render(<CohortRankingPanel cohort={scoreless} />);
        expect(screen.getByText(/missing signals: workload.forecast pressure/)).toBeInTheDocument();
    });
});
