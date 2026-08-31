import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ClarificationPopup } from "@/components/chat/ClarificationPopup";
import type { PopupPage } from "@/lib/clarification-popup";

/**
 * Codex round 1 (chaos-4671-20260831T102053.md) findings, each pinned
 * red-first against the pre-fix shape (verified in this lane's own
 * mutation-proof pass — see the PR's proof ledger) and green here.
 */

const SINGLE_PAGE_ONE_OPTION: PopupPage = {
    key: "expected_kind",
    title: "Which kind of thing is this about?",
    selectMode: "multi",
    options: [
        {
            id: "opt_1",
            label: "a pull request",
            displayText: "a pull request",
            selected: false,
            source: {
                kind: "structure",
                member: "expected_kind",
                receipt: { result_id: "result_1", receipt_id: "kindr_1" },
            },
        },
    ],
};

function renderPopup(
    pages: readonly PopupPage[],
    overrides: Partial<Parameters<typeof ClarificationPopup>[0]> = {},
) {
    const onSelect = vi.fn();
    const onComplete = vi.fn();
    const onDismiss = vi.fn();
    const onFreeText = vi.fn();
    render(
        <ClarificationPopup
            onComplete={onComplete}
            onDismiss={onDismiss}
            onFreeText={onFreeText}
            onSelect={onSelect}
            pages={pages}
            pending={false}
            {...overrides}
        />,
    );
    return { onSelect, onComplete, onDismiss, onFreeText };
}

describe("finding 1: an empty last multi-select page must not fire a receipt-less re-ask", () => {
    it('"Continue without selecting" on the only (last) page dismisses, never completes', async () => {
        const user = userEvent.setup();
        const { onComplete, onDismiss } = renderPopup([SINGLE_PAGE_ONE_OPTION]);

        await user.click(screen.getByRole("button", { name: /^Continue/ }));

        expect(onComplete).not.toHaveBeenCalled();
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("still completes when something WAS picked on an earlier page", async () => {
        const user = userEvent.setup();
        const pageWithPriorPick: PopupPage = {
            ...SINGLE_PAGE_ONE_OPTION,
            key: "subject_candidate",
            title: "Did you mean one of these?",
            options: [{ ...SINGLE_PAGE_ONE_OPTION.options[0]!, selected: true }],
        };
        const { onComplete, onDismiss } = renderPopup([pageWithPriorPick]);

        await user.click(screen.getByRole("button", { name: /^Continue/ }));

        expect(onDismiss).not.toHaveBeenCalled();
        expect(onComplete).toHaveBeenCalledTimes(1);
    });
});

describe("finding 2: hotkeys must not hijack a focused free-text input or native button", () => {
    it("typing a digit into the free-text row types the digit, not an option pick", async () => {
        const user = userEvent.setup();
        const { onSelect, onComplete } = renderPopup([SINGLE_PAGE_ONE_OPTION]);

        const input = screen.getByLabelText("Something else");
        await user.click(input);
        await user.keyboard("1");

        expect(input).toHaveValue("1");
        expect(onSelect).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
    });

    it("pressing Enter while the free-text input is focused submits the free text, not an option pick", async () => {
        const user = userEvent.setup();
        const { onSelect, onFreeText } = renderPopup([SINGLE_PAGE_ONE_OPTION]);

        const input = screen.getByLabelText("Something else");
        await user.click(input);
        await user.keyboard("a free-text answer{Enter}");

        expect(onFreeText).toHaveBeenCalledWith("a free-text answer");
        expect(onSelect).not.toHaveBeenCalled();
    });

    it("pressing Enter while Dismiss is focused dismisses, not selects option 1", async () => {
        const user = userEvent.setup();
        const { onSelect, onDismiss } = renderPopup([SINGLE_PAGE_ONE_OPTION]);

        screen.getByRole("button", { name: "Dismiss" }).focus();
        await user.keyboard("{Enter}");

        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
    });
});

describe("finding 3: a phrased option still shows its structural value", () => {
    const PHRASED_PAGE: PopupPage = {
        key: "expected_kind",
        title: "Which kind of thing is this about?",
        selectMode: "multi",
        options: [
            {
                id: "opt_1",
                label: "pull_request",
                displayText: "How a pull request went",
                selected: false,
                source: {
                    kind: "structure",
                    member: "expected_kind",
                    receipt: { result_id: "result_1", receipt_id: "kindr_1" },
                },
            },
        ],
    };

    it("shows the model phrasing AND the structural label, never phrasing alone", () => {
        renderPopup([PHRASED_PAGE]);

        expect(screen.getByText("How a pull request went")).toBeInTheDocument();
        expect(screen.getByText("structural: pull_request")).toBeInTheDocument();
    });

    it("shows no structural line when there is no phrasing (displayText === label)", () => {
        renderPopup([SINGLE_PAGE_ONE_OPTION]);

        expect(screen.queryByText(/^structural:/)).toBeNull();
    });
});
