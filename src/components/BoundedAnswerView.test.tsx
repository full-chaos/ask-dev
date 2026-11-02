import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BoundedAnswerView, leftOutSentence } from "@/components/BoundedAnswerView";
import { boundedAnswerScenarios } from "@/test/fixtures/bounded-answers";

// CHAOS-12559: ACR's bounded answer, drawn from its own fields, verbatim, with what it left out
// said from its own counts. Fixtures come from ACR's real projector at the pin.

describe("BoundedAnswerView", () => {
    const answer = boundedAnswerScenarios["bounded-answer"];

    it("draws the judgment, the state and the service's own answer verbatim", () => {
        render(<BoundedAnswerView projection={answer} />);
        const view = screen.getByRole("region", { name: "Shortened answer" });
        expect(within(view).getByText(answer.direct_judgment)).toBeInTheDocument();
        expect(within(view).getByText(answer.current_state)).toBeInTheDocument();
        expect(within(view).getByText(answer.deterministic_answer!)).toBeInTheDocument();
    });

    it("says what the projection left out, from its counts", () => {
        render(<BoundedAnswerView projection={answer} />);
        expect(screen.getByRole("note")).toHaveTextContent(
            "This answer was shortened to fit: 3 drivers, 1 member, 3 facts, 2 evidence references and 3 charts left out. Ask about a narrower scope to see more.",
        );
    });

    it("draws each driver it kept with its summary, and its standing only in the served word", () => {
        render(<BoundedAnswerView projection={answer} />);
        const drivers = screen.getByRole("group", { name: "Drivers" });
        for (const driver of answer.principal_drivers) {
            expect(within(drivers).getByText(driver.title)).toBeInTheDocument();
            expect(within(drivers).getByText(driver.summary)).toBeInTheDocument();
            expect(within(drivers).queryByText(driver.standing)).not.toBeInTheDocument();
            expect(within(drivers).queryByText(driver.category)).not.toBeInTheDocument();
        }
        const standing = answer.vocabulary_labels?.["driver_standing:principal"];
        expect(standing).toBeDefined();
        expect(within(drivers).getByText(standing!)).toBeInTheDocument();
    });

    it("draws each chart it kept, and every limitation and warning verbatim", () => {
        render(<BoundedAnswerView projection={answer} />);
        for (const shape of answer.render_shapes ?? []) {
            expect(screen.getAllByText(shape.title).length).toBeGreaterThan(0);
        }
        for (const limitation of answer.limitations) {
            expect(screen.getByText(limitation)).toBeInTheDocument();
        }
    });

    it("draws no completeness (CHAOS-12245)", () => {
        const { container } = render(<BoundedAnswerView projection={answer} />);
        expect(screen.queryByRole("heading", { name: "Completeness" })).not.toBeInTheDocument();
        expect(container.querySelector("[data-completeness-state]")).toBeNull();
    });

    it("never says the service reported no limitations when it left them out", () => {
        const allLeftOut = {
            ...answer,
            limitations: [],
            warnings: [],
            projection_budget: { ...answer.projection_budget, limitations_omitted: 2 },
        };
        const { unmount } = render(<BoundedAnswerView projection={allLeftOut} />);
        expect(screen.queryByText("The service reported no limitations.")).not.toBeInTheDocument();
        expect(screen.getByRole("note")).toHaveTextContent("2 limitations");
        // Nothing of it is held, so no empty Limitations panel stands beside the note.
        expect(screen.queryByRole("group", { name: "Limitations" })).not.toBeInTheDocument();
        unmount();

        const warned = { ...allLeftOut, warnings: ["A served warning."] };
        render(<BoundedAnswerView projection={warned} />);
        expect(screen.getByText("A served warning.")).toBeInTheDocument();
        expect(screen.queryByText("The service reported no limitations.")).not.toBeInTheDocument();
    });

    it("still says the service reported no limitations when it sent none", () => {
        const none = {
            ...answer,
            limitations: [],
            projection_budget: { ...answer.projection_budget, limitations_omitted: 0 },
        };
        render(<BoundedAnswerView projection={none} />);
        expect(screen.getByText("The service reported no limitations.")).toBeInTheDocument();
    });

    it("draws every scenario ACR's projector produced without failing", () => {
        for (const projection of Object.values(boundedAnswerScenarios)) {
            const { unmount } = render(<BoundedAnswerView projection={projection} />);
            expect(screen.getByRole("region", { name: "Shortened answer" })).toBeInTheDocument();
            expect(screen.getByText(projection.direct_judgment)).toBeInTheDocument();
            unmount();
        }
    });
});

describe("leftOutSentence", () => {
    const budget = boundedAnswerScenarios["bounded-answer"].projection_budget;
    const none = {
        ...budget,
        truncated: false,
        drivers_omitted: 0,
        withheld_drivers_omitted: 0,
        cohort_members_omitted: 0,
        cohort_groups_omitted: 0,
        facts_omitted: 0,
        candidates_omitted: 0,
        evidence_refs_omitted: 0,
        limitations_omitted: 0,
        warnings_omitted: 0,
        coverage_omitted: 0,
        reasons_omitted: 0,
        values_clamped: 0,
        render_shapes_omitted: 0,
    };

    // Written out here, not imported, so a count dropped from the view's table is caught.
    const NOUNS = [
        ["drivers_omitted", "driver", "drivers"],
        ["withheld_drivers_omitted", "withheld driver", "withheld drivers"],
        ["cohort_members_omitted", "member", "members"],
        ["cohort_groups_omitted", "group", "groups"],
        ["facts_omitted", "fact", "facts"],
        ["candidates_omitted", "option", "options"],
        ["evidence_refs_omitted", "evidence reference", "evidence references"],
        ["limitations_omitted", "limitation", "limitations"],
        ["warnings_omitted", "warning", "warnings"],
        ["coverage_omitted", "coverage line", "coverage lines"],
        ["reasons_omitted", "reason", "reasons"],
        ["render_shapes_omitted", "chart", "charts"],
    ] as const;

    it.each(NOUNS)("names %s in the singular and the plural", (key, one, many) => {
        expect(leftOutSentence({ ...none, truncated: true, [key]: 1 })).toBe(
            `This answer was shortened to fit: 1 ${one} left out. Ask about a narrower scope to see more.`,
        );
        expect(leftOutSentence({ ...none, truncated: true, [key]: 2 })).toBe(
            `This answer was shortened to fit: 2 ${many} left out. Ask about a narrower scope to see more.`,
        );
    });

    it("discloses a shortened value like an omission, as ACR's contract says", () => {
        expect(leftOutSentence({ ...none, truncated: true, values_clamped: 2 })).toBe(
            "This answer was shortened to fit: 2 values shortened. Ask about a narrower scope to see more.",
        );
        expect(
            leftOutSentence({ ...none, truncated: true, facts_omitted: 1, values_clamped: 1 }),
        ).toBe(
            "This answer was shortened to fit: 1 fact left out; 1 value shortened. Ask about a narrower scope to see more.",
        );
    });

    it("says the answer was shortened when the budget says truncated and no count is set", () => {
        expect(leftOutSentence({ ...none, truncated: true, full_result_omitted: false })).toBe(
            "This answer was shortened to fit. Ask about a narrower scope to see more.",
        );
    });

    it("names one count in the singular", () => {
        expect(leftOutSentence({ ...none, facts_omitted: 1, full_result_omitted: true })).toBe(
            "This answer was shortened to fit: 1 fact left out. Ask about a narrower scope to see more.",
        );
    });

    it("still says the answer was shortened when only the whole result was withheld", () => {
        expect(leftOutSentence({ ...none, full_result_omitted: true })).toBe(
            "This answer was shortened to fit. Ask about a narrower scope to see more.",
        );
    });

    it("says nothing when nothing was left out", () => {
        expect(leftOutSentence({ ...none, full_result_omitted: false })).toBeUndefined();
    });
});
