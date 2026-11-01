import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AskDevChat } from "@/components/chat/AskDevChat";
import shapesExample from "@/contracts/examples/context_fabric_investigation_result_render_shapes.v1.json";
import type { InvestigationResult } from "@/lib/contracts";
import type { ChatSnapshot, ChatThreadAccess } from "@/render/source";
import { assistantTurn, hostSource, snapshotOf, userTurn } from "@/test/fixtures/host-source";
import { mockScenarios } from "@/test/fixtures/investigations";

/**
 * CHAOS-12387: a conversation opened from History has states of its own, and a composer that may
 * refuse. The cases follow web's `AskDevConversationView`; the words are written out here, so a
 * change to the table must fail here. With no `thread` in the snapshot nothing changes.
 */

const LOCKED_RESTORING = "Loading the conversation…";
const LOCKED_READ_ONLY = "Start a new conversation to ask a question.";
const RESULT = shapesExample as unknown as InvestigationResult;

const answeredTurns = () => [
    userTurn(0, "Is Ask Dev ready?"),
    assistantTurn(1, { kind: "answered", result: RESULT }),
];

function clarificationTurns() {
    const result = structuredClone(
        mockScenarios().find((entry) => entry.id === "clarification")!.result,
    );
    return [userTurn(0, result.question), assistantTurn(1, { kind: "answered", result })];
}

function withThread(thread: ChatThreadAccess, base: ChatSnapshot = snapshotOf()): ChatSnapshot {
    return { ...base, thread };
}

const composerBox = () => screen.getByRole("textbox", { name: "Ask a question" });
const send = () => screen.getByRole("button", { name: "Send" });

describe("the conversation's own states", () => {
    it("restoring with no turns says it is loading, and the composer waits", () => {
        render(<AskDevChat source={hostSource(withThread({ kind: "restoring" }))} />);
        expect(screen.getByTestId("ask-dev-conversation-loading")).toHaveTextContent(
            "Loading this conversation…",
        );
        expect(screen.getByTestId("ask-dev-composer-locked")).toHaveTextContent(LOCKED_RESTORING);
        expect(screen.queryByText("Ask a question to start an investigation.")).toBeNull();
    });

    it("restoring with turns shows them, read-only, with no loading line", () => {
        render(
            <AskDevChat
                source={hostSource(
                    withThread({ kind: "restoring" }, snapshotOf(...clarificationTurns())),
                )}
            />,
        );
        expect(screen.queryByTestId("ask-dev-conversation-loading")).toBeNull();
        expect(document.querySelector(".chat__bubble")).not.toBeNull();
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("unavailable names no cause, offers a new conversation, and has no Try again", async () => {
        const user = userEvent.setup();
        const host = hostSource(withThread({ kind: "unavailable" }), { reloadThread: vi.fn() });
        render(<AskDevChat source={host} />);
        const block = screen.getByTestId("ask-dev-conversation-unavailable");
        expect(block).toHaveTextContent("This conversation is not available.");
        expect(block).toHaveTextContent(
            "Start a new conversation, or open another one from the history.",
        );
        expect(screen.queryByTestId("ask-dev-conversation-retry")).toBeNull();
        expect(screen.getByTestId("ask-dev-composer-locked")).toHaveTextContent(LOCKED_READ_ONLY);
        const start = within(block).getByTestId("ask-dev-conversation-new");
        expect(start).toHaveTextContent("New conversation");
        await user.click(start);
        expect(host.newConversation).toHaveBeenCalledOnce();
    });

    it("a failed read says so, Try again reads once more, and a new conversation is offered", async () => {
        const user = userEvent.setup();
        const reloadThread = vi.fn();
        const host = hostSource(withThread({ kind: "read_failed" }), { reloadThread });
        render(<AskDevChat source={host} />);
        const block = screen.getByTestId("ask-dev-conversation-read-failed");
        expect(block).toHaveTextContent("This conversation could not be read.");
        expect(block).not.toHaveTextContent(
            "Start a new conversation, or open another one from the history.",
        );
        expect(screen.queryByTestId("ask-dev-conversation-unavailable")).toBeNull();
        expect(screen.getByTestId("ask-dev-composer-locked")).toHaveTextContent(LOCKED_READ_ONLY);
        const retry = within(block).getByTestId("ask-dev-conversation-retry");
        expect(retry).toHaveTextContent("Try again");
        await user.click(retry);
        expect(reloadThread).toHaveBeenCalledExactlyOnceWith();
        await user.click(within(block).getByTestId("ask-dev-conversation-new"));
        expect(host.newConversation).toHaveBeenCalledOnce();
    });

    it("offers no Try again when the source cannot read again", () => {
        render(<AskDevChat source={hostSource(withThread({ kind: "read_failed" }))} />);
        expect(screen.getByTestId("ask-dev-conversation-read-failed")).toBeInTheDocument();
        expect(screen.queryByTestId("ask-dev-conversation-retry")).toBeNull();
    });

    it("connect shows the words, the host's slot and a new conversation, with no Try again", async () => {
        const user = userEvent.setup();
        const connect = vi.fn(() => <a href="/connect">Connect Ask Dev</a>);
        const host = hostSource(withThread({ kind: "connect" }), {
            slots: { connect },
            reloadThread: vi.fn(),
        });
        render(<AskDevChat source={host} />);
        const block = screen.getByTestId("ask-dev-conversation-connect");
        expect(block).toHaveTextContent(
            "Ask Dev needs your permission to show this conversation. Connect Ask Dev to see it.",
        );
        expect(within(block).getByRole("link", { name: "Connect Ask Dev" })).toBeInTheDocument();
        expect(screen.queryByTestId("ask-dev-conversation-retry")).toBeNull();
        expect(screen.getByTestId("ask-dev-composer-locked")).toHaveTextContent(LOCKED_READ_ONLY);
        await user.click(within(block).getByTestId("ask-dev-conversation-new"));
        expect(host.newConversation).toHaveBeenCalledOnce();
    });

    it("calls the Connect slot for the connect state only", () => {
        const connect = vi.fn(() => <a href="/connect">Connect Ask Dev</a>);
        render(
            <AskDevChat
                source={hostSource(withThread({ kind: "read_failed" }), { slots: { connect } })}
            />,
        );
        expect(connect).not.toHaveBeenCalled();
    });

    it.each(["unavailable", "read_failed", "connect"] as const)(
        "%s shows none of the turns: not in the log, the rail, the popup or the sources",
        (kind) => {
            const turns = clarificationTurns();
            render(<AskDevChat source={hostSource(withThread({ kind }, snapshotOf(...turns)))} />);
            expect(screen.queryByRole("dialog")).toBeNull();
            expect(document.querySelector(".chat__bubble")).toBeNull();
            expect(document.querySelector(".rail__item")).toBeNull();
            expect(screen.queryByText("Ask a question to start an investigation.")).toBeNull();
        },
    );

    it("a new conversation with no turns keeps the heading and says web's empty line", () => {
        render(<AskDevChat source={hostSource(withThread({ kind: "new" }))} />);
        expect(
            screen.getByRole("heading", { name: /Where is your engineering effort/u }),
        ).toBeTruthy();
        expect(screen.getByText("Your conversation will appear here.")).toBeInTheDocument();
        expect(screen.queryByText("Ask a question to start an investigation.")).toBeNull();
        expect(screen.queryByTestId("ask-dev-composer-locked")).toBeNull();
        expect(composerBox()).toBeEnabled();
    });
});

describe("earlier turns", () => {
    function setup(earlier: "none" | "available" | "loading" | "failed", offered = true) {
        const loadEarlier = vi.fn();
        const host = hostSource(
            withThread({ kind: "loaded", earlier }, snapshotOf(...answeredTurns())),
            offered ? { loadEarlier } : {},
        );
        render(<AskDevChat source={host} />);
        return { loadEarlier };
    }

    it("draws nothing while there are none", () => {
        setup("none");
        expect(screen.queryByTestId("ask-dev-earlier-turns")).toBeNull();
    });

    it("offers them above the oldest turn shown, and reads once", async () => {
        const user = userEvent.setup();
        const { loadEarlier } = setup("available");
        const button = screen.getByTestId("ask-dev-show-earlier");
        expect(button).toHaveTextContent("Show earlier turns");
        expect(button).toBeEnabled();
        expect(screen.getByTestId("ask-dev-earlier-turns")).not.toHaveTextContent(
            "Earlier turns could not be loaded.",
        );
        const bubble = document.querySelector(".chat__bubble")!;
        expect(
            button.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        await user.click(button);
        expect(loadEarlier).toHaveBeenCalledExactlyOnceWith();
    });

    it("disables the button while a page is out", () => {
        setup("loading");
        expect(screen.getByTestId("ask-dev-show-earlier")).toBeDisabled();
    });

    it("says a page could not be read, and may be tried again", () => {
        setup("failed");
        expect(screen.getByTestId("ask-dev-earlier-turns")).toHaveTextContent(
            "Earlier turns could not be loaded.",
        );
        expect(screen.getByTestId("ask-dev-show-earlier")).toBeEnabled();
    });

    it("draws nothing when the source cannot read earlier turns", () => {
        setup("available", false);
        expect(screen.queryByTestId("ask-dev-earlier-turns")).toBeNull();
    });

    it("shows them above an empty loaded conversation too", () => {
        const host = hostSource(withThread({ kind: "loaded", earlier: "available" }), {
            loadEarlier: vi.fn(),
        });
        render(<AskDevChat source={host} />);
        expect(screen.getByTestId("ask-dev-show-earlier")).toBeInTheDocument();
    });
});

describe("the read-only composer", () => {
    const lockedLoaded = (base: ChatSnapshot = snapshotOf()): ChatSnapshot => ({
        ...withThread({ kind: "loaded", earlier: "none" }, base),
        composerLocked: true,
    });

    it("composerLocked on a loaded conversation says an answer is being read", () => {
        render(<AskDevChat source={hostSource(lockedLoaded())} />);
        expect(screen.getByTestId("ask-dev-composer-locked")).toHaveTextContent(LOCKED_RESTORING);
    });

    it("a loaded conversation that is not locked takes a question", () => {
        render(<AskDevChat source={hostSource(withThread({ kind: "loaded", earlier: "none" }))} />);
        expect(screen.queryByTestId("ask-dev-composer-locked")).toBeNull();
        expect(composerBox()).toBeEnabled();
    });

    it.each([
        ["a new conversation", { ...withThread({ kind: "new" }), composerLocked: true }],
        ["no thread at all", { ...snapshotOf(), composerLocked: true }],
    ])("composerLocked on %s says to sign in", (_name, snapshot) => {
        render(<AskDevChat source={hostSource(snapshot)} />);
        expect(screen.getByText("Sign in again to ask a question.")).toBeInTheDocument();
        expect(screen.queryByTestId("ask-dev-composer-locked")).toBeNull();
        expect(composerBox()).toBeDisabled();
    });

    it("refuses to send, keeps the draft, and sends it once unlocked", async () => {
        const user = userEvent.setup();
        const open = withThread({ kind: "loaded", earlier: "none" });
        const host = hostSource(open);
        render(<AskDevChat source={host} />);
        await user.type(composerBox(), "A draft{Shift>}{Enter}{/Shift}of two lines");
        const draft = "A draft\nof two lines";

        host.publish({ ...open, composerLocked: true });

        expect(composerBox()).toBeDisabled();
        expect(composerBox()).toHaveValue(draft);
        expect(send()).toBeDisabled();

        host.publish(open);

        expect(composerBox()).toBeEnabled();
        expect(composerBox()).toHaveValue(draft);
        expect(send()).toBeEnabled();
        await user.click(send());
        expect(host.ask).toHaveBeenCalledOnce();
        expect(host.ask.mock.calls[0]?.[0]).toBe(draft);
    });

    it("freezes the last turn: no popup, no Retry", () => {
        const failed = snapshotOf(
            userTurn(0, "Is Ask Dev ready?"),
            assistantTurn(
                1,
                { kind: "status", status: { kind: "failed" }, retry: true },
                "Is Ask Dev ready?",
            ),
        );
        const first = render(<AskDevChat source={hostSource(lockedLoaded(failed))} />);
        expect(screen.getByTestId("chat-status")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
        first.unmount();

        const clarification = snapshotOf(...clarificationTurns());
        render(<AskDevChat source={hostSource(lockedLoaded(clarification))} />);
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(document.querySelector(".chat__turn--frozen")).not.toBeNull();
    });

    it("keeps the same turn live while it is not locked", () => {
        const clarification = snapshotOf(...clarificationTurns());
        render(
            <AskDevChat
                source={hostSource(withThread({ kind: "loaded", earlier: "none" }, clarification))}
            />,
        );
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(document.querySelector(".chat__turn--frozen")).toBeNull();
    });

    it("still offers Load again on a locked conversation: it is a GET, never a resend", () => {
        const reloadTurn = vi.fn();
        const failed = snapshotOf(
            userTurn(0, "Is Ask Dev ready?"),
            assistantTurn(1, {
                kind: "status",
                status: { kind: "restore_failed" },
                retry: false,
            }),
        );
        render(<AskDevChat source={hostSource(lockedLoaded(failed), { reloadTurn })} />);
        expect(screen.getByRole("button", { name: "Load again" })).toBeInTheDocument();
    });

    it("with no thread and no lock, nothing changes", () => {
        render(<AskDevChat source={hostSource(snapshotOf())} />);
        expect(screen.queryByTestId("ask-dev-composer-locked")).toBeNull();
        expect(composerBox()).toBeEnabled();
        expect(screen.getByText("Ask a question to start an investigation.")).toBeInTheDocument();
    });
});

describe("the not-saved notice", () => {
    const NOTICE = "This conversation was not saved yet.";

    it("replaces the empty line with web's two lines", () => {
        render(<AskDevChat source={hostSource({ ...snapshotOf(), notSaved: true })} />);
        const notice = screen.getByTestId("ask-dev-not-saved");
        expect(notice).toHaveTextContent(NOTICE);
        expect(notice).toHaveTextContent(
            "Reloading the page started a new one. Ask again to continue.",
        );
        expect(screen.queryByText("Ask a question to start an investigation.")).toBeNull();
    });

    it("does not show with turns", () => {
        render(
            <AskDevChat
                source={hostSource({ ...snapshotOf(...answeredTurns()), notSaved: true })}
            />,
        );
        expect(screen.queryByTestId("ask-dev-not-saved")).toBeNull();
    });

    it("does not show while a conversation is restoring", () => {
        render(
            <AskDevChat
                source={hostSource({ ...withThread({ kind: "restoring" }), notSaved: true })}
            />,
        );
        expect(screen.queryByTestId("ask-dev-not-saved")).toBeNull();
    });

    it("does not show on a conversation that cannot be shown", () => {
        render(
            <AskDevChat
                source={hostSource({ ...withThread({ kind: "unavailable" }), notSaved: true })}
            />,
        );
        expect(screen.queryByTestId("ask-dev-not-saved")).toBeNull();
    });

    it("does not show when the source says nothing", () => {
        render(<AskDevChat source={hostSource(snapshotOf())} />);
        expect(screen.queryByTestId("ask-dev-not-saved")).toBeNull();
    });
});

describe("the conversation key", () => {
    const keyed = (conversationKey?: string | number): ChatSnapshot => {
        const base = snapshotOf(...clarificationTurns());
        return conversationKey === undefined ? base : { ...base, conversationKey };
    };

    it("a new key with the same turn ids shows a dismissed popup again", async () => {
        const user = userEvent.setup();
        const host = hostSource(keyed("a"));
        render(<AskDevChat source={host} />);
        await user.click(screen.getByRole("button", { name: "Dismiss" }));
        expect(screen.queryByRole("dialog")).toBeNull();

        host.publish(keyed("b"));

        expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("the same key keeps the dismissal", async () => {
        const user = userEvent.setup();
        const host = hostSource(keyed("a"));
        render(<AskDevChat source={host} />);
        await user.click(screen.getByRole("button", { name: "Dismiss" }));

        host.publish(keyed("a"));

        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("a source that names no key keeps the dismissal", async () => {
        const user = userEvent.setup();
        const host = hostSource(keyed());
        render(<AskDevChat source={host} />);
        await user.click(screen.getByRole("button", { name: "Dismiss" }));

        host.publish(keyed());

        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("drops the draft with the conversation, so it cannot go to another one", async () => {
        const user = userEvent.setup();
        const host = hostSource({ ...snapshotOf(), conversationKey: 1 });
        render(<AskDevChat source={host} />);
        await user.type(composerBox(), "A draft for conversation A");

        host.publish({ ...snapshotOf(), conversationKey: 2 });

        expect(composerBox()).toHaveValue("");
    });

    it.each([
        ["a number and the string of it", 1, "1"],
        ["no key and the string undefined", undefined, "undefined"],
    ])("tells %s apart", async (_name, first, second) => {
        const user = userEvent.setup();
        const host = hostSource(
            first === undefined ? snapshotOf() : { ...snapshotOf(), conversationKey: first },
        );
        render(<AskDevChat source={host} />);
        await user.type(composerBox(), "A draft for conversation A");

        host.publish({ ...snapshotOf(), conversationKey: second });

        expect(composerBox()).toHaveValue("");
    });

    it("keeps the draft when the same key publishes a new turn", async () => {
        const user = userEvent.setup();
        const host = hostSource({ ...snapshotOf(), conversationKey: 1 });
        render(<AskDevChat source={host} />);
        await user.type(composerBox(), "A draft");

        host.publish({ ...snapshotOf(userTurn(0, "Earlier")), conversationKey: 1 });

        expect(composerBox()).toHaveValue("A draft");
    });
});
