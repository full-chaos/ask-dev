import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AskDevChat } from "@/components/chat/AskDevChat";
import type { ChatContextRef, ChatSource, ScopeKind } from "@/render/source";
import { hostSource, snapshotOf } from "@/test/fixtures/host-source";

/**
 * CHAOS-12387: the page context, as chips above the composer. The cases follow web's
 * `AskDevContextChips` and its test. The hints a question carries stay in the source: the render
 * only draws what the snapshot lists and calls `remove`.
 */

const TEAM: ChatContextRef = { kind: "team", id: "team:platform", label: "Platform" };
const REPO: ChatContextRef = { kind: "repository", id: "repository:r1", label: "dev-health-ops" };

function setup(refs?: readonly ChatContextRef[]) {
    const remove = vi.fn<NonNullable<ChatSource["pageContext"]>["remove"]>();
    const host = hostSource(
        refs === undefined ? snapshotOf() : { ...snapshotOf(), pageContext: refs },
        { pageContext: { remove } },
    );
    render(<AskDevChat source={host} />);
    return { host, remove };
}

describe("page-context chips", () => {
    it("names the group and says what the chips do", () => {
        setup([TEAM]);
        const group = screen.getByRole("group", { name: "Context from this page" });
        expect(group).toHaveAttribute("data-testid", "ask-dev-context");
        expect(group).toHaveTextContent(
            "Context from this page · Sent as hints with your next question. Remove any you do not want.",
        );
    });

    it("draws each ref in order, with its kind", () => {
        setup([TEAM, REPO]);
        const chips = screen.getAllByTestId("ask-dev-context-chip");
        expect(chips.map((chip) => chip.textContent)).toEqual([
            "Team:Platform",
            "Repository:dev-health-ops",
        ]);
        expect(chips.map((chip) => chip.getAttribute("data-kind"))).toEqual(["team", "repository"]);
    });

    it.each<[ScopeKind, string]>([
        ["organization", "Organization"],
        ["team", "Team"],
        ["project", "Project"],
        ["repository", "Repository"],
        ["work_item", "Work item"],
        ["pull_request", "Pull request"],
    ])("names the kind %s, on the chip and on its remove button", (kind, label) => {
        setup([{ kind, id: "subject", label: "Atlas" }]);
        expect(screen.getByTestId("ask-dev-context-chip")).toHaveTextContent(`${label}:Atlas`);
        expect(
            within(screen.getByTestId("ask-dev-context-chip")).getByTestId(
                "ask-dev-context-remove",
            ),
        ).toHaveAccessibleName(`Remove ${label} Atlas`);
    });

    it("removes through the source, once, with the same ref", async () => {
        const user = userEvent.setup();
        const { remove } = setup([TEAM, REPO]);
        await user.click(screen.getByRole("button", { name: "Remove Repository dev-health-ops" }));
        expect(remove).toHaveBeenCalledExactlyOnceWith(REPO);
    });

    it("draws what the host publishes next: the render keeps no removal of its own", async () => {
        const user = userEvent.setup();
        const { host, remove } = setup([TEAM, REPO]);
        await user.click(screen.getByRole("button", { name: "Remove Team Platform" }));
        expect(remove).toHaveBeenCalledOnce();
        expect(screen.getAllByTestId("ask-dev-context-chip")).toHaveLength(2);
        host.publish({ ...snapshotOf(), pageContext: [REPO] });
        expect(screen.getAllByTestId("ask-dev-context-chip")).toHaveLength(1);
    });

    it("draws a label as inert text", () => {
        const hostile = '<img src=x onerror="alert(1)">';
        setup([{ ...TEAM, label: hostile }]);
        const chip = screen.getByTestId("ask-dev-context-chip");
        expect(chip).toHaveTextContent(hostile);
        expect(chip.querySelector("img")).toBeNull();
    });

    it("sits above the composer, in the composer bar", () => {
        setup([TEAM]);
        const group = screen.getByTestId("ask-dev-context");
        const composer = document.querySelector("form.chat-composer")!;
        expect(group.closest(".chat__composer-bar")).toBe(composer.closest(".chat__composer-bar"));
        expect(
            group.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it("draws nothing for an empty list", () => {
        setup([]);
        expect(screen.queryByTestId("ask-dev-context")).toBeNull();
    });

    it("draws nothing with no list", () => {
        setup();
        expect(screen.queryByTestId("ask-dev-context")).toBeNull();
    });

    it("draws nothing when the source cannot remove: the note could not hold", () => {
        render(<AskDevChat source={hostSource({ ...snapshotOf(), pageContext: [TEAM] })} />);
        expect(screen.queryByTestId("ask-dev-context")).toBeNull();
    });

    it("goes away with the composer in the history view", async () => {
        const user = userEvent.setup();
        const host = hostSource(
            { ...snapshotOf(), pageContext: [TEAM] },
            {
                pageContext: { remove: vi.fn() },
                history: { load: vi.fn(), loadMore: vi.fn(), open: vi.fn(), remove: vi.fn() },
            },
        );
        render(<AskDevChat source={host} />);
        await user.click(screen.getByTestId("ask-dev-history-toggle"));
        expect(screen.queryByRole("group", { name: "Context from this page" })).toBeNull();
    });
});
