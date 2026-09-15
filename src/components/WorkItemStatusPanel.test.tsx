import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { WorkItemStatusPanel } from "@/components/WorkItemStatusPanel";
import type {
    ClaimedFact,
    CohortMember,
    InvestigationResult,
    ScalarValue,
    SubjectRef,
} from "@/lib/contracts";
import { mockScenarios } from "@/test/fixtures/investigations";

function subject(kind: SubjectRef["kind"], canonicalId: string, label = canonicalId): SubjectRef {
    return { kind, canonical_id: canonicalId, label };
}

function member(subjectRef: SubjectRef, rank: number, evidenceRefIds?: string[]): CohortMember {
    return {
        subject: subjectRef,
        rank,
        inclusion_reasons: ["Included in the resolved cohort."],
        ...(evidenceRefIds === undefined ? {} : { evidence_ref_ids: evidenceRefIds }),
    };
}

function statusFact(
    claimId: string,
    subjectRef: SubjectRef,
    value: ScalarValue,
    field = "status",
): ClaimedFact {
    return {
        claim_id: claimId,
        kind: "status",
        subject: subjectRef,
        field,
        value,
    };
}

function resultWith(
    members: readonly CohortMember[],
    facts: readonly ClaimedFact[],
    shape: "discovered_cohort" | "single_subject" = "discovered_cohort",
): InvestigationResult {
    const base = mockScenarios().find((scenario) => scenario.id === "complete")!.result;
    return {
        ...structuredClone(base),
        interpretation: { ...base.interpretation, shape },
        cohort: {
            kind: "work_item",
            members: [...members],
            rationale: "Work items were returned for the resolved scope.",
            complete: true,
            truncated: false,
        },
        claimed_facts: [...facts],
        evidence_ref_labels: {
            ...(base.evidence_ref_labels ?? {}),
            "evidence:alpha": "Status source: Alpha",
            "evidence:beta": "Status source: Beta",
        },
    };
}

describe("WorkItemStatusPanel", () => {
    it("joins status claims by full subject identity and keeps cohort order", () => {
        const alpha = subject("work_item", "same-id", "Alpha");
        const beta = subject("work_item", "work-beta", "Beta");
        const sameIdOtherKind = subject("project", "same-id", "Same ID project");
        const result = resultWith(
            [member(alpha, 1), member(beta, 2)],
            [
                statusFact("beta-status", beta, { string: "waiting" }),
                statusFact("wrong-kind", sameIdOtherKind, { string: "project-state" }),
                statusFact("alpha-status", alpha, { string: "open" }),
            ],
        );

        render(<WorkItemStatusPanel result={result} />);

        const panel = screen.getByTestId("work-item-status-panel");
        const rows = within(panel).getAllByTestId("work-item-status-row");
        expect(rows).toHaveLength(2);
        expect(rows.map((row) => row.getAttribute("data-subject-id"))).toEqual([
            "same-id",
            "work-beta",
        ]);
        expect(
            rows.map((row) => within(row).getByTestId("work-item-status-value").textContent),
        ).toEqual(["open", "waiting"]);
        expect(panel).not.toHaveTextContent("project-state");
    });

    it("keeps missing, literal unknown, zero, and false as distinct values", () => {
        const missing = subject("work_item", "missing", "Missing");
        const unknown = subject("work_item", "unknown", "Unknown");
        const zero = subject("work_item", "zero", "Zero");
        const falseValue = subject("work_item", "false", "False");
        const result = resultWith(
            [member(missing, 1), member(unknown, 2), member(zero, 3), member(falseValue, 4)],
            [
                statusFact("unknown-status", unknown, { string: "unknown" }),
                statusFact("zero-status", zero, { integer: 0 }),
                statusFact("false-status", falseValue, { boolean: false }),
            ],
        );

        render(<WorkItemStatusPanel result={result} />);

        const rows = screen.getAllByTestId("work-item-status-row");
        expect(within(rows[0]!).getByTestId("work-item-status-missing")).toHaveTextContent(
            "No status evidence in this answer",
        );
        expect(within(rows[1]!).getByTestId("work-item-status-value")).toHaveTextContent("unknown");
        expect(within(rows[2]!).getByTestId("work-item-status-value")).toHaveTextContent("0");
        expect(within(rows[3]!).getByTestId("work-item-status-value")).toHaveTextContent("false");
    });

    it("preserves multiple status observations and the member evidence references", () => {
        const alpha = subject("work_item", "alpha", "Alpha");
        const result = resultWith(
            [member(alpha, 1, ["evidence:alpha", "evidence:beta"])],
            [
                statusFact("first-observation", alpha, { string: "open" }),
                statusFact("second-observation", alpha, { string: "waiting" }),
            ],
        );

        render(<WorkItemStatusPanel result={result} />);

        const row = screen.getByTestId("work-item-status-row");
        const statusCell = within(row).getByTestId("work-item-status-value");
        expect(statusCell.querySelectorAll("li")).toHaveLength(2);
        expect(statusCell).toHaveTextContent("open");
        expect(statusCell).toHaveTextContent("waiting");
        const evidenceCell = within(row).getByTestId("work-item-status-evidence");
        expect(evidenceCell).toHaveTextContent("Status source: Alpha");
        expect(evidenceCell).toHaveTextContent("Status source: Beta");
        expect(evidenceCell).toHaveTextContent("evidence:alpha");
        expect(evidenceCell).toHaveTextContent("evidence:beta");
    });

    it("renders only the unranked work-item cohort and leaves ranking absent", () => {
        const unranked = subject("work_item", "unranked", "Unranked");
        const ranked = subject("work_item", "ranked", "Ranked");
        const otherKind = subject("repository", "repository", "Repository");
        const members = [
            member(unranked, 1),
            { ...member(ranked, 2), ranking_computed: true },
            member(otherKind, 3),
        ];
        const result = resultWith(members, [
            statusFact("unranked-status", unranked, { string: "open" }),
            statusFact("ranked-status", ranked, { string: "waiting" }),
        ]);

        const view = render(<DeterministicAnswerView result={result} />);

        const panel = screen.getByTestId("work-item-status-panel");
        expect(within(panel).getAllByTestId("work-item-status-row")).toHaveLength(1);
        expect(within(panel).getByText("Unranked")).toBeInTheDocument();
        expect(within(panel).queryByText("Ranked")).toBeNull();

        // A ranked member may still use the existing ranking panel. The new
        // view owns only the unranked rows; it must not turn that member into
        // a second status row. The all-unranked tuple keeps ranking absent.
        const allUnranked = resultWith(
            [member(unranked, 1)],
            [statusFact("unranked-status", unranked, { string: "open" })],
        );
        view.unmount();
        render(<DeterministicAnswerView result={allUnranked} />);
        expect(screen.queryByTestId("cohort-ranking-panel")).toBeNull();
    });

    it("is conditional on a cohort-shaped question", () => {
        const item = subject("work_item", "item", "Item");
        const result = resultWith(
            [member(item, 1)],
            [statusFact("item-status", item, { string: "open" })],
            "single_subject",
        );

        render(<WorkItemStatusPanel result={result} />);

        expect(screen.queryByTestId("work-item-status-panel")).toBeNull();
    });

    it("keeps the complete accessible table headers", () => {
        const item = subject("work_item", "item", "Item");
        render(
            <WorkItemStatusPanel
                result={resultWith(
                    [member(item, 1)],
                    [statusFact("item-status", item, { string: "open" })],
                )}
            />,
        );

        const table = screen.getByTestId("work-item-status-table");
        expect(within(table).getByRole("columnheader", { name: "Work item" })).toBeInTheDocument();
        expect(within(table).getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
        expect(within(table).getByRole("columnheader", { name: "Evidence" })).toBeInTheDocument();
    });
});
