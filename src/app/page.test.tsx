import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import WorkbenchPage from "@/app/page";
import { mockScenarios } from "@/test/fixtures/investigations";
import { structureMockScenarios } from "@/test/fixtures/structure-needs";

const clarification = mockScenarios().find((scenario) => scenario.id === "clarification")!.result;
const answered = mockScenarios().find((scenario) => scenario.id === "complete")!.result;
const structureKind = structureMockScenarios().find(
    (scenario) => scenario.id === "structure-kind",
)!.result;
const structureVetoed = structureMockScenarios().find(
    (scenario) => scenario.id === "structure-vetoed",
)!.result;

function respondWith(body: unknown): void {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
    );
}

async function ask(question = "Is Atlas on track?") {
    const user = userEvent.setup();
    render(<WorkbenchPage />);
    await user.type(screen.getByLabelText("Ask Context Fabric"), question);
    await user.click(screen.getByRole("button", { name: "Investigate" }));
    return user;
}

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * R3. The clarification interaction has to be reachable from EVERY view.
 * Selecting the raw inspector used to leave a clarification with no choice
 * panel — an interaction the tester cannot reach is the same dead end C3 fixed
 * in the enrichment path, arrived at by a different route.
 */
describe("the clarification choice is reachable from every view", () => {
    it("offers the choice in the default deterministic view", async () => {
        respondWith({ result: clarification });
        await ask();

        expect(
            await screen.findByRole("region", { name: "Which subject did you mean?" }),
        ).toBeInTheDocument();
    });

    it("still offers the choice after switching to the raw inspector", async () => {
        respondWith({ result: clarification });
        const user = await ask();

        await user.click(await screen.findByRole("tab", { name: "Canonical result" }));

        expect(
            screen.getByRole("article", { name: "Canonical result inspector" }),
        ).toBeInTheDocument();
        // The choice survives the view switch.
        expect(
            screen.getByRole("region", { name: "Which subject did you mean?" }),
        ).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: /^Ask again about / }).length).toBeGreaterThan(
            0,
        );
    });

    it("shows no choice panel when the result is an answer", async () => {
        respondWith({ result: answered });
        await ask("What is the status of dev-health-ops?");

        expect(await screen.findByRole("article", { name: "Deterministic answer" })).toBeVisible();
        expect(screen.queryByRole("region", { name: "Which subject did you mean?" })).toBeNull();
    });
});

/**
 * CHAOS-3927 P2: this repo has no real e2e mock path (CHAOS-3738 hard
 * boundary — see README's "What this is, and what it is not"), so the
 * closest thing to an end-to-end proof of the panel-hint flow is driving the
 * REAL page component against a schema-shaped mock response, same as every
 * test above. The fetch mock stands in for the server hop (which this test
 * does not exercise); everything from the click through to the outgoing
 * request body is the real component tree.
 */
describe("structure-needs panel hints (design brief §2.2)", () => {
    it("renders the offers and sends the full accumulated batch in ONE re-ask", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: structureKind }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        const user = await ask("How's the pipeline doing?");

        const option = structureKind.structure_needs!.kind_options![1]!;
        await user.click(await screen.findByRole("button", { name: `Select ${option.label}` }));
        await user.click(screen.getByRole("button", { name: "Ask again with these selections" }));

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        const secondCallBody = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string) as Record<
            string,
            unknown
        >;
        expect(secondCallBody.priorKindReceipts).toEqual([
            { result_id: structureKind.result_id, receipt_id: option.receipt_id },
        ]);
        // The question travels UNCHANGED — the same rule the subject-choice
        // flow already holds (never rewrite it to encode the pick).
        expect(secondCallBody.question).toBe("How's the pipeline doing?");
    });

    it("surfaces a vetoed selection as a visible notice, reachable from every view", async () => {
        respondWith({ result: structureVetoed });
        const user = await ask("How many PRs merged?");

        expect(
            await screen.findByRole("alert", { name: "Structure confirmation" }),
        ).toHaveTextContent("Some selections were not applied");

        await user.click(await screen.findByRole("tab", { name: "Canonical result" }));

        expect(screen.getByRole("alert", { name: "Structure confirmation" })).toBeInTheDocument();
    });

    /**
     * codex round 4 (non-blocking coverage note): the component-level
     * cross-view proof lives in StructureNeedsPanel.test.tsx's synthetic
     * two-instance harness; this proves the SAME invariant through the
     * real page component and its real view switch, not a stand-in.
     */
    it("keeps a selection made in one view visible, and confirmable, after switching views", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: structureKind }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        const user = await ask("How's the pipeline doing?");
        const option = structureKind.structure_needs!.kind_options![0]!;

        // Selected in the default (deterministic) view.
        await user.click(await screen.findByRole("button", { name: `Select ${option.label}` }));
        await user.click(await screen.findByRole("tab", { name: "Canonical result" }));

        // Visible, without re-selecting, in the raw view's own instance.
        expect(
            screen.getByRole("button", { name: `Unselect ${option.label}` }),
        ).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Ask again with these selections" }));

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        const secondCallBody = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string) as Record<
            string,
            unknown
        >;
        expect(secondCallBody.priorKindReceipts).toEqual([
            { result_id: structureKind.result_id, receipt_id: option.receipt_id },
        ]);
    });
});

describe("the enrichment tab stays closed", () => {
    /**
     * The wiring gate is a reviewed commit, not a runtime condition. A rendered
     * answer satisfies a PRECONDITION for that commit; it must not open the tab
     * by itself.
     */
    it("is disabled even when a real answer renders", async () => {
        respondWith({ result: answered });
        await ask("What is the status of dev-health-ops?");

        expect(await screen.findByRole("tab", { name: "Enriched (OpenUI)" })).toBeDisabled();
    });
});

describe("a failure is shown as a failure", () => {
    it("renders the failure panel and no answer surface", async () => {
        respondWith({
            failure: {
                code: "acr_investigation_failed",
                message: "ACR ran the investigation and it failed inside the engine.",
                httpStatus: 500,
                upstreamRequestId: "req_0dceba3522cfdea61dd957eb9bb51e1d",
                retryable: false,
            },
        });
        await ask("What is the status of dev-health-ops?");

        expect(await screen.findByRole("alert", { name: "No answer" })).toBeInTheDocument();
        expect(screen.queryByRole("article", { name: "Deterministic answer" })).toBeNull();
        expect(screen.queryByRole("tab", { name: "Canonical result" })).toBeNull();
    });
});
