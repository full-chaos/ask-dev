import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { validateContract } from "@/lib/acr/validate";
import { askedForCohort, cohortRanking } from "@/lib/cohort-ranking";
import type { AnswerPlan, CohortMember, InvestigationResult } from "@/lib/contracts";
import { withholdUnrankableRankings } from "@/lib/ranking-withheld";
import { cohortMemberScenarios as cohorts } from "@/test/fixtures/cohort-members";
import { servedWordScenarios as served } from "@/test/fixtures/served-words";

afterEach(cleanup);

function draw(result: InvestigationResult) {
    return render(<DeterministicAnswerView offersPresentation="popup" result={result} />).container;
}

const panel = () => screen.getByTestId("cohort-members-panel");
const planOf = (family: string) => ({ family }) as AnswerPlan;
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
        expect(screen.getByRole("heading", { name: "pull requests" })).toBeVisible();
    });

    it("says when the list is cut", () => {
        draw(cohorts["pull-requests"]);
        expect(within(panel()).getByTestId("cohort-members-notice")).toHaveTextContent(
            /only the pull requests the service returned.*not every pull request/u,
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

describe("the served question family decides on an unreliable shape (CHAOS-12477)", () => {
    it("a cohort family draws the list on an `open` answer", () => {
        const result = cohorts["open-cohort-family"];
        expect(result.interpretation.shape).toBe("open");
        expect(result.answer_plan?.family).toBe("scoped_cohort_status");
        draw(result);
        expect(within(panel()).getByText(result.cohort!.members[0]!.subject.label)).toBeVisible();
        expect(within(panel()).getByText(result.cohort!.rationale)).toBeVisible();
    });

    it("a single-subject answer with a context cohort draws no list (check 10)", () => {
        const result = cohorts["subject-with-cohort"];
        expect(result.cohort!.members.length).toBeGreaterThan(0);
        expect(result.interpretation.shape).toBe("single_subject");
        expect(result.answer_plan?.family).toBe("subject_investigation");
        draw(result);
        expect(screen.queryByTestId("cohort-members-panel")).toBeNull();
        expect(screen.queryByTestId("cohort-ranking-panel")).toBeNull();
    });

    it.each(["discovered_cohort_ranking", "scoped_cohort_status", "grouped_cohort_status"])(
        "%s counts on any shape",
        (family) => {
            expect(askedForCohort("open", { answer_plan: planOf(family) })).toBe(true);
        },
    );

    it.each([
        "subject_investigation",
        "explicit_comparison",
        "trend",
        "investment_allocation",
        "unclassified",
    ])("%s does not count", (family) => {
        expect(askedForCohort("open", { answer_plan: planOf(family) })).toBe(false);
    });

    it("no plan reads as the shape alone", () => {
        expect(askedForCohort("open", undefined)).toBe(false);
        expect(askedForCohort("open", {})).toBe(false);
        expect(askedForCohort("discovered_cohort", undefined)).toBe(true);
    });

    it("work items draw on an `open` answer with a cohort family", () => {
        const source = cohorts["work-items"];
        const plan = cohorts["open-cohort-family"].answer_plan;
        const result = {
            ...source,
            answer_plan: plan,
            interpretation: { ...source.interpretation, shape: "open" },
        } as InvestigationResult;
        draw(result);
        expect(screen.getByTestId("work-item-status-panel")).toBeVisible();
    });

    it("the drivers and the view order read the same gate", () => {
        const ranked = served["every-vocabulary"];
        const plan = cohorts["open-cohort-family"].answer_plan;
        const result = {
            ...ranked,
            answer_plan: plan,
            interpretation: { ...ranked.interpretation, shape: "open" },
        } as InvestigationResult;
        draw(result);
        const ranking = screen.getByTestId("cohort-ranking-panel");
        const drivers = screen.getByTestId("drivers-panel");
        const fact = screen.getAllByRole("heading", { level: 2 }).find((heading) => {
            return heading.textContent?.includes("·");
        });
        expect(
            ranking.compareDocumentPosition(drivers) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(
            drivers.compareDocumentPosition(fact!) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it("the drivers panel reads the same gate: a withheld ranking on `open` hides them", () => {
        const ranked = served["every-vocabulary"];
        const plan = cohorts["open-cohort-family"].answer_plan;
        const cohort = {
            ...ranked.cohort!,
            kind: "pull_request",
            members: ranked.cohort!.members.map((member) => ({
                ...member,
                subject: { ...member.subject, kind: "pull_request" },
            })),
        };
        draw({
            ...ranked,
            answer_plan: plan,
            cohort,
            interpretation: { ...ranked.interpretation, shape: "open" },
        } as InvestigationResult);
        expect(
            within(screen.getByTestId("drivers-panel")).getByTestId("withheld-part"),
        ).toBeVisible();
    });
});

describe("the list keeps a contract the keys cannot assume", () => {
    it("two members with one canonical id both show, and survive a rerender", () => {
        const source = cohorts["unranked-repositories"];
        const [first] = source.cohort!.members;
        const twin = { ...first!, subject: { ...first!.subject, label: "Twin" } };
        const [exclusion] = source.cohort!.exclusions!;
        const both = {
            ...source,
            cohort: {
                ...source.cohort!,
                exclusions: [exclusion!, exclusion!],
                members: [first!, twin],
            },
        };
        const only = { ...source, cohort: { ...source.cohort!, members: [twin] } };
        const names = () =>
            [...panel().querySelectorAll("li.record__title")].map((item) => item.textContent);
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { rerender } = render(<DeterministicAnswerView result={both} />);
        const keyErrors = errors.mock.calls.filter(([message]) =>
            String(message).includes("same key"),
        );
        errors.mockRestore();
        expect(keyErrors).toEqual([]);
        expect(names()).toEqual([first!.subject.label, "Twin"]);
        rerender(<DeterministicAnswerView result={only} />);
        expect(names()).toEqual(["Twin"]);
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
        expect(cohortRanking(true, cohort).state).toBe("rows");
    });

    it("a member with a score and no driver is a ranking", () => {
        const [first, ...others] = ranked.cohort!.members;
        const { drivers: _drivers, ...noDrivers } = first!;
        const cohort = { ...ranked.cohort!, members: [noDrivers, ...others] };
        expect(cohortRanking(true, cohort).state).toBe("rows");
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
        expect(cohortRanking(true, person.cohort).state).toBe("kind_not_ranked");
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
        expect(cohortRanking(true, cohort).state).toBe("kind_not_ranked");
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

/**
 * CHAOS-12480: with nothing ranked, the rationale and exclusions are on the page already, so the
 * fold holds only what is not: inclusion reasons and the raw fields.
 */
describe("the members' fold", () => {
    const cases = Object.entries(cohorts);
    const [, base] = cases.find(([, result]) => (result.cohort?.members.length ?? 0) > 0)!;
    const withMeaning: InvestigationResult = {
        ...base,
        cohort: { ...base.cohort!, population: 12, population_lower_bound: true },
    };
    const fold = () => screen.getByTestId("cohort-meaning-details");

    it("holds the inclusion reasons and the raw fields, closed", () => {
        draw(withMeaning);
        expect(fold()).not.toHaveAttribute("open");
        expect(within(fold()).getByTestId("cohort-raw-population")).toHaveTextContent(
            "population: 12",
        );
        const member = base.cohort!.members[0]!;
        expect(fold().textContent).toContain(member.inclusion_reasons[0]);
    });

    it("does not repeat the rationale or the exclusions in the fold", () => {
        draw(withMeaning);
        const rationale = base.cohort!.rationale;
        expect(fold().textContent).not.toContain(rationale);
        expect(within(fold()).queryByTestId("cohort-exclusion")).toBeNull();
    });

    it("a zero match keeps its population: zero members is not zero to say", () => {
        const empty = { ...base.cohort!, members: [], population: 0 };
        draw({ ...base, cohort: empty });
        expect(within(fold()).getByTestId("cohort-raw-population")).toHaveTextContent(
            "population: 0",
        );
    });

    it("draws no empty fold", () => {
        const {
            score_meaning: _meaning,
            judgment_mismatch: _mismatch,
            population: _population,
            population_lower_bound: _bound,
            ...rest
        } = base.cohort!;
        draw({ ...base, cohort: { ...rest, members: [] } });
        expect(screen.getByTestId("cohort-members-panel")).toBeInTheDocument();
        expect(screen.queryByTestId("cohort-meaning-details")).toBeNull();
    });

    it("a work item the status table draws still says why it is here", () => {
        const member: CohortMember = {
            ...base.cohort!.members[0]!,
            subject: { kind: "work_item", canonical_id: "work_item:1", label: "Fix the login" },
            inclusion_reasons: ["It is open and assigned to this project."],
            ranking_computed: false,
        };
        draw({ ...base, cohort: { ...base.cohort!, kind: "work_item", members: [member] } });
        expect(fold()).toHaveTextContent("Fix the login: It is open and assigned to this project.");
    });

    it("a person cohort stays withheld: no fold names a person", () => {
        const member: CohortMember = {
            ...base.cohort!.members[0]!,
            subject: { kind: "person", canonical_id: "person:1", label: "A Person" },
            inclusion_reasons: ["A reason about a person."],
        };
        const { container } = render(
            <DeterministicAnswerView
                offersPresentation="popup"
                result={{ ...base, cohort: { ...base.cohort!, kind: "person", members: [member] } }}
            />,
        );
        expect(screen.queryByTestId("cohort-meaning-details")).toBeNull();
        expect(container.textContent).not.toContain("A reason about a person.");
        expect(container.textContent).not.toContain("A Person");
    });
});
