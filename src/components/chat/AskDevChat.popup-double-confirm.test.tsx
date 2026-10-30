import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AskDevChat } from "@/components/chat/AskDevChat";
import type { InvestigationResult } from "@/lib/contracts";
import { mockScenarios } from "@/test/fixtures/investigations";

/**
 * CHAOS-12003: the last popup "Continue" must send ONE request. A popup
 * flow that picks a structure `subject_candidate` ("Did you mean one of
 * these?") AND a `subject_resolution` candidate ("Which subject did you
 * mean?") on the same result used to fan out into two requests from one
 * `confirmSelections` call; the second carried a receipt the first had
 * already superseded and returned `no_match`.
 */

function mixedAxisResult(): InvestigationResult {
    const base = mockScenarios().find((entry) => entry.id === "clarification")!.result;
    return {
        ...structuredClone(base),
        result_id: "result_mixed_0001",
        structure_needs: {
            missing: ["subject_candidate"],
            candidate_options: [
                {
                    receipt_id: "candr_container_0001",
                    option_id: "candidate_container",
                    label: "Container",
                    kind: "project",
                    canonical_id: "project:container",
                    offer_source: "engine",
                },
            ],
        },
    };
}

function answeredResult(): InvestigationResult {
    const base = mockScenarios().find((entry) => entry.id === "complete")?.result;
    return {
        ...structuredClone(base ?? mockScenarios()[0]!.result),
        result_id: "result_answer_0001",
        status: "complete",
    };
}

describe("popup final confirm (CHAOS-12003)", () => {
    const bodies: Record<string, unknown>[] = [];

    beforeEach(() => {
        bodies.length = 0;
        vi.stubGlobal(
            "fetch",
            vi.fn((_url: string, init: { body: string }) => {
                const body = JSON.parse(init.body) as Record<string, unknown>;
                bodies.push(body);
                const result = bodies.length === 1 ? mixedAxisResult() : answeredResult();
                return Promise.resolve({ json: () => Promise.resolve({ result }) });
            }),
        );
        Element.prototype.scrollIntoView = vi.fn();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("sends exactly one request after the last Continue", async () => {
        const user = userEvent.setup();
        render(<AskDevChat />);
        await user.type(screen.getByPlaceholderText(/Ask about a project/), "Is Atlas on track?");
        await user.click(screen.getByRole("button", { name: "Send" }));
        await screen.findByText("Did you mean one of these?");
        expect(bodies).toHaveLength(1);

        await user.click(screen.getByRole("button", { name: /Container/ }));
        await user.click(screen.getByRole("button", { name: /^Continue/ }));
        await waitFor(() =>
            expect(document.querySelector(".clarification-popup")?.textContent).toMatch(/Atlas/),
        );
        expect(bodies).toHaveLength(1);
        await user.click(
            within(document.querySelector<HTMLElement>(".clarification-popup")!).getAllByRole(
                "button",
                { name: /Atlas/ },
            )[0]!,
        );
        await user.click(screen.getByRole("button", { name: /^Continue with/ }));

        await waitFor(() => expect(bodies.length).toBeGreaterThanOrEqual(2));
        await new Promise((resolve) => setTimeout(resolve, 50));
        // The one request carries BOTH picks.
        expect(bodies[1]).toMatchObject({
            priorSubjectReceipts: [{ receipt_id: "receipt_atlas_project" }],
            priorCandidateReceipts: [{ receipt_id: "candr_container_0001" }],
        });
        expect(bodies).toHaveLength(2);
    });
});
