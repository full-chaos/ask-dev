import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChatPage from "@/app/page";
import { mockScenarios } from "@/test/fixtures/investigations";
import { structureMockScenarios } from "@/test/fixtures/structure-needs";

const clarification = mockScenarios().find((scenario) => scenario.id === "clarification")!.result;
const answered = mockScenarios().find((scenario) => scenario.id === "complete")!.result;
const structureKind = structureMockScenarios().find(
    (scenario) => scenario.id === "structure-kind",
)!.result;

function respondWith(body: unknown): void {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
    );
}

async function ask(question: string): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Ask a question"), question);
    await user.click(screen.getByRole("button", { name: "Send" }));
    return user;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("the chat surface's empty state", () => {
    it("shows a real empty state, not a mock answer", () => {
        render(<ChatPage />);

        expect(screen.getByText("Ask a question to start an investigation.")).toBeInTheDocument();
        expect(screen.queryByRole("article", { name: "Deterministic answer" })).toBeNull();
    });
});

describe("asking a question appends a user turn and an assistant turn", () => {
    it("renders the question as its own turn and the answer under it", async () => {
        respondWith({ result: answered });
        render(<ChatPage />);

        await ask("What is the status of dev-health-ops?");

        expect(
            await screen.findByText("What is the status of dev-health-ops?"),
        ).toBeInTheDocument();
        expect(
            await screen.findByRole("article", { name: "Deterministic answer" }),
        ).toBeInTheDocument();
        expect(
            screen.queryByText("Ask a question to start an investigation."),
        ).not.toBeInTheDocument();
    });

    it("keeps every prior turn visible after a second question", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        render(<ChatPage />);

        await ask("First question?");
        await screen.findByRole("article", { name: "Deterministic answer" });
        await ask("Second question?");

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(screen.getByText("First question?")).toBeInTheDocument();
        expect(await screen.findByText("Second question?")).toBeInTheDocument();
        expect(screen.getAllByRole("article", { name: "Deterministic answer" })).toHaveLength(2);
    });
});

describe("a failure renders as a failure, in its own turn", () => {
    it("shows the failure panel and no answer surface", async () => {
        respondWith({
            failure: {
                code: "workbench_misconfigured",
                message: "Ask Dev's server is not configured.",
                retryable: false,
            },
        });
        render(<ChatPage />);

        await ask("What is the status of dev-health-ops?");

        expect(await screen.findByRole("alert", { name: "No answer" })).toBeInTheDocument();
        expect(screen.queryByRole("article", { name: "Deterministic answer" })).toBeNull();
    });
});

describe("the clarification chip is live only on the most recent assistant turn", () => {
    it("offers the choice on a fresh clarification turn", async () => {
        respondWith({ result: clarification });
        render(<ChatPage />);

        await ask("Is Atlas on track?");

        expect(
            await screen.findByRole("region", { name: "Which subject did you mean?" }),
        ).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: /^Ask again about / }).length).toBeGreaterThan(
            0,
        );
    });

    it("re-asks with the chosen receipt and freezes the older turn's chip", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: clarification }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        render(<ChatPage />);

        await ask("Is Atlas on track?");
        const user = userEvent.setup();
        const candidate = clarification.subject_resolution.candidates[0]!;
        await user.click(
            await screen.findByRole("button", {
                name: `Ask again about ${candidate.subject.label}`,
            }),
        );

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        const secondCallBody = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string) as Record<
            string,
            unknown
        >;
        expect(secondCallBody.priorSubjectReceipts).toEqual([
            { result_id: clarification.result_id, receipt_id: candidate.receipt_id },
        ]);
        // The question that produced the CLARIFICATION travels unchanged, not
        // the composer's original text — same rule the Workbench holds.
        expect(secondCallBody.question).toBe(clarification.question);

        // The now-superseded clarification turn can no longer be acted on:
        // its own candidate list renders, but read-only.
        expect(
            await screen.findByRole("region", { name: "Subject candidates" }),
        ).toBeInTheDocument();
        expect(screen.getByTestId("cannot-choose-here")).toBeInTheDocument();
    });
});

describe("structure-needs chips (CHAOS-3927 P2, mounted as-is under a chat turn)", () => {
    it("renders the offers and sends the accumulated batch in ONE re-ask", async () => {
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
        render(<ChatPage />);

        await ask("How's the pipeline doing?");
        const user = userEvent.setup();
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

        // The superseded turn's panel is still visible but can no longer be
        // confirmed — inspection only, same as ClarificationPanel's own rule.
        expect(screen.getByTestId("cannot-confirm-structure-here")).toBeInTheDocument();
    });
});
