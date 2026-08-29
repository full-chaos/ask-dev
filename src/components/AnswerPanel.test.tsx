import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AnswerPanel } from "@/components/AnswerPanel";
import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import type { InvestigationResult } from "@/lib/contracts";

const result = canonicalResult as unknown as InvestigationResult;

/**
 * The narrated driver judgments behind a cohort ranking (CHAOS-4449, design
 * doc §5a). These are ordinary `DriverJudgment`s — the panel has no
 * cohort-specific branch — so these assertions prove the generic narration
 * actually carries what a cohort answer needs: standing, title, summary,
 * epistemic status, affected subject, and the claimed facts cited.
 */
const cohortDrivers = result.drivers.filter((driver) => driver.driver_id.startsWith("cohort-"));

describe("AnswerPanel — narrated driver judgments", () => {
    it("the pinned example carries cohort driver judgments at all", () => {
        // Red on the parent pin: the example had no cohort drivers.
        expect(cohortDrivers.length).toBeGreaterThan(0);
    });

    it("renders each driver's standing, title and summary", () => {
        render(<AnswerPanel result={result} />);

        expect(screen.getByText("CHAOS: operational deficiencies")).toBeInTheDocument();
        expect(screen.getByText("CHAOS: health risk")).toBeInTheDocument();
        expect(screen.getByText("CHAOS: readiness gap")).toBeInTheDocument();
        expect(
            screen.getByText(/operational deficiencies \(weight 20, value 1\.00\)/),
        ).toBeInTheDocument();
    });

    it("shows a principal driver's standing distinctly from a contributing one", () => {
        render(<AnswerPanel result={result} />);
        expect(screen.getAllByTitle("principal").length).toBeGreaterThan(0);
        expect(screen.getAllByTitle("contributing").length).toBeGreaterThan(0);
    });

    it("labels an inferred judgment as inferred, never as an observation", () => {
        // Every cohort driver is `epistemic_status: "inferred"`. Rendering it
        // as an observation would upgrade a rule-derived judgment into a
        // measured fact — the distinction North Star check 12 turns on.
        expect(cohortDrivers.every((driver) => driver.epistemic_status === "inferred")).toBe(true);

        render(<AnswerPanel result={result} />);
        const record = screen.getByText("CHAOS: operational deficiencies").closest("li")!;
        expect(within(record).getByText(/inferred/)).toBeInTheDocument();
        expect(within(record).queryByText(/\bobserved\b/)).not.toBeInTheDocument();
    });

    it("names who each judgment is about", () => {
        render(<AnswerPanel result={result} />);
        const record = screen.getByText("CHAOS: operational deficiencies").closest("li")!;
        expect(within(record).getByTestId("driver-affected-subjects")).toHaveTextContent(
            "CHAOS (team)",
        );
    });

    it("cites the claimed facts a judgment rests on, verbatim", () => {
        const [driver] = cohortDrivers;
        const claimId = driver!.claimed_fact_ids![0]!;

        render(<AnswerPanel result={result} />);
        const record = screen.getByText(driver!.title).closest("li")!;
        expect(within(record).getByText(claimId)).toBeInTheDocument();
        // The cited claim really is one the result carries — a citation to a
        // claim that is not in the payload would be a dangling reference.
        expect(result.claimed_facts.some((fact) => fact.claim_id === claimId)).toBe(true);
    });
});
