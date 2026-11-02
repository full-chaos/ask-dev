import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AskDevChat } from "@/components/chat/AskDevChat";
import { createStandaloneSource } from "@/render/standalone-source";
import { boundedAnswerScenarios } from "@/test/fixtures/bounded-answers";
import { investigateFromGlobalFetch } from "@/test/fixtures/investigate-fake";
import type { ChatEvidenceRef } from "@/render/source";
import { assistantTurn, hostSource, snapshotOf, userTurn } from "@/test/fixtures/host-source";

/**
 * CHAOS-12559: when ACR serves its bounded form, the chat draws it as an answer, with what it left
 * out, and never as the "too large" failure.
 */

afterEach(() => {
    vi.unstubAllGlobals();
});

async function ask(result: unknown) {
    const user = userEvent.setup();
    vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ result }) })),
    );
    render(<AskDevChat source={createStandaloneSource(investigateFromGlobalFetch)} />);
    await user.type(
        screen.getByRole("textbox", { name: "Ask a question" }),
        "Which teams struggle?{Enter}",
    );
}

describe("a bounded answer in the chat", () => {
    it("is drawn as the shortened answer, with what it left out", async () => {
        const projection = boundedAnswerScenarios["bounded-answer"];
        await ask(projection);
        const view = await screen.findByRole("region", { name: "Shortened answer" });
        expect(within(view).getByText(projection.direct_judgment)).toBeInTheDocument();
        expect(within(view).getByRole("note")).toHaveTextContent(
            "This answer was shortened to fit",
        );
        expect(screen.queryByText(/too large to show here/)).not.toBeInTheDocument();
    });

    it("uses the host's evidence opener and chart slot, as a whole answer does", async () => {
        const projection = boundedAnswerScenarios["bounded-answer"];
        const evidence = { open: vi.fn<(ref: ChatEvidenceRef) => void>() };
        const shape = vi.fn(() => <div data-testid="host-chart">chart</div>);
        render(
            <AskDevChat
                source={hostSource(
                    snapshotOf(
                        userTurn(0, "Which teams struggle?"),
                        assistantTurn(1, { kind: "bounded", projection }),
                    ),
                    { evidence, slots: { shape } },
                )}
            />,
        );
        const view = screen.getByRole("region", { name: "Shortened answer" });
        expect(within(view).getByTestId("host-chart")).toBeInTheDocument();
        const [first] = within(view).getAllByRole("button", { name: /Evidence|evidence/ });
        expect(first).toBeDefined();
        await userEvent.click(first!);
        expect(evidence.open).toHaveBeenCalledWith(
            expect.objectContaining({ resultId: projection.result_id }),
        );
    });

    it("is a failure when the bounded form does not meet its own schema", async () => {
        await ask({ schema_version: "context_fabric_answer_projection.v1", result_id: "result_1" });
        await waitFor(() =>
            expect(
                screen.getByText(
                    "Ask Dev returned a result that does not meet the required format.",
                ),
            ).toBeInTheDocument(),
        );
        expect(screen.queryByRole("region", { name: "Shortened answer" })).not.toBeInTheDocument();
    });
});
