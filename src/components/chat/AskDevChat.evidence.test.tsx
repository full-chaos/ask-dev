import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AskDevChat, withheldTurn } from "@/components/chat/AskDevChat";
import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import shapesExample from "@/contracts/examples/context_fabric_investigation_result_render_shapes.v1.json";
import type { InvestigationResult } from "@/lib/contracts";
import { withholdUnrankableRankings } from "@/lib/ranking-withheld";
import type {
    AssistantOutcome,
    ChatEvidenceRef,
    ChatEvidenceSource,
    ChatSource,
} from "@/render/source";
import { assistantTurn, hostSource, snapshotOf, userTurn } from "@/test/fixtures/host-source";

/**
 * CHAOS-12426: the evidence reference is a button on a host that offers `evidence`. Each answered
 * turn names its own result id; the render never reads the evidence itself.
 */

const RESULT_A = canonicalResult as unknown as InvestigationResult;
const LABELS = { evidence_project_identity: "Project identity" };

/** The same evidence ids under a second result id: only `result_id` and the served labels differ. */
function resultB(): InvestigationResult {
    const clone = structuredClone(RESULT_A);
    return { ...clone, result_id: "result_second_0002" };
}

function withLabels(result: InvestigationResult): InvestigationResult {
    return { ...result, evidence_ref_labels: LABELS };
}

function evidenceSource() {
    return { open: vi.fn<(ref: ChatEvidenceRef) => void>() };
}

function setup(outcomes: readonly AssistantOutcome[], evidence: ChatEvidenceSource | undefined) {
    const turns = outcomes.flatMap((outcome, index) => [
        userTurn(index * 2, `Question ${index}`),
        assistantTurn(index * 2 + 1, outcome),
    ]);
    const extra: Pick<ChatSource, "evidence"> = evidence === undefined ? {} : { evidence };
    return render(<AskDevChat source={hostSource(snapshotOf(...turns), extra)} />);
}

const answered = (result: InvestigationResult): AssistantOutcome => ({ kind: "answered", result });

describe("evidence buttons in the chat", () => {
    it("two results citing one ref each open their own result id, with the served label", async () => {
        expect(RESULT_A.evidence_ref_ids).toContain("evidence_project_identity");
        const evidence = evidenceSource();
        setup([answered(withLabels(RESULT_A)), answered(withLabels(resultB()))], evidence);
        const articles = screen.getAllByRole("article");
        expect(articles).toHaveLength(2);
        for (const article of articles) {
            await userEvent.click(
                within(article).getAllByRole("button", { name: "Project identity" })[0]!,
            );
        }
        expect(evidence.open).toHaveBeenNthCalledWith(1, {
            refId: "evidence_project_identity",
            resultId: RESULT_A.result_id,
            label: "Project identity",
        });
        expect(evidence.open).toHaveBeenNthCalledWith(2, {
            refId: "evidence_project_identity",
            resultId: "result_second_0002",
            label: "Project identity",
        });
    });

    it("names the floor 'Evidence' when no label is served, and shows no ref id on a button", async () => {
        const evidence = evidenceSource();
        setup([answered(RESULT_A)], evidence);
        const buttons = screen.getAllByRole("button", { name: "Evidence" });
        expect(buttons.length).toBeGreaterThanOrEqual(RESULT_A.evidence_ref_ids.length);
        for (const button of buttons) expect(button.textContent).toBe("Evidence");
        await userEvent.click(buttons[0]!);
        expect(evidence.open).toHaveBeenCalledTimes(1);
        const ref = evidence.open.mock.calls[0]![0];
        expect(RESULT_A.evidence_ref_ids).toContain(ref.refId);
        expect(ref).toEqual({ refId: ref.refId, resultId: RESULT_A.result_id, label: "Evidence" });
    });

    it("offers no button when the host offers no evidence", () => {
        setup([answered(withLabels(RESULT_A))], undefined);
        expect(screen.queryByRole("button", { name: "Project identity" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Evidence" })).toBeNull();
    });

    it("offers no button on a failed turn or a status turn", () => {
        const evidence = evidenceSource();
        setup(
            [
                { kind: "status", status: { kind: "unavailable" }, retry: false },
                {
                    kind: "failed",
                    failure: { message: "Could not finish.", retry: false } as never,
                },
            ] as unknown as AssistantOutcome[],
            evidence,
        );
        expect(screen.queryByRole("button", { name: "Evidence" })).toBeNull();
        expect(document.querySelector(".evidence-ref--open")).toBeNull();
    });
});

describe("a turn whose result changes", () => {
    it("opens the new result id after the same turn is republished with another result", async () => {
        const evidence = evidenceSource();
        const source = hostSource(
            snapshotOf(userTurn(0, "Q"), assistantTurn(1, answered(withLabels(RESULT_A)))),
            { evidence },
        );
        render(<AskDevChat source={source} />);
        source.publish(
            snapshotOf(userTurn(0, "Q"), assistantTurn(1, answered(withLabels(resultB())))),
        );
        await userEvent.click(screen.getAllByRole("button", { name: "Project identity" })[0]!);
        expect(evidence.open).toHaveBeenCalledWith(
            expect.objectContaining({ resultId: "result_second_0002" }),
        );
    });
});

describe("a withheld result keeps its result id", () => {
    const person = (): InvestigationResult => {
        const team = shapesExample as unknown as InvestigationResult;
        return {
            ...team,
            cohort: {
                ...team.cohort!,
                kind: "person",
                members: team.cohort!.members.map((m) => ({
                    ...m,
                    subject: {
                        ...m.subject,
                        kind: "person",
                        canonical_id: "person:ada",
                        label: "Ada",
                    },
                })),
            },
        };
    };

    it("the boundary and the render's withheld turn both keep result_id", () => {
        const source = person();
        const boundary = withholdUnrankableRankings(source);
        expect(boundary.rankingWithheld).toBeDefined();
        expect(boundary.result.result_id).toBe(source.result_id);
        const turn = withheldTurn(assistantTurn(1, answered(source)));
        if (turn.role !== "assistant" || turn.outcome.kind !== "answered") throw new Error("shape");
        expect(turn.outcome.result.result_id).toBe(source.result_id);
        expect(turn.outcome.rankingWithheld).toBeDefined();
    });
});
