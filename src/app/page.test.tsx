import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import WorkbenchPage from "@/app/page";
import { mockScenarios } from "@/test/fixtures/investigations";

const clarification = mockScenarios().find((scenario) => scenario.id === "clarification")!.result;
const answered = mockScenarios().find((scenario) => scenario.id === "complete")!.result;

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
