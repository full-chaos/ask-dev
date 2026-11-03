import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AskDevChat } from "@/components/chat/AskDevChat";
import type { InvestigationResult } from "@/lib/contracts";
import { createStandaloneSource } from "@/render/standalone-source";
import { investigateFromGlobalFetch } from "@/test/fixtures/investigate-fake";
import { mockScenarios } from "@/test/fixtures/investigations";
import { structureMockScenarios } from "@/test/fixtures/structure-needs";

/**
 * CHAOS-12725: an ANSWER (here `degraded`, as served on askdev-1) may carry `structure_needs`
 * with a window offer — acr answered on an inferred window and offers the window beside the
 * answer (CHAOS-4451). That offer must not open the floating popup over the answer, which
 * covered its chart. The popup opens on its own only for `clarification_required`; on an
 * answered turn the offer is a control under the answer, and the popup opens only when the
 * reader asks for it.
 */

function answeredWithWindowNeed(): InvestigationResult {
    const scenario = structureMockScenarios().find(
        (entry) => entry.id === "structure-aggregate-never-elicit",
    )!;
    const result = structuredClone(scenario.result) as InvestigationResult;
    result.effective_evidence_window = {
        ...result.effective_evidence_window,
        relative_id: "trailing_30d",
        provenance: "inferred_default",
    };
    return result;
}

function clarification(): InvestigationResult {
    const scenario = structureMockScenarios().find(
        (entry) => entry.id === "structure-anchor-window",
    )!;
    return structuredClone(scenario.result);
}

let served: InvestigationResult;

beforeEach(() => {
    vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ result: served }) })),
    );
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

async function ask(question: string): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup();
    render(<AskDevChat source={createStandaloneSource(investigateFromGlobalFetch)} />);
    await user.type(screen.getByPlaceholderText(/Ask about a project/), question);
    await user.click(screen.getByRole("button", { name: "Send" }));
    return user;
}

describe("an answered turn with a structure need", () => {
    it("does not open the popup over the answer, and offers the window under it", async () => {
        served = answeredWithWindowNeed();
        expect(served.status).not.toBe("clarification_required");
        const user = await ask("How are deployments going?");
        const offer = await screen.findByRole("group", { name: "Answer offers" });
        expect(screen.queryByRole("dialog")).toBeNull();
        // The served label of the window the answer read, and a control to change it.
        expect(within(offer).getByText("Last 30 days")).toBeTruthy();
        await user.click(within(offer).getByRole("button", { name: "Change period" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText("All time")).toBeTruthy();
    });

    it("still opens the popup on its own for a clarification", async () => {
        served = clarification();
        expect(served.status).toBe("clarification_required");
        await ask("How many PRs merged?");
        await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
        expect(screen.queryByRole("group", { name: "Answer offers" })).toBeNull();
    });

    it("draws no offer row for a plain answer", async () => {
        served = structuredClone(mockScenarios().find((entry) => entry.id === "complete")!.result);
        await ask("How are deployments going?");
        await waitFor(() => expect(document.querySelector(".chat__composer-bar")).toBeTruthy());
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(screen.queryByRole("group", { name: "Answer offers" })).toBeNull();
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});
