import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChosenAnswersSummaryCard } from "@/components/ChosenAnswersSummaryCard";
import type { ConfirmedStructureEntry, SubjectRef } from "@/lib/contracts";

const APPLIED_KIND: ConfirmedStructureEntry = {
    member: "expected_kind",
    applied_value: "pull_request",
    source: "receipt",
    prior_result_id: "result_0001",
    receipt_id: "kindr_pull_request_0001",
    offer_source: "engine",
    provenance: "clarification_confirmed",
    disposition: "applied",
};
const VETOED_ANCHOR: ConfirmedStructureEntry = {
    member: "subject_anchor",
    applied_value: "repository:repo_atlas",
    source: "receipt",
    prior_result_id: "result_0002",
    receipt_id: "ancr_repo_atlas_0001",
    offer_source: "engine",
    provenance: "clarification_confirmed",
    disposition: "vetoed_stale",
};
const SUBJECT: SubjectRef = { kind: "project", canonical_id: "project:atlas", label: "Atlas" };

/** The compact question/answer list only — excludes the collapsed "Selection details" record list, which repeats the member label as its own record title. */
function compactList(): HTMLElement {
    return screen
        .getByRole("region", { name: "Chosen answers" })
        .querySelector<HTMLElement>(".chosen-answers__list")!;
}

describe("ChosenAnswersSummaryCard", () => {
    it("renders nothing when there is nothing to show", () => {
        const { container } = render(
            <ChosenAnswersSummaryCard
                chosenSubject={undefined}
                confirmedStructure={undefined}
                disposition={undefined}
            />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it("renders one row per APPLIED entry, question muted / answer emphasized", () => {
        render(
            <ChosenAnswersSummaryCard
                chosenSubject={undefined}
                confirmedStructure={[APPLIED_KIND]}
                disposition={undefined}
            />,
        );
        const row = within(compactList()).getByText("kind").closest(".chosen-answers__row")!;
        expect(row).toBeInTheDocument();
        expect(row.querySelector(".chosen-answers__answer")).toHaveTextContent("pull_request");
    });

    it("excludes a VETOED entry — that still needs the full alert treatment, not this compact card", () => {
        // A confirmedStructure carrying ONLY a vetoed entry has nothing
        // applied to show — the card correctly renders nothing at all
        // (StructureConfirmationNotice's own alert branch owns this case).
        const { container } = render(
            <ChosenAnswersSummaryCard
                chosenSubject={undefined}
                confirmedStructure={[VETOED_ANCHOR]}
                disposition={undefined}
            />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it("mixes applied and vetoed entries, showing only the applied one in the compact list", () => {
        render(
            <ChosenAnswersSummaryCard
                chosenSubject={undefined}
                confirmedStructure={[APPLIED_KIND, VETOED_ANCHOR]}
                disposition={undefined}
            />,
        );
        expect(within(compactList()).getByText("kind")).toBeInTheDocument();
        expect(within(compactList()).queryByText("repository/project/team")).toBeNull();
    });

    it("adds a Subject row only when the chosen subject was actually applied", () => {
        render(
            <ChosenAnswersSummaryCard
                chosenSubject={SUBJECT}
                confirmedStructure={undefined}
                disposition={{ applied: true }}
            />,
        );
        const row = within(compactList()).getByText("Subject").closest(".chosen-answers__row")!;
        expect(row.querySelector(".chosen-answers__answer")).toHaveTextContent("Atlas");
    });

    it("omits the Subject row when the choice was NOT applied — ChoiceNotice owns that case", () => {
        const { container } = render(
            <ChosenAnswersSummaryCard
                chosenSubject={SUBJECT}
                confirmedStructure={undefined}
                disposition={{ applied: false, answered: true }}
            />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    /**
     * codex round 2 finding 2: the ticket's own acceptance line ("selection
     * receipts/details remain reachable from the answer's collapsed
     * detail") means this card must not simply drop the per-entry
     * receipt/source/provenance detail `StructureConfirmationNotice`'s own
     * "Selection details" `<details>` used to carry.
     */
    it("keeps the receipt/source/provenance detail reachable behind a collapsed 'Selection details' disclosure", () => {
        render(
            <ChosenAnswersSummaryCard
                chosenSubject={undefined}
                confirmedStructure={[APPLIED_KIND]}
                disposition={undefined}
            />,
        );
        const details = screen.getByText("Selection details").closest("details")!;
        expect(details).not.toHaveAttribute("open");
        expect(within(details).getByText(/provenance clarification_confirmed/)).toBeInTheDocument();
        expect(within(details).getByText("applied")).toBeInTheDocument();
    });

    it("renders no 'Selection details' disclosure when there is nothing to detail (subject-only row)", () => {
        render(
            <ChosenAnswersSummaryCard
                chosenSubject={SUBJECT}
                confirmedStructure={undefined}
                disposition={{ applied: true }}
            />,
        );
        expect(screen.queryByText("Selection details")).toBeNull();
    });
});
