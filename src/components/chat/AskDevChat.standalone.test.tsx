import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AskDevChat } from "@/components/chat/AskDevChat";
import shapesExample from "@/contracts/examples/context_fabric_investigation_result_render_shapes.v1.json";
import { createStandaloneSource } from "@/render/standalone-source";

/**
 * CHAOS-12387: the standalone app stays as it was. Its source offers none of what a host offers, so
 * none of it renders there: not before a question, and not on an answer.
 */

const HOST_ONLY = [
    "ask-dev-history",
    "ask-dev-history-toggle",
    "ask-dev-history-new",
    "ask-dev-feedback",
    "ask-dev-context",
    "ask-dev-composer-locked",
    "ask-dev-conversation-loading",
    "ask-dev-conversation-unavailable",
    "ask-dev-conversation-read-failed",
    "ask-dev-conversation-connect",
    "ask-dev-earlier-turns",
    "ask-dev-not-saved",
];

function expectNoneOfIt() {
    for (const testId of HOST_ONLY) expect(screen.queryByTestId(testId), testId).toBeNull();
    expect(document.querySelector(".chat__narrow-bar")).toBeNull();
    expect(document.querySelector("[hidden]")).toBeNull();
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("the standalone app", () => {
    it("its source offers none of it", () => {
        const source = createStandaloneSource();
        for (const capability of [
            "history",
            "feedback",
            "pageContext",
            "reloadThread",
            "loadEarlier",
        ]) {
            expect(capability in source, capability).toBe(false);
        }
        expect(Object.keys(source.getSnapshot()).sort()).toEqual(["stoppable", "turns"]);
    });

    it("shows none of it on an empty page, and keeps its own empty line", () => {
        render(<AskDevChat />);
        expectNoneOfIt();
        expect(screen.getByText("Ask a question to start an investigation.")).toBeInTheDocument();
    });

    it("shows none of it on an answer", async () => {
        const user = userEvent.setup();
        vi.stubGlobal(
            "fetch",
            vi.fn(() =>
                Promise.resolve({ json: () => Promise.resolve({ result: shapesExample }) }),
            ),
        );
        render(<AskDevChat />);
        await user.type(
            screen.getByRole("textbox", { name: "Ask a question" }),
            "Is Ask Dev ready?{Enter}",
        );
        await waitFor(() => expect(screen.getByTestId("answer-panel")).toBeInTheDocument());
        expectNoneOfIt();
    });
});
