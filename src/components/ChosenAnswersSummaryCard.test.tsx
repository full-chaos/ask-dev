import { render, screen } from "@testing-library/react";
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
        const row = screen.getByText("kind").closest(".chosen-answers__row")!;
        expect(row).toBeInTheDocument();
        expect(row.querySelector(".chosen-answers__answer")).toHaveTextContent("pull_request");
    });

    it("excludes a VETOED entry — that still needs the full alert treatment, not this compact card", () => {
        render(
            <ChosenAnswersSummaryCard
                chosenSubject={undefined}
                confirmedStructure={[VETOED_ANCHOR]}
                disposition={undefined}
            />,
        );
        expect(screen.queryByText("repository/project/team")).toBeNull();
    });

    it("mixes applied and vetoed entries, showing only the applied one", () => {
        render(
            <ChosenAnswersSummaryCard
                chosenSubject={undefined}
                confirmedStructure={[APPLIED_KIND, VETOED_ANCHOR]}
                disposition={undefined}
            />,
        );
        expect(screen.getByText("kind")).toBeInTheDocument();
        expect(screen.queryByText("repository/project/team")).toBeNull();
    });

    it("adds a Subject row only when the chosen subject was actually applied", () => {
        render(
            <ChosenAnswersSummaryCard
                chosenSubject={SUBJECT}
                confirmedStructure={undefined}
                disposition={{ applied: true }}
            />,
        );
        const row = screen.getByText("Subject").closest(".chosen-answers__row")!;
        expect(row.querySelector(".chosen-answers__answer")).toHaveTextContent("Atlas");
    });

    it("omits the Subject row when the choice was NOT applied — ChoiceNotice owns that case", () => {
        render(
            <ChosenAnswersSummaryCard
                chosenSubject={SUBJECT}
                confirmedStructure={undefined}
                disposition={{ applied: false, answered: true }}
            />,
        );
        expect(screen.queryByText("Subject")).toBeNull();
    });
});
