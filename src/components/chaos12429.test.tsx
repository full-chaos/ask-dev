import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CohortRankingPanel } from "@/components/CohortRankingPanel";
import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { DriversPanel } from "@/components/DriversPanel";
import { FactRowsPanels } from "@/components/FactRowsPanel";
import shapesExample from "@/contracts/examples/context_fabric_investigation_result_render_shapes.v1.json";
import type { ClaimedFact, Cohort, CohortMember, InvestigationResult } from "@/lib/contracts";
import { visibleText } from "@/test/visible-text";

/**
 * CHAOS-12429: the render meets web's written rules for a host: ranking column (B), G1 (D), the
 * no-score caption under a cohort chart (E) and the owning-team roll-up label (F). The fixtures are
 * the pinned render-shapes capture, changed only where a case needs it.
 */
const example = shapesExample as unknown as InvestigationResult;
const teamCohort = example.cohort!;

const withCohort = (cohort: Cohort): InvestigationResult => ({ ...example, cohort });

function recolour(kind: string, memberKind?: string): Cohort {
    return {
        ...teamCohort,
        kind,
        members: teamCohort.members.map((m) => ({
            ...m,
            subject: { ...m.subject, kind: memberKind ?? kind },
        })),
    };
}

describe("B: the ranking column is the served driver rows, never the completeness enum", () => {
    const panel = (cohort: Cohort) =>
        render(
            <CohortRankingPanel
                cohort={cohort}
                result={withCohort(cohort)}
                shape="discovered_cohort"
            />,
        );

    it("has no Data completeness column and shows no completeness word", () => {
        panel(teamCohort);
        expect(screen.queryByRole("columnheader", { name: /completeness/iu })).toBeNull();
        const text = visibleText(screen.getByTestId("cohort-ranking-panel"));
        expect(text).not.toMatch(/data completeness/iu);
        // the capture serves data_completeness: "complete" on the ranked member
        expect(teamCohort.members[0]!.data_completeness).toBe("complete");
        const row = within(screen.getAllByTestId("ranking-row")[0]!);
        expect(row.queryByText("complete")).toBeNull();
    });

    it("a member shows N of 5 drivers from its served driver rows", () => {
        panel(teamCohort);
        expect(screen.getByTestId("ranking-drivers-count")).toHaveTextContent("5 of 5 drivers");
    });

    it("partial is not mapped to a number: 3 served rows say 3, whatever the enum says", () => {
        const member: CohortMember = {
            ...teamCohort.members[0]!,
            data_completeness: "partial",
            drivers: teamCohort.members[0]!.drivers!.slice(0, 3) as CohortMember["drivers"] & [],
        };
        panel({ ...teamCohort, members: [member, teamCohort.members[1]!] });
        expect(screen.getByTestId("ranking-drivers-count")).toHaveTextContent("3 of 5 drivers");
    });

    it("a member that serves no driver rows shows no completeness text", () => {
        const { drivers: _drivers, ...bare } = teamCohort.members[0]!;
        panel({
            ...teamCohort,
            members: [{ ...bare, data_completeness: "degraded" }, teamCohort.members[1]!],
        });
        expect(screen.queryByTestId("ranking-drivers-count")).toBeNull();
        expect(screen.getByTestId("cohort-ranking-panel").textContent).not.toMatch(
            /degraded|of 5 drivers/u,
        );
    });

    it("the unranked summary uses the same words", () => {
        const unranked: CohortMember = {
            ...teamCohort.members[1]!,
            drivers: teamCohort.members[0]!.drivers!.slice(0, 2) as CohortMember["drivers"] & [],
        };
        panel({ ...teamCohort, members: [teamCohort.members[0]!, unranked] });
        expect(screen.getByTestId("unranked-members")).toHaveTextContent(
            "Not ranked by the service: Platform (2 of 5 drivers).",
        );
    });
});

describe("D: G1 — ranking shows for team, project and repository only", () => {
    const labels = ["CHAOS", "Platform"];
    function expectNothingRanked(container: HTMLElement) {
        expect(screen.getByRole("group", { name: "Ranking not shown" })).toBeInTheDocument();
        const text = container.textContent ?? "";
        for (const leak of [...labels, "43.5", "43", "Attention score"]) {
            expect(text).not.toContain(leak);
        }
        expect(screen.queryByTestId("ranking-row")).toBeNull();
        expect(screen.queryByTestId("cohort-ranking-panel")).toBeNull();
        expect(container.querySelector("svg, [role='img'], .render-shape")).toBeNull();
        expect(screen.queryByTestId("cohort-chart-caption")).toBeNull();
    }
    const renderPanel = (cohort: Cohort) =>
        render(
            <CohortRankingPanel
                cohort={cohort}
                result={withCohort(cohort)}
                shape="discovered_cohort"
            />,
        );

    it("the capture is rankable and does draw a chart (so the cases below are not vacuous)", () => {
        const { container } = renderPanel(teamCohort);
        expect(screen.getByTestId("cohort-ranking-panel")).toBeInTheDocument();
        expect(container.querySelector("svg")).not.toBeNull();
    });

    for (const kind of ["team", "project", "repository"]) {
        it(`ranks a ${kind} cohort`, () => {
            renderPanel(recolour(kind));
            expect(screen.getByTestId("cohort-ranking-panel")).toBeInTheDocument();
        });
    }

    for (const kind of ["person", "pull_request", "organization", "brand_new_kind"]) {
        it(`fails closed for cohort.kind ${kind}`, () => {
            const { container } = renderPanel(recolour(kind));
            expectNothingRanked(container);
        });
    }

    it("fails the whole cohort closed when ONE member is a person", () => {
        const cohort: Cohort = {
            ...teamCohort,
            members: teamCohort.members.map((m, i) =>
                i === 1 ? { ...m, subject: { ...m.subject, kind: "person" } } : m,
            ),
        };
        const { container } = renderPanel(cohort);
        expectNothingRanked(container);
    });

    it("fails closed for a member of an unknown kind and of kind pull_request", () => {
        for (const memberKind of ["brand_new_kind", "pull_request"]) {
            const cohort: Cohort = {
                ...teamCohort,
                members: teamCohort.members.map((m, i) =>
                    i === 0 ? { ...m, subject: { ...m.subject, kind: memberKind } } : m,
                ),
            };
            const { container, unmount } = renderPanel(cohort);
            expectNothingRanked(container);
            unmount();
        }
    });

    it("the whole answer view shows no ranking, score or chart for a person cohort", () => {
        const { container } = render(
            <DeterministicAnswerView result={withCohort(recolour("person"))} />,
        );
        expect(screen.getByRole("group", { name: "Ranking not shown" })).toBeInTheDocument();
        expect(screen.queryByTestId("ranking-row")).toBeNull();
        // the capture's other charts (a fact's own trend) are not the cohort's; the cohort's two are
        expect(container.textContent).not.toContain("Attention score by team");
        expect(screen.queryByTestId("score-withheld")).toBeNull();
    });
});

describe("E: the no-score caption under a cohort chart", () => {
    const unscored: CohortMember = {
        subject: { kind: "team", canonical_id: "team:platform", label: "Platform" },
        rank: 2,
        inclusion_reasons: ["Matched by kind census over the org's team roster."],
        ranking_computed: true,
        attention_rank: 2,
        outcome: "insufficient_evidence",
    };

    it("says which ranked members the chart does not show, under each cohort chart", () => {
        const cohort: Cohort = { ...teamCohort, members: [teamCohort.members[0]!, unscored] };
        render(
            <CohortRankingPanel
                cohort={cohort}
                result={withCohort(cohort)}
                shape="discovered_cohort"
            />,
        );
        const captions = screen.getAllByTestId("cohort-chart-caption");
        expect(captions.length).toBeGreaterThan(0);
        for (const caption of captions) {
            expect(caption).toHaveTextContent("1 ranked member has no score.");
            expect(caption.textContent).not.toMatch(/team/iu);
        }
    });

    it("says nothing when every ranked member is drawn", () => {
        render(
            <CohortRankingPanel cohort={teamCohort} result={example} shape="discovered_cohort" />,
        );
        expect(screen.queryByTestId("cohort-chart-caption")).toBeNull();
    });
});

describe("F: the owning-team roll-up label (CHAOS-12178)", () => {
    const rollupClaim = (source: string | null, extra: Partial<ClaimedFact> = {}): ClaimedFact =>
        ({
            claim_id: "claim_invest_proj",
            kind: "investment",
            subject: { kind: "project", canonical_id: "project_ask_dev", label: "Ask Dev" },
            field: "investment_mix",
            value: { number: 0.4 },
            rows: [{ fields: { theme: { string: "feature" }, share: { number: 0.4 } } }],
            table: { field: "theme_mix", shape: "snapshot", key: ["theme"], measures: ["share"] },
            ...(source === null
                ? {}
                : {
                      investment_mix: {
                          investment_mix_source: source,
                          rollup_basis: "owning_teams",
                          work_unit_count: 1200,
                          project_own_work_unit_count: 1,
                      },
                  }),
            ...extra,
        }) as unknown as ClaimedFact;

    const withClaims = (claims: ClaimedFact[]): InvestigationResult => ({
        ...example,
        claimed_facts: claims,
        drivers: [{ ...example.drivers[0]!, claimed_fact_ids: ["claim_invest_proj"] }],
    });

    it("drivers: a driver citing a roll-up claim carries the label and the sentence", () => {
        render(<DriversPanel result={withClaims([rollupClaim("owning_team_rollup")])} />);
        const label = screen.getByTestId("investment-rollup");
        expect(label).toHaveTextContent("Owning team's roll-up · 1 own work unit in this window");
        expect(label).toHaveTextContent(
            "This investment is the owning team's roll-up over 1,200 work units, not this project's own work: the project has 1 work unit of its own in this window.",
        );
    });

    it("fact tables: the table of a roll-up claim carries the label", () => {
        const result = withClaims([rollupClaim("owning_team_rollup")]);
        render(<FactRowsPanels facts={result.claimed_facts} result={result} />);
        expect(screen.getByTestId("investment-rollup")).toHaveAttribute(
            "data-subject",
            "project_ask_dev",
        );
    });

    it("the ranking: a ranked project member whose claim is a roll-up carries the label", () => {
        const cohort: Cohort = {
            ...teamCohort,
            kind: "project",
            members: [
                {
                    ...teamCohort.members[0]!,
                    subject: {
                        kind: "project",
                        canonical_id: "project_ask_dev",
                        label: "Ask Dev",
                    },
                },
            ],
        };
        render(
            <CohortRankingPanel
                cohort={cohort}
                result={{
                    ...example,
                    cohort,
                    claimed_facts: [rollupClaim("owning_team_rollup")],
                }}
                shape="discovered_cohort"
            />,
        );
        const row = within(screen.getAllByTestId("ranking-row")[0]!);
        expect(row.getByTestId("investment-rollup")).toBeInTheDocument();
    });

    it("project_native, an unknown source and no mix give no label anywhere", () => {
        for (const source of ["project_native", "brand_new_source", null]) {
            const result = withClaims([rollupClaim(source)]);
            const { container, unmount } = render(
                <>
                    <DriversPanel result={result} />
                    <FactRowsPanels facts={result.claimed_facts} result={result} />
                </>,
            );
            expect(container.querySelector("[data-testid='investment-rollup']")).toBeNull();
            unmount();
        }
    });

    it("a roll-up on a claim that is not investment gives no label", () => {
        const result = withClaims([rollupClaim("owning_team_rollup", { kind: "metrics" })]);
        const { container } = render(<DriversPanel result={result} />);
        expect(container.querySelector("[data-testid='investment-rollup']")).toBeNull();
    });
});
