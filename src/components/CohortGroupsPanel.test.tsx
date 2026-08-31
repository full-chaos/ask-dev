import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CohortGroupsPanel } from "@/components/CohortGroupsPanel";
import type { Cohort, CohortGroup } from "@/lib/contracts";

const GROUP_A: CohortGroup = {
    subject: { kind: "team", canonical_id: "team:alpha", label: "Team Alpha" },
    member_canonical_ids: ["project:one", "project:two"],
    complete: true,
    truncated: false,
    total: 2,
};

const GROUP_B: CohortGroup = {
    subject: { kind: "team", canonical_id: "team:beta", label: "Team Beta" },
    member_canonical_ids: ["project:three"],
    complete: false,
    truncated: true,
    total: 5,
};

function cohortWithGroups(groups: CohortGroup[] | undefined): Cohort {
    const base: Cohort = {
        kind: "project",
        members: [],
        rationale: "test fixture",
        complete: groups === undefined || groups.every((g) => g.complete),
        truncated: groups !== undefined && groups.some((g) => g.truncated),
    };
    return groups === undefined ? base : { ...base, groups };
}

/**
 * CHAOS-4636/CHAOS-4668: `Cohort.groups` is schema-OPTIONAL and, per
 * lane-4636's measured finding, does not co-occur with a ranked cohort on
 * real `dh_0830` data — this suite is the only place the group axis is
 * proven to render at all (fixture-only, as CHAOS-4668 itself anticipates).
 */
describe("CohortGroupsPanel", () => {
    it("renders nothing when the cohort is undefined", () => {
        const { container } = render(<CohortGroupsPanel cohort={undefined} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("renders nothing when the cohort carries no groups", () => {
        const { container } = render(<CohortGroupsPanel cohort={cohortWithGroups(undefined)} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("renders nothing when groups is present but empty", () => {
        const { container } = render(<CohortGroupsPanel cohort={cohortWithGroups([])} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("is collapsed by default", () => {
        render(<CohortGroupsPanel cohort={cohortWithGroups([GROUP_A])} />);
        expect(screen.getByTestId("cohort-groups-panel")).not.toHaveAttribute("open");
    });

    it("names every group's own complete/truncated state — never a single boolean over the union", () => {
        render(<CohortGroupsPanel cohort={cohortWithGroups([GROUP_A, GROUP_B])} />);
        const panel = screen.getByTestId("cohort-groups-panel");
        expect(panel).toHaveTextContent("Team Alpha");
        expect(panel).toHaveTextContent("complete");
        expect(panel).toHaveTextContent("Team Beta");
        expect(panel).toHaveTextContent("truncated");
    });

    it("shows the shown-vs-total count per group", () => {
        render(<CohortGroupsPanel cohort={cohortWithGroups([GROUP_B])} />);
        expect(screen.getByTestId("cohort-groups-panel")).toHaveTextContent("1 of 5");
    });
});
