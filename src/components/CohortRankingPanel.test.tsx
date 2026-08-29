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
        // Nothing was withheld — there was no score to withhold.
        expect(screen.queryByTestId("score-withheld")).not.toBeInTheDocument();
    });

    it("WITHHOLDS a score the contract accepts but nothing explains (fail closed)", () => {
        // The pinned schema accepts this: `outcome: "qualified"` requires
        // `score`, and `drivers` is only bounded when `data_completeness` is
        // present. So Ajv passes it and this view is the last place to catch
        // it — AGENTS.md:40 requires failing closed rather than masking an
        // answer-quality failure.
        const bareScore: Cohort = {
            ...cohort,
            members: [
                {
                    ...cohort.members[0]!,
                    data_completeness: undefined,
                    drivers: undefined,
                },
            ],
        } as unknown as Cohort;
        render(<CohortRankingPanel cohort={bareScore} />);

        // The number itself never reaches the DOM.
        expect(screen.queryByText("43.5")).not.toBeInTheDocument();
        expect(screen.getByTestId("score-withheld")).toBeInTheDocument();
        expect(screen.getByText("No drivers reported — score withheld.")).toBeInTheDocument();
        // Withheld, not dropped: the row and its outcome still render, so the
        // member is not silently omitted either.
        expect(screen.getAllByTestId("ranking-row")).toHaveLength(1);
        expect(screen.getByText("qualified")).toBeInTheDocument();
    });

    it("says nothing about completeness for a complete, untruncated cohort", () => {
        render(<CohortRankingPanel cohort={cohort} />);
        expect(screen.queryByTestId("cohort-incomplete-notice")).not.toBeInTheDocument();
    });

    it("qualifies a ranking built from an INCOMPLETE cohort", () => {
        // `unrankedLabels` can only name members the cohort still carries, so
        // teams dropped during discovery are invisible here. Without this
        // notice the table reads as an exhaustive ranking of every team
        // (AGENTS.md checks 11 and 12).
        const incomplete: Cohort = { ...cohort, complete: false, truncated: false };
        render(<CohortRankingPanel cohort={incomplete} />);
        expect(screen.getByTestId("cohort-incomplete-notice")).toHaveTextContent(
            /did not report this cohort as complete/,
        );
    });

    it("qualifies a ranking built from a TRUNCATED cohort", () => {
        const truncated: Cohort = { ...cohort, complete: false, truncated: true };
        render(<CohortRankingPanel cohort={truncated} />);
        expect(screen.getByTestId("cohort-incomplete-notice")).toHaveTextContent(
            /cohort was truncated/,
        );
    });

    it("gives each mounted panel its own heading id", () => {
        // Several answered turns coexist on the chat surface; a hardcoded id
        // would point the second panel's `aria-labelledby` at the FIRST
        // panel's heading, naming the wrong turn.
        render(
            <>
                <CohortRankingPanel cohort={cohort} />
                <CohortRankingPanel cohort={cohort} />
            </>,
        );
        const [first, second] = screen.getAllByTestId("cohort-ranking-panel");
        const firstId = first!.getAttribute("aria-labelledby");
        const secondId = second!.getAttribute("aria-labelledby");
        expect(firstId).toBeTruthy();
        expect(firstId).not.toBe(secondId);
        // Each id actually resolves to that panel's OWN heading.
        expect(first!.querySelector(`[id="${firstId}"]`)).toBeInTheDocument();
        expect(second!.querySelector(`[id="${secondId}"]`)).toBeInTheDocument();
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
