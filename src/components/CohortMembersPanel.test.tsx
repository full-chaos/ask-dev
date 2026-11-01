import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { validateContract } from "@/lib/acr/validate";
import { cohortRanking } from "@/lib/cohort-ranking";
import type { InvestigationResult } from "@/lib/contracts";
import { withholdUnrankableRankings } from "@/lib/ranking-withheld";
import { cohortMemberScenarios as cohorts } from "@/test/fixtures/cohort-members";
import { servedWordScenarios as served } from "@/test/fixtures/served-words";

afterEach(cleanup);

function draw(result: InvestigationResult) {
    return render(<DeterministicAnswerView offersPresentation="popup" result={result} />).container;
}

const panel = () => screen.getByTestId("cohort-members-panel");
const withoutMap = (result: InvestigationResult): InvestigationResult => {
    const { vocabulary_labels: _dropped, ...rest } = result;
    return rest;
};

describe("the fixtures", () => {
    it.each(Object.entries(cohorts))("%s passes its own schema", (_name, result) => {
        const schema = `${result.schema_version}.schema.json` as const;
        expect(validateContract(schema, result).errors).toEqual([]);
    });
});

describe("a cohort with nothing ranked draws its members (render audit gap 1)", () => {
    it("unranked repositories: every member by name, under the served plural", () => {
        const result = cohorts["unranked-repositories"];
        draw(result);
        expect(screen.getByRole("heading", { name: "repositories" })).toBeVisible();
        for (const member of result.cohort!.members) {
            expect(within(panel()).getByText(member.subject.label)).toBeVisible();
        }
    });

    it("says why they are here: the served rationale", () => {
        const result = cohorts["unranked-repositories"];
        draw(result);
        expect(within(panel()).getByText(result.cohort!.rationale)).toBeVisible();
    });

    it("names what was left out, with the served reason", () => {
        draw(cohorts["unranked-repositories"]);
        const exclusion = within(panel()).getByTestId("cohort-exclusion");
        expect(exclusion).toHaveTextContent("full-chaos/archived");
        expect(exclusion).toHaveTextContent("This repository is archived, so it is not a member.");
    });

    it("a real pull request cohort: ACR marks it computed, but with no score nothing was ranked", () => {
        const result = cohorts["pull-requests"];
        expect(result.cohort!.members.every((member) => member.ranking_computed)).toBe(true);
        expect(result.cohort!.members.some((member) => member.score !== undefined)).toBe(false);
        draw(result);
        expect(screen.queryByText("Ranking not shown")).toBeNull();
        expect(screen.queryByTestId("cohort-ranking-panel")).toBeNull();
        expect(within(panel()).getAllByRole("listitem")).toHaveLength(
            result.cohort!.members.length,
        );
        // At the size budget ACR sheds its words, so this real answer reads the plain heading.
        expect(result.vocabulary_labels).toBeUndefined();
        expect(screen.getByRole("heading", { name: "Members" })).toBeVisible();
    });

    it("says when the list is cut", () => {
        draw(cohorts["pull-requests"]);
        expect(within(panel()).getByTestId("cohort-members-notice")).toHaveTextContent(
            /only the members the service returned.*not every pull request/u,
        );
    });

    it("zero members: the rationale is the reason, and zero is said", () => {
        const result = cohorts["zero-match"];
        draw(result);
        expect(within(panel()).getByText(result.cohort!.rationale)).toBeVisible();
        expect(within(panel()).getByText("The service returned no members.")).toBeVisible();
        expect(screen.queryByText("Ranking not shown")).toBeNull();
    });

    it("work items keep their own table, with no false notice and no second list", () => {
        const result = cohorts["work-items"];
        draw(result);
        expect(screen.getByTestId("work-item-status-panel")).toBeVisible();
        expect(screen.queryByText("Ranking not shown")).toBeNull();
        expect(within(panel()).queryByRole("list")).toBeNull();
        expect(within(panel()).getByText(result.cohort!.rationale)).toBeVisible();
    });

    it("a list keeps the answer's drivers: nothing was withheld", () => {
        const result = cohorts["unranked-repositories"];
        draw(result);
        expect(screen.queryByTestId("withheld-part")).toBeNull();
        expect(screen.getByText(result.drivers[0]!.title)).toBeVisible();
    });

    it("no served plural: the heading is the plain word, with no pluralizer", () => {
        const root = draw(withoutMap(cohorts["unranked-repositories"]));
        expect(screen.getByRole("heading", { name: "Members" })).toBeVisible();
        expect(root.textContent).not.toMatch(/repositorys/u);
    });
});

describe("the gate keeps what it must keep", () => {
    const ranked = served["every-vocabulary"];

    it("a real ranking still reads as a ranking, and no list is added", () => {
        draw(ranked);
        expect(screen.getByTestId("cohort-ranking-panel")).toBeVisible();
        expect(screen.queryByTestId("cohort-members-panel")).toBeNull();
    });

    it("a ranking of a kind this view does not rank is still withheld: it existed", () => {
        const cohort = {
            ...ranked.cohort!,
            kind: "pull_request",
            members: ranked.cohort!.members.map((member) => ({
                ...member,
                subject: { ...member.subject, kind: "pull_request" },
            })),
        };
        const result = { ...ranked, cohort } as InvestigationResult;
        draw(result);
        expect(screen.getByTestId("cohort-ranking-withheld")).toHaveTextContent(
            "Ranking not shown",
        );
        expect(screen.queryByTestId("cohort-members-panel")).toBeNull();
    });

    it("a member with a served driver and no score is a ranking", () => {
        const [first, ...others] = ranked.cohort!.members;
        const { score: _score, ...noScore } = first!;
        const cohort = { ...ranked.cohort!, members: [noScore, ...others] };
        expect(cohortRanking("discovered_cohort", cohort).state).toBe("rows");
    });

    it("a member with a score and no driver is a ranking", () => {
        const [first, ...others] = ranked.cohort!.members;
        const { drivers: _drivers, ...noDrivers } = first!;
        const cohort = { ...ranked.cohort!, members: [noDrivers, ...others] };
        expect(cohortRanking("discovered_cohort", cohort).state).toBe("rows");
    });

    it("the person guardrail stays: no person list, computed or not", () => {
        const source = cohorts["unranked-repositories"];
        const person = {
            ...source,
            cohort: {
                ...source.cohort!,
                kind: "person",
                members: source.cohort!.members.map((member) => ({
                    ...member,
                    subject: { ...member.subject, kind: "person" },
                })),
            },
        } as InvestigationResult;
        expect(cohortRanking("discovered_cohort", person.cohort).state).toBe("kind_not_ranked");
        draw(person);
        expect(screen.queryByTestId("cohort-members-panel")).toBeNull();
        expect(screen.getByTestId("cohort-ranking-withheld")).toBeVisible();

        cleanup();
        const { result, rankingWithheld } = withholdUnrankableRankings(person);
        render(<DeterministicAnswerView rankingWithheld={rankingWithheld} result={result} />);
        expect(screen.queryByTestId("cohort-members-panel")).toBeNull();
    });

    it("one person member fails the whole cohort closed", () => {
        const source = cohorts["unranked-repositories"];
        const [first, ...others] = source.cohort!.members;
        const members = [{ ...first!, subject: { ...first!.subject, kind: "person" } }, ...others];
        const cohort = { ...source.cohort!, members };
        expect(cohortRanking("discovered_cohort", cohort).state).toBe("kind_not_ranked");
    });

    it("no intent, no list", () => {
        const source = cohorts["unranked-repositories"];
        const result = {
            ...source,
            interpretation: { ...source.interpretation, shape: "single_subject" },
        };
        draw(result);
        expect(screen.queryByTestId("cohort-members-panel")).toBeNull();
    });
});
