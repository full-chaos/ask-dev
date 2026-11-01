import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act, createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { ChatComposer, type ChatComposerHandle } from "@/components/chat/ChatComposer";

/** CHAOS-12387: a lock refuses every way in, and takes nothing from the draft. */
function setup(lock?: "signed_out" | "restoring" | "read_only") {
    const ref = createRef<ChatComposerHandle>();
    const onAsk = vi.fn(() => Promise.resolve(true));
    const view = render(<ChatComposer lock={lock} onAsk={onAsk} pending={false} ref={ref} />);
    return { onAsk, ref, view };
}

const box = () => screen.getByRole("textbox", { name: "Ask a question" });

describe("ChatComposer's lock", () => {
    it.each([
        ["restoring", "Loading the conversation…"],
        ["read_only", "Start a new conversation to ask a question."],
    ] as const)("%s says why, under web's test id", (lock, words) => {
        setup(lock);
        expect(screen.getByTestId("ask-dev-composer-locked")).toHaveTextContent(words);
        expect(box()).toBeDisabled();
        expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    });

    it("signed_out says so with no test id, as web does", () => {
        setup("signed_out");
        expect(screen.getByText("Sign in again to ask a question.")).toBeInTheDocument();
        expect(screen.queryByTestId("ask-dev-composer-locked")).toBeNull();
        expect(box()).toBeDisabled();
    });

    it("says nothing while it is not locked", () => {
        setup();
        expect(screen.queryByTestId("ask-dev-composer-locked")).toBeNull();
        expect(box()).toBeEnabled();
    });

    it("a retry neither sends nor replaces the draft", async () => {
        const user = userEvent.setup();
        const { onAsk, ref, view } = setup();
        await user.type(box(), "My draft");
        view.rerender(<ChatComposer lock="read_only" onAsk={onAsk} pending={false} ref={ref} />);

        act(() => {
            ref.current?.retry("Another question");
        });

        expect(onAsk).not.toHaveBeenCalled();
        expect(box()).toHaveValue("My draft");
    });

    it("keeps a draft it holds when the form is submitted anyway", async () => {
        const user = userEvent.setup();
        const { onAsk, ref, view } = setup();
        await user.type(box(), "My draft");
        view.rerender(<ChatComposer lock="read_only" onAsk={onAsk} pending={false} ref={ref} />);

        act(() => {
            box().closest("form")?.requestSubmit();
        });

        expect(onAsk).not.toHaveBeenCalled();
        expect(box()).toHaveValue("My draft");
    });

    it("a measure of zero leaves the height alone: a hidden box measures zero", () => {
        setup();
        expect(box().scrollHeight).toBe(0);
        expect((box() as HTMLTextAreaElement).style.height).not.toBe("0px");
    });

    it("sets the height a visible box measures", async () => {
        const user = userEvent.setup();
        setup();
        Object.defineProperty(box(), "scrollHeight", { configurable: true, value: 44 });
        await user.type(box(), "x");
        expect((box() as HTMLTextAreaElement).style.height).toBe("44px");
    });
});
