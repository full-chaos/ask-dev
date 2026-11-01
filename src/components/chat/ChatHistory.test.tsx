import { readFileSync } from "node:fs";
import path from "node:path";

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AskDevChat } from "@/components/chat/AskDevChat";
import type { ChatHistoryRow, ChatHistorySnapshot, ChatSnapshot } from "@/render/source";
import {
    fakeHistory,
    historySnapshot,
    hostSource,
    snapshotOf,
    userTurn,
} from "@/test/fixtures/host-source";

/**
 * CHAOS-12387: the saved conversations, driven by a fake host. The cases follow web's
 * `AskDevHistory` and its test; the words are written out here, not read from `chat-copy.ts`, so a
 * change to the table must fail here.
 */

const THREAD_A = "thread_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const THREAD_B = "thread_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const AT = "2026-10-30T12:00:00.000Z";

const rowA: ChatHistoryRow = { id: THREAD_A, firstQuestion: null, lastTurnAt: AT, turnCount: 2 };
const rowB: ChatHistoryRow = { id: THREAD_B, firstQuestion: null, lastTurnAt: AT, turnCount: 1 };

function when(iso: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(iso),
    );
}

function setup(history: Partial<ChatHistorySnapshot> = {}, base: ChatSnapshot = snapshotOf()) {
    const api = fakeHistory();
    const connect = vi.fn(() => <a href="/connect">Connect Ask Dev</a>);
    const host = hostSource(
        { ...base, history: historySnapshot(history) },
        { history: api, slots: { connect } },
    );
    render(<AskDevChat source={host} />);
    return { api, connect, host };
}

const rowOf = (id: string) =>
    screen
        .getAllByTestId("ask-dev-history-row")
        .find((row) => row.getAttribute("data-thread-id") === id)!;

describe("History: its states", () => {
    it.each(["idle", "loading"] as const)("%s with no rows says it is loading", (status) => {
        setup({ status });
        expect(screen.getByTestId("ask-dev-history-loading")).toHaveTextContent(
            "Loading conversations…",
        );
        expect(screen.queryByTestId("ask-dev-history-list")).toBeNull();
        expect(screen.queryByTestId("ask-dev-history-empty")).toBeNull();
    });

    it("ready with no rows says there are none", () => {
        setup({ status: "ready" });
        expect(screen.getByTestId("ask-dev-history-empty")).toHaveTextContent(
            "No conversations yet.",
        );
        expect(screen.queryByTestId("ask-dev-history-loading")).toBeNull();
    });

    it("titles the list and keeps the rows while a new read runs", () => {
        setup({ status: "loading", rows: [rowA] });
        expect(
            within(screen.getByTestId("ask-dev-history")).getByRole("heading", {
                name: "Conversations",
            }),
        ).toBeInTheDocument();
        expect(screen.getAllByTestId("ask-dev-history-row")).toHaveLength(1);
        expect(screen.queryByTestId("ask-dev-history-loading")).toBeNull();
    });

    it("a failed read says so, and Try again reads once more", async () => {
        const user = userEvent.setup();
        const { api } = setup({ status: "read_failed" });
        expect(screen.getByTestId("ask-dev-history-read-failed")).toHaveTextContent(
            "History could not be read.",
        );
        expect(screen.queryByTestId("ask-dev-history-loading")).toBeNull();
        expect(screen.queryByTestId("ask-dev-history-empty")).toBeNull();
        api.load.mockClear();
        await user.click(screen.getByTestId("ask-dev-history-retry"));
        expect(screen.getByTestId("ask-dev-history-retry")).toHaveTextContent("Try again");
        expect(api.load).toHaveBeenCalledExactlyOnceWith();
    });

    it("connect shows the words, then the host's slot, and no Try again", () => {
        const { connect } = setup({ status: "connect" });
        const block = screen.getByTestId("ask-dev-history-connect");
        expect(block).toHaveTextContent(
            "Ask Dev needs your permission to show your conversations. Connect Ask Dev to see them.",
        );
        expect(within(block).getByRole("link", { name: "Connect Ask Dev" })).toHaveAttribute(
            "href",
            "/connect",
        );
        expect(connect).toHaveBeenCalled();
        expect(screen.queryByTestId("ask-dev-history-retry")).toBeNull();
        expect(screen.queryByTestId("ask-dev-history-read-failed")).toBeNull();
        expect(block.textContent).not.toMatch(/authorization_required|read_failed/u);
    });

    it("calls the Connect slot for the connect state only", () => {
        const { connect } = setup({ status: "ready" });
        expect(connect).not.toHaveBeenCalled();
    });

    it("words connect without a slot, and draws no empty slot", () => {
        const host = hostSource(
            { ...snapshotOf(), history: historySnapshot({ status: "connect" }) },
            { history: fakeHistory() },
        );
        render(<AskDevChat source={host} />);
        expect(screen.getByTestId("ask-dev-history-connect").textContent).toBe(
            "Ask Dev needs your permission to show your conversations. Connect Ask Dev to see them.",
        );
    });
});

describe("History: a row", () => {
    it("with no first question is named by its date and count", () => {
        setup({ rows: [rowA, rowB] });
        expect(within(rowOf(THREAD_A)).getByTestId("ask-dev-history-open")).toHaveTextContent(
            `Conversation of ${when(AT)} · 2 questions`,
        );
        expect(within(rowOf(THREAD_B)).getByTestId("ask-dev-history-open")).toHaveTextContent(
            `Conversation of ${when(AT)} · 1 question`,
        );
        expect(within(rowOf(THREAD_A)).queryByTestId("ask-dev-history-question")).toBeNull();
        expect(within(rowOf(THREAD_A)).queryByTestId("ask-dev-history-meta")).toBeNull();
    });

    it("is titled by its first question, the full text in title, then the date and count", () => {
        const question =
            "Which teams are overloaded this quarter, and what is driving it across the platform org?";
        setup({ rows: [{ ...rowA, firstQuestion: question }] });
        const open = within(rowOf(THREAD_A)).getByTestId("ask-dev-history-open");
        const title = within(open).getByTestId("ask-dev-history-question");
        expect(title.textContent).toBe(question);
        expect(title).toHaveAttribute("title", question);
        expect(within(open).getByTestId("ask-dev-history-meta").textContent).toBe(
            `${when(AT)} · 2 questions`,
        );
        expect(open).toHaveAccessibleName(expect.stringContaining(question));
    });

    it("never shows a blank title: a blank first question keeps the date-and-count name", () => {
        setup({ rows: [{ ...rowA, firstQuestion: "   \n\t " }] });
        const open = within(rowOf(THREAD_A)).getByTestId("ask-dev-history-open");
        expect(within(open).queryByTestId("ask-dev-history-question")).toBeNull();
        expect(open).toHaveTextContent(`Conversation of ${when(AT)} · 2 questions`);
    });

    it("shows a question as inert text", () => {
        const hostile = '<img src=x onerror="alert(1)"> see https://evil.example/x';
        setup({ rows: [{ ...rowA, firstQuestion: hostile }] });
        const open = within(rowOf(THREAD_A)).getByTestId("ask-dev-history-open");
        expect(within(open).getByTestId("ask-dev-history-question").textContent).toBe(hostile);
        expect(open.querySelector("img, a")).toBeNull();
    });

    it("marks only the current conversation", () => {
        setup({ rows: [rowA, { ...rowB, firstQuestion: "Who ships?" }], currentId: THREAD_B });
        const current = rowOf(THREAD_B);
        const other = rowOf(THREAD_A);
        expect(current).toHaveAttribute("data-current", "true");
        expect(other).not.toHaveAttribute("data-current");
        expect(within(current).getByTestId("ask-dev-history-open")).toHaveAttribute(
            "aria-current",
            "true",
        );
        expect(within(other).getByTestId("ask-dev-history-open")).not.toHaveAttribute(
            "aria-current",
        );
        expect(within(current).getByTestId("ask-dev-history-meta")).toHaveTextContent("Current");
        expect(other).not.toHaveTextContent("Current");
    });

    it("marks a current row that has no first question too", () => {
        setup({ rows: [rowA], currentId: THREAD_A });
        expect(within(rowOf(THREAD_A)).getByTestId("ask-dev-history-open")).toHaveTextContent(
            "Current",
        );
    });

    it("opens through the source, once, with its id", async () => {
        const user = userEvent.setup();
        const { api } = setup({ rows: [rowA, rowB] });
        await user.click(within(rowOf(THREAD_B)).getByTestId("ask-dev-history-open"));
        expect(api.open).toHaveBeenCalledExactlyOnceWith(THREAD_B);
    });
});

describe("History: delete", () => {
    it("asks first: Delete confirms, Cancel keeps the row, and only the confirm removes", async () => {
        const user = userEvent.setup();
        const { api } = setup({ rows: [rowA, rowB] });
        const row = rowOf(THREAD_A);
        expect(within(row).getByTestId("ask-dev-history-delete")).toHaveAttribute(
            "aria-label",
            "Delete conversation",
        );
        expect(within(row).getByTestId("ask-dev-history-delete")).toHaveAttribute(
            "title",
            "Delete conversation",
        );

        await user.click(within(row).getByTestId("ask-dev-history-delete"));
        expect(within(row).getByTestId("ask-dev-history-confirm")).toHaveTextContent(
            "Delete this conversation? This cannot be undone.",
        );
        expect(within(row).queryByTestId("ask-dev-history-delete")).toBeNull();
        expect(within(rowOf(THREAD_B)).queryByTestId("ask-dev-history-confirm")).toBeNull();
        expect(api.remove).not.toHaveBeenCalled();

        const cancel = within(row).getByTestId("ask-dev-history-confirm-cancel");
        expect(cancel).toHaveTextContent("Cancel");
        await user.click(cancel);
        expect(within(row).queryByTestId("ask-dev-history-confirm")).toBeNull();
        expect(api.remove).not.toHaveBeenCalled();

        await user.click(within(row).getByTestId("ask-dev-history-delete"));
        const confirm = within(row).getByTestId("ask-dev-history-confirm-delete");
        expect(confirm).toHaveTextContent("Confirm delete?");
        await user.click(confirm);
        expect(api.remove).toHaveBeenCalledExactlyOnceWith(THREAD_A);
        expect(within(row).queryByTestId("ask-dev-history-confirm")).toBeNull();
    });

    it.each([
        ["the current row, running", THREAD_A, true, true],
        ["the current row, not running", THREAD_A, false, false],
        ["another row, running", THREAD_B, true, false],
    ])("says a running question is not stopped: %s", async (_name, id, running, says) => {
        const user = userEvent.setup();
        setup({ rows: [rowA, rowB], currentId: THREAD_A, running });
        await user.click(within(rowOf(id)).getByTestId("ask-dev-history-delete"));
        const line = within(rowOf(id)).queryByTestId("ask-dev-history-confirm-running");
        if (says) {
            expect(line).toHaveTextContent("This does not stop the running question.");
        } else {
            expect(line).toBeNull();
        }
    });

    it("moves focus to Cancel when the confirm opens, and back to Delete on Cancel", async () => {
        const user = userEvent.setup();
        setup({ rows: [rowA, rowB] });
        const row = rowOf(THREAD_A);
        await user.click(within(row).getByTestId("ask-dev-history-delete"));
        expect(within(row).getByTestId("ask-dev-history-confirm-cancel")).toHaveFocus();

        await user.click(within(row).getByTestId("ask-dev-history-confirm-cancel"));

        expect(within(row).getByTestId("ask-dev-history-delete")).toHaveFocus();
    });

    it("keeps focus in the list when a delete is confirmed", async () => {
        const user = userEvent.setup();
        setup({ rows: [rowA, rowB] });
        const row = rowOf(THREAD_A);
        await user.click(within(row).getByTestId("ask-dev-history-delete"));

        await user.click(within(row).getByTestId("ask-dev-history-confirm-delete"));

        expect(screen.getByTestId("ask-dev-history")).toHaveFocus();
    });

    it("disables Delete on the rows being deleted only", () => {
        setup({ rows: [rowA, rowB], deleting: [THREAD_A] });
        expect(within(rowOf(THREAD_A)).getByTestId("ask-dev-history-delete")).toBeDisabled();
        expect(within(rowOf(THREAD_B)).getByTestId("ask-dev-history-delete")).toBeEnabled();
    });

    it("says on its own row that a delete failed", () => {
        setup({ rows: [rowA, rowB], deleteFailed: THREAD_B });
        expect(
            within(rowOf(THREAD_B)).getByTestId("ask-dev-history-delete-failed"),
        ).toHaveTextContent("This conversation was not deleted. Try again.");
        expect(within(rowOf(THREAD_A)).queryByTestId("ask-dev-history-delete-failed")).toBeNull();
    });
});

describe("History: more pages", () => {
    it("offers Show more only while there is more, and reads once", async () => {
        const user = userEvent.setup();
        const { api } = setup({ rows: [rowA], hasMore: true });
        const more = screen.getByTestId("ask-dev-history-more");
        expect(more).toHaveTextContent("Show more");
        expect(more).toBeEnabled();
        await user.click(more);
        expect(api.loadMore).toHaveBeenCalledExactlyOnceWith();
    });

    it("draws no Show more on the last page", () => {
        setup({ rows: [rowA] });
        expect(screen.queryByTestId("ask-dev-history-more")).toBeNull();
    });

    it("disables Show more while a page is out", () => {
        setup({ rows: [rowA], hasMore: true, loadingMore: true });
        expect(screen.getByTestId("ask-dev-history-more")).toBeDisabled();
    });

    it("says a page could not be read, and keeps Show more", () => {
        setup({ rows: [rowA], hasMore: true, moreFailed: true });
        expect(screen.getByTestId("ask-dev-history")).toHaveTextContent(
            "More conversations could not be loaded.",
        );
        expect(screen.getByTestId("ask-dev-history-more")).toBeEnabled();
    });

    it("says nothing of a page while none failed", () => {
        setup({ rows: [rowA], hasMore: true });
        expect(screen.getByTestId("ask-dev-history")).not.toHaveTextContent(
            "More conversations could not be loaded.",
        );
    });
});

describe("History: when it is read", () => {
    it("reads once on mount", () => {
        const { api } = setup();
        expect(api.load).toHaveBeenCalledExactlyOnceWith();
    });

    it("reads again when the current conversation changes, and only then", () => {
        const { api, host } = setup({ currentId: null });
        host.publish({
            ...snapshotOf(),
            history: historySnapshot({ currentId: null, rows: [rowA] }),
        });
        expect(api.load).toHaveBeenCalledOnce();
        host.publish({ ...snapshotOf(), history: historySnapshot({ currentId: THREAD_A }) });
        expect(api.load).toHaveBeenCalledTimes(2);
        host.publish({ ...snapshotOf(), history: historySnapshot({ currentId: THREAD_A }) });
        expect(api.load).toHaveBeenCalledTimes(2);
    });

    it("reads once under Strict Mode, and once more for a new conversation", () => {
        const api = fakeHistory();
        const host = hostSource(
            { ...snapshotOf(), history: historySnapshot({ currentId: null }) },
            { history: api },
        );
        render(
            <StrictMode>
                <AskDevChat source={host} />
            </StrictMode>,
        );
        expect(api.load).toHaveBeenCalledOnce();

        host.publish({ ...snapshotOf(), history: historySnapshot({ currentId: "thread_a" }) });

        expect(api.load).toHaveBeenCalledTimes(2);
    });

    it("reads again on a return to an earlier conversation", () => {
        const { api, host } = setup({ currentId: "thread_a" });
        expect(api.load).toHaveBeenCalledOnce();

        host.publish({ ...snapshotOf(), history: historySnapshot({ currentId: "thread_b" }) });
        expect(api.load).toHaveBeenCalledTimes(2);

        host.publish({ ...snapshotOf(), history: historySnapshot({ currentId: "thread_a" }) });
        expect(api.load).toHaveBeenCalledTimes(3);
    });

    it("reads nothing until the host publishes a history, then reads once", () => {
        const api = fakeHistory();
        const host = hostSource(snapshotOf(), { history: api });
        render(<AskDevChat source={host} />);
        expect(api.load).not.toHaveBeenCalled();
        expect(screen.getByTestId("ask-dev-history-loading")).toBeInTheDocument();
        host.publish({ ...snapshotOf(), history: historySnapshot() });
        expect(api.load).toHaveBeenCalledOnce();
    });

    it("does not read again when the list moves from the rail to the column and back", async () => {
        const user = userEvent.setup();
        const { api } = setup();
        await user.click(screen.getByTestId("ask-dev-history-toggle"));
        await user.click(screen.getByTestId("ask-dev-history-toggle"));
        expect(api.load).toHaveBeenCalledOnce();
    });

    it("draws nothing and reads nothing from a snapshot's history when the source offers none", () => {
        const host = hostSource({ ...snapshotOf(), history: historySnapshot({ rows: [rowA] }) });
        render(<AskDevChat source={host} />);
        expect(screen.queryByTestId("ask-dev-history")).toBeNull();
        expect(screen.queryByTestId("ask-dev-history-toggle")).toBeNull();
    });
});

describe("History: on the desktop rail", () => {
    it("sits under This conversation, and that section keeps its words", () => {
        setup({}, snapshotOf(userTurn(0, "Is Ask Dev ready?")));
        const rail = screen.getByRole("complementary", { name: "This conversation" });
        const section = within(rail).getByTestId("ask-dev-history");
        const heading = within(rail).getByRole("heading", { name: "This conversation" });
        expect(
            heading.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(within(rail).getByRole("button", { name: "New question" })).toBeInTheDocument();
        expect(within(rail).getByText(/Is Ask Dev ready/u)).toBeInTheDocument();
    });

    it("has no New conversation button of its own: rail__new is there", () => {
        setup();
        expect(screen.queryByTestId("ask-dev-history-new")).toBeNull();
    });
});

/**
 * CHAOS-12429: a host's rule is that opening its narrow panel sends nothing, so the list is read
 * only when it is on screen. `ask-dev.css` hides the rail under 860px of the frame; this sheet does
 * the same here, because the test document does not load `ask-dev.css`.
 */
describe("History: read only when it is on screen", () => {
    let sheet: HTMLStyleElement;
    let resized: (() => void)[];
    const resize = () => {
        act(() => {
            for (const callback of resized) callback();
        });
    };

    beforeEach(() => {
        sheet = document.createElement("style");
        sheet.textContent = ".ask__rail--left { display: none; }";
        document.head.append(sheet);
        resized = [];
        vi.stubGlobal(
            "ResizeObserver",
            class {
                constructor(callback: () => void) {
                    resized.push(callback);
                }
                observe() {}
                disconnect() {
                    resized = [];
                }
            },
        );
    });

    afterEach(() => {
        sheet.remove();
        vi.unstubAllGlobals();
    });

    it("reads nothing on mount, or for a new conversation, while the rail is hidden", () => {
        const { api, host } = setup({ currentId: null });
        expect(api.load).not.toHaveBeenCalled();
        host.publish({ ...snapshotOf(), history: historySnapshot({ currentId: THREAD_A }) });
        expect(api.load).not.toHaveBeenCalled();
    });

    it("reads when the toggle opens the list, and again on the next open", async () => {
        const user = userEvent.setup();
        const { api } = setup();
        await user.click(screen.getByTestId("ask-dev-history-toggle"));
        expect(api.load).toHaveBeenCalledOnce();
        await user.click(screen.getByTestId("ask-dev-history-toggle"));
        expect(api.load).toHaveBeenCalledOnce();
        await user.click(screen.getByTestId("ask-dev-history-toggle"));
        expect(api.load).toHaveBeenCalledTimes(2);
    });

    it("reads once for an open under Strict Mode", async () => {
        const user = userEvent.setup();
        const api = fakeHistory();
        const host = hostSource({ ...snapshotOf(), history: historySnapshot() }, { history: api });
        render(
            <StrictMode>
                <AskDevChat source={host} />
            </StrictMode>,
        );
        await user.click(screen.getByTestId("ask-dev-history-toggle"));
        expect(api.load).toHaveBeenCalledOnce();
    });

    it("reads once when another conversation remounts the surface with the list open", async () => {
        const user = userEvent.setup();
        const api = fakeHistory();
        const host = hostSource(
            { ...snapshotOf(), conversationKey: 1, history: historySnapshot() },
            { history: api },
        );
        render(
            <StrictMode>
                <AskDevChat source={host} />
            </StrictMode>,
        );
        await user.click(screen.getByTestId("ask-dev-history-toggle"));
        expect(api.load).toHaveBeenCalledOnce();
        host.publish({ ...snapshotOf(), conversationKey: 2, history: historySnapshot() });
        expect(api.load).toHaveBeenCalledTimes(2);
    });

    it("reads for a new conversation while the open list shows", async () => {
        const user = userEvent.setup();
        const { api, host } = setup({ currentId: null });
        await user.click(screen.getByTestId("ask-dev-history-toggle"));
        expect(api.load).toHaveBeenCalledOnce();
        host.publish({ ...snapshotOf(), history: historySnapshot({ currentId: THREAD_A }) });
        expect(api.load).toHaveBeenCalledTimes(2);
    });

    it("reads when the frame grows until the rail shows, and not on a resize that keeps it hidden", () => {
        const { api } = setup();
        resize();
        expect(api.load).not.toHaveBeenCalled();
        sheet.remove();
        resize();
        expect(api.load).toHaveBeenCalledOnce();
        resize();
        expect(api.load).toHaveBeenCalledOnce();
    });

    it("waits for the host's first history even when the list opens first", async () => {
        const user = userEvent.setup();
        const api = fakeHistory();
        const host = hostSource(snapshotOf(), { history: api });
        render(<AskDevChat source={host} />);
        await user.click(screen.getByTestId("ask-dev-history-toggle"));
        expect(api.load).not.toHaveBeenCalled();
        host.publish({ ...snapshotOf(), history: historySnapshot() });
        expect(api.load).toHaveBeenCalledOnce();
    });
});

describe("History: under the rail's width", () => {
    const chatColumn = () => screen.getByRole("region", { name: "Ask Dev conversation" });

    it("offers the toggle only with a history source", () => {
        setup();
        const toggle = screen.getByTestId("ask-dev-history-toggle");
        expect(toggle).toHaveTextContent("History");
        expect(toggle).toHaveAttribute("aria-pressed", "false");
    });

    it("swaps the chat column for the one list, with its way back", async () => {
        const user = userEvent.setup();
        setup({ rows: [rowA] });
        const box = screen.getByRole("textbox", { name: "Ask a question" });
        await user.type(box, "A draft");

        await user.click(screen.getByTestId("ask-dev-history-toggle"));

        expect(screen.getAllByTestId("ask-dev-history")).toHaveLength(1);
        expect(within(chatColumn()).getByTestId("ask-dev-history-list")).toBeInTheDocument();
        const toggle = screen.getByTestId("ask-dev-history-toggle");
        expect(toggle).toHaveTextContent("Back to conversation");
        expect(toggle).toHaveAttribute("aria-pressed", "true");
        expect(screen.queryByRole("log", { name: "Conversation" })).toBeNull();
        expect(screen.queryByRole("textbox", { name: "Ask a question" })).toBeNull();

        await user.click(toggle);

        expect(within(chatColumn()).queryByTestId("ask-dev-history")).toBeNull();
        expect(screen.getByTestId("ask-dev-history-toggle")).toHaveTextContent("History");
        expect(screen.getByRole("log", { name: "Conversation" })).toBeInTheDocument();
        expect(screen.getByRole("textbox", { name: "Ask a question" })).toHaveValue("A draft");
    });

    it("returns to the conversation when a row is opened", async () => {
        const user = userEvent.setup();
        const { api } = setup({ rows: [rowA] });
        await user.click(screen.getByTestId("ask-dev-history-toggle"));
        await user.click(within(chatColumn()).getByTestId("ask-dev-history-open"));
        expect(api.open).toHaveBeenCalledExactlyOnceWith(THREAD_A);
        expect(screen.getByRole("log", { name: "Conversation" })).toBeInTheDocument();
        expect(within(chatColumn()).queryByTestId("ask-dev-history")).toBeNull();
    });

    it("shows New conversation in the column, which starts one and returns", async () => {
        const user = userEvent.setup();
        const { host } = setup({ rows: [rowA] });
        await user.click(screen.getByTestId("ask-dev-history-toggle"));
        const start = within(chatColumn()).getByTestId("ask-dev-history-new");
        expect(start).toHaveTextContent("New conversation");
        await user.click(start);
        expect(host.newConversation).toHaveBeenCalledOnce();
        expect(screen.getByRole("log", { name: "Conversation" })).toBeInTheDocument();
    });

    it("stays on the list when the shown conversation goes away under it", async () => {
        const user = userEvent.setup();
        const { host } = setup({ rows: [rowA], currentId: THREAD_A });
        host.publish({
            ...snapshotOf(),
            conversationKey: 1,
            history: historySnapshot({ rows: [rowA], currentId: THREAD_A }),
        });
        await user.click(screen.getByTestId("ask-dev-history-toggle"));
        host.publish({
            ...snapshotOf(),
            conversationKey: 2,
            history: historySnapshot({ currentId: null }),
        });
        expect(within(chatColumn()).getByTestId("ask-dev-history")).toBeInTheDocument();
        expect(screen.getByTestId("ask-dev-history-toggle")).toHaveAttribute(
            "aria-pressed",
            "true",
        );
    });

    it("shows the conversation again for another source", async () => {
        const user = userEvent.setup();
        const history = { history: fakeHistory() };
        const first = hostSource({ ...snapshotOf(), history: historySnapshot() }, history);
        const view = render(<AskDevChat source={first} />);
        await user.click(screen.getByTestId("ask-dev-history-toggle"));
        const second = hostSource({ ...snapshotOf(), history: historySnapshot() }, history);
        view.rerender(<AskDevChat source={second} />);
        expect(screen.getByRole("log", { name: "Conversation" })).toBeInTheDocument();
    });

    it("the emptied conversation column is measured when it shows again", async () => {
        const user = userEvent.setup();
        const { host } = setup();
        await user.click(screen.getByTestId("ask-dev-history-toggle"));
        const box = document.querySelector<HTMLTextAreaElement>("#chat-question")!;
        // A hidden element measures 0: the remount must not freeze the composer at height 0.
        expect(box.scrollHeight).toBe(0);
        host.publish({ ...snapshotOf(), conversationKey: 9, history: historySnapshot() });
        const remounted = document.querySelector<HTMLTextAreaElement>("#chat-question")!;
        expect(remounted.style.height).not.toBe("0px");
    });

    it("keeps the bar while the list is open, so a wider container has its way back", async () => {
        const user = userEvent.setup();
        setup();
        const bar = screen.getByTestId("ask-dev-history-toggle").parentElement!;
        expect(bar).not.toHaveClass("chat__narrow-bar--open");
        await user.click(screen.getByTestId("ask-dev-history-toggle"));
        expect(bar).toHaveClass("chat__narrow-bar--open");
    });

    it("follows the conversation again when it shows again", async () => {
        const user = userEvent.setup();
        setup();
        const log = screen.getByRole("log", { name: "Conversation" });
        let written = 0;
        Object.defineProperty(log, "scrollHeight", { configurable: true, value: 120 });
        Object.defineProperty(log, "scrollTop", {
            configurable: true,
            get: () => written,
            set: (value: number) => {
                written = value;
            },
        });
        await user.click(screen.getByTestId("ask-dev-history-toggle"));
        written = 0;
        await user.click(screen.getByTestId("ask-dev-history-toggle"));
        expect(written).toBe(120);
    });

    it("hides the timeline by the hidden attribute in the stylesheet too", () => {
        const css = readFileSync(path.resolve("src/app/ask-dev.css"), "utf8");
        expect(css).toMatch(/\.chat__timeline-wrap\[hidden\]\s*\{\s*display:\s*none/u);
        expect(css).toMatch(/\.chat__narrow-bar--open\s*\{\s*display:\s*flex/u);
    });

    it("pins the toggle to the width the left rail goes away at, in the stylesheet", () => {
        const css = readFileSync(path.resolve("src/app/ask-dev.css"), "utf8");
        const base = css.indexOf(".chat__narrow-bar {");
        const query = css.indexOf("@container ask-dev (max-width: 860px)", base);
        expect(base, "the base rule").toBeGreaterThan(-1);
        expect(query, "a query after the base rule, so it wins").toBeGreaterThan(-1);
        expect(css.slice(base, css.indexOf("}", base))).toMatch(/display:\s*none/u);
        const block = css.slice(query, css.indexOf("}", css.indexOf(".chat__narrow-bar", query)));
        expect(block).toMatch(/\.chat__narrow-bar\s*\{[^}]*display:\s*flex/u);
    });
});
