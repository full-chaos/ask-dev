import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { EvidenceOpenContext } from "@/components/EvidenceOpenContext";
import type { ClaimedFact, DriverJudgment, InvestigationResult } from "@/lib/contracts";
import { cellText } from "@/lib/fact-rows";
import { servedWordScenarios as served } from "@/test/fixtures/served-words";

afterEach(cleanup);

const result = served["every-vocabulary"];
const scalar = result.claimed_facts.find((fact) => fact.value !== undefined && !fact.rows?.length)!;
const tabular = result.claimed_facts.find((fact) => (fact.rows?.length ?? 0) > 0)!;

function drawWithOpener(answer: InvestigationResult) {
    const open = vi.fn();
    render(
        <EvidenceOpenContext.Provider value={{ open }}>
            <DeterministicAnswerView offersPresentation="popup" result={answer} />
        </EvidenceOpenContext.Provider>,
    );
    return open;
}

/** The first driver, citing exactly these claims. */
function citing(claimIds: readonly string[], facts: readonly ClaimedFact[] = result.claimed_facts) {
    const driver = { ...result.drivers[0]!, claimed_fact_ids: [...claimIds] } as DriverJudgment;
    return { ...result, claimed_facts: [...facts], drivers: [driver] };
}

const claims = () => screen.getAllByTestId("driver-claimed-fact");

/** Every id the contract says is evidence, on this answer. */
function evidenceIds(answer: InvestigationResult): ReadonlySet<string> {
    const findings = [...answer.remaining_work, ...answer.readiness_gaps, ...answer.conflicts];
    return new Set([
        ...answer.evidence_ref_ids,
        ...findings.flatMap((finding) => finding.evidence_ref_ids ?? []),
        ...answer.drivers.flatMap((driver) => driver.evidence_ref_ids ?? []),
        ...(answer.cohort?.members ?? []).flatMap((member) => member.evidence_ref_ids ?? []),
        ...answer.subject_resolution.candidates.flatMap((row) => row.evidence_ref_ids ?? []),
    ]);
}

describe("a driver's claimed facts (CHAOS-12482)", () => {
    it("the fixture is the case: the click on main sends a claim id to the evidence read", () => {
        expect(result.drivers.some((driver) => (driver.claimed_fact_ids ?? []).length > 0)).toBe(
            true,
        );
        expect(evidenceIds(result).has(scalar.claim_id)).toBe(false);
    });

    it("no id outside the evidence refs reaches an evidence button, on any answer", () => {
        for (const answer of Object.values(served)) {
            const open = drawWithOpener(answer);
            const allowed = evidenceIds(answer);
            for (const button of document.querySelectorAll("button.evidence-ref--open")) {
                fireEvent.click(button);
            }
            for (const [refId] of open.mock.calls as [string][]) {
                expect(allowed.has(refId), refId).toBe(true);
            }
            cleanup();
        }
    });

    it("a scalar claim shows its kind, field and value, with no button", () => {
        drawWithOpener(citing([scalar.claim_id]));
        const [claim] = claims();
        expect(claim).toHaveTextContent(cellText(scalar.value));
        expect(claim).toHaveTextContent(scalar.field.replaceAll("_", " "));
        expect(within(claim!).queryByRole("button")).toBeNull();
    });

    it("reads the kind's served word", () => {
        const word = result.vocabulary_labels![`fact_kind:${scalar.kind}`]!;
        drawWithOpener(citing([scalar.claim_id]));
        expect(claims()[0]).toHaveTextContent(word);
    });

    it("a claim with rows and no value sends the reader to its table", () => {
        const { value: _value, ...noValue } = tabular;
        const facts = result.claimed_facts.map((fact) => (fact === tabular ? noValue : fact));
        drawWithOpener(citing([tabular.claim_id], facts as ClaimedFact[]));
        expect(claims()[0]).toHaveTextContent(tabular.field.replaceAll("_", " "));
        expect(claims()[0]).toHaveTextContent("shown in its table on this answer");
    });

    it("a claim with rows and a value shows the value", () => {
        drawWithOpener(citing([tabular.claim_id]));
        expect(claims()[0]).toHaveTextContent(cellText(tabular.value));
    });

    it("an id with no matching claimed fact shows nothing, and no raw id", () => {
        const { container } = render(
            <DeterministicAnswerView
                offersPresentation="popup"
                result={citing(["claim_unknown_1"])}
            />,
        );
        expect(screen.queryByTestId("driver-claimed-fact")).toBeNull();
        expect(container.textContent).not.toContain("claim_unknown_1");
    });

    it("no matching claim at all: no heading either", () => {
        render(
            <DeterministicAnswerView
                offersPresentation="popup"
                result={citing(["claim_unknown_1"])}
            />,
        );
        expect(screen.queryByText("Claimed facts")).toBeNull();
    });

    it("the same id twice reads once", () => {
        drawWithOpener(citing([scalar.claim_id, scalar.claim_id]));
        expect(claims()).toHaveLength(1);
    });

    it("keeps real evidence refs as buttons", () => {
        const [driver] = result.drivers;
        expect(driver!.evidence_ref_ids.length).toBeGreaterThan(0);
        const open = drawWithOpener(citing([scalar.claim_id]));
        const details = screen.getAllByTestId("drivers-panel")[0]!;
        const button = details.querySelector("button.evidence-ref--open");
        expect(button).not.toBeNull();
        fireEvent.click(button!);
        expect(driver!.evidence_ref_ids).toContain((open.mock.calls[0] as [string])[0]);
    });
});
