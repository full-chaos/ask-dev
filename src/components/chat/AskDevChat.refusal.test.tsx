import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AskDevChat } from "@/components/chat/AskDevChat";
import type { WorkbenchFailure } from "@/lib/acr/errors";
import { validateContract } from "@/lib/acr/validate";
import type { ChatTurn } from "@/render/source";
import { assistantTurn, hostSource, snapshotOf, userTurn } from "@/test/fixtures/host-source";
import {
    REFUSAL_BYTES_EVIDENCE_WINDOW,
    REFUSAL_ITEMS_NO_AXIS,
    REFUSAL_ITEMS_RESULT_COUNT,
} from "@/test/fixtures/budget-refusal";

/**
 * CHAOS-12406: a budget refusal through the seam, the way web's adapter publishes one: a `failed`
 * outcome that carries the 413's fields, with `rootQuestion` set. A raw code never reaches a user.
 */
const ROOT = "Which teams are struggling, and why?";

function hostFailure(
    body:
        | typeof REFUSAL_BYTES_EVIDENCE_WINDOW
        | typeof REFUSAL_ITEMS_RESULT_COUNT
        | typeof REFUSAL_ITEMS_NO_AXIS,
): WorkbenchFailure {
    const { details } = body.error;
    return {
        code: "acr_rejected_request",
        // A refusal's words are the render's: this must not reach the page.
        message: "A message the host wrote.",
        upstreamCode: body.error.code,
        upstreamRequestId: body.request_id,
        retryable: body.error.retryable,
        overrun: details.overrun,
        measuredItems: details.measured_items,
        maxItems: details.max_items,
        measuredBytes: details.measured_bytes,
        maxBytes: details.max_serialized_bytes,
        ...("nothing_left_to_cut" in details ? { nothingLeftToCut: true } : {}),
        ...("narrower_continuation" in details
            ? { narrowerContinuation: details.narrower_continuation }
            : {}),
    };
}

function renderRefusal(failure: WorkbenchFailure, root: string | undefined = ROOT) {
    const source = hostSource(
        snapshotOf(userTurn(0, root ?? "a question"), {
            ...assistantTurn(1, { kind: "failed", failure }, root),
            retryQuestion: undefined,
        } as ChatTurn),
    );
    render(<AskDevChat source={source} />);
    return source;
}

/** The words a user can reach: the text, and every attribute a browser shows. */
function reachable(element: HTMLElement): string {
    const attributes = [element, ...element.querySelectorAll("*")].flatMap((node) =>
        [...node.attributes].filter(
            (attribute) => !attribute.name.startsWith("data-") && attribute.name !== "class",
        ),
    );
    return [element.textContent, ...attributes.map((attribute) => attribute.value)].join("\n");
}

describe("the captures", () => {
    it.each([
        ["bytes", REFUSAL_BYTES_EVIDENCE_WINDOW],
        ["items", REFUSAL_ITEMS_RESULT_COUNT],
        ["no axis", REFUSAL_ITEMS_NO_AXIS],
    ])("%s holds against the pinned error.v1 schema", (_name, body) => {
        expect(validateContract("error.v1.schema.json", body)).toEqual({ valid: true, errors: [] });
    });
});

describe("a budget refusal through a host source", () => {
    it("headed in web's words, under web's test ids", () => {
        renderRefusal(hostFailure(REFUSAL_ITEMS_RESULT_COUNT));

        const refusal = screen.getByTestId("ask-dev-refusal");
        expect(refusal).toHaveAttribute("data-kind", "budget");
        expect(refusal).toHaveAttribute("data-axis", "result_count");
        expect(
            screen.getByRole("alert", { name: "No answer: too large to send" }),
        ).toBeInTheDocument();
        expect(
            within(refusal).getByText("The answer to this question was too large to send."),
        ).toBeInTheDocument();
    });

    it("says the overrun in items", () => {
        renderRefusal(hostFailure(REFUSAL_ITEMS_RESULT_COUNT));

        expect(screen.getByTestId("ask-dev-refusal-overrun").textContent).toBe(
            "It held 41 items; an answer can hold 30.",
        );
    });

    it("says the overrun in KB, and that nothing more could be cut", () => {
        renderRefusal(hostFailure(REFUSAL_BYTES_EVIDENCE_WINDOW));

        expect(screen.getByTestId("ask-dev-refusal-overrun").textContent).toBe(
            "It was 295 KB; an answer can be 256 KB. Nothing more could be cut from it.",
        );
    });

    it("leaves the host's own message off a budget refusal", () => {
        renderRefusal(hostFailure(REFUSAL_ITEMS_RESULT_COUNT));

        expect(screen.queryByText("A message the host wrote.")).toBeNull();
    });

    it.each([
        ["measured bytes", { overrun: "bytes", maxBytes: 10 }],
        ["a byte ceiling", { overrun: "bytes", measuredBytes: 10 }],
        ["measured items", { overrun: "items", maxItems: 10 }],
        ["an item ceiling", { overrun: "items", measuredItems: 10 }],
        ["an overrun it names", { overrun: "fits", measuredItems: 10, maxItems: 5 }],
    ])("says no overrun without %s", (_name, numbers) => {
        renderRefusal({
            code: "acr_rejected_request",
            httpStatus: 413,
            message: "x",
            retryable: false,
            ...numbers,
        });

        expect(screen.queryByTestId("ask-dev-refusal-overrun")).toBeNull();
    });

    it("says nothing of cutting when the host does not say so", () => {
        renderRefusal(hostFailure(REFUSAL_ITEMS_RESULT_COUNT));

        expect(screen.queryByText(/Nothing more could be cut/)).toBeNull();
    });

    it("says the same question gives the same result, when it is not retryable", () => {
        renderRefusal(hostFailure(REFUSAL_ITEMS_RESULT_COUNT));

        expect(
            screen.getByText("Asking the same question again is likely to give the same result."),
        ).toBeInTheDocument();
    });

    it("says no such thing of a retryable refusal", () => {
        renderRefusal({ ...hostFailure(REFUSAL_ITEMS_RESULT_COUNT), retryable: true });

        expect(screen.queryByText(/same question again/)).toBeNull();
    });

    it.each([
        ["evidence_window", "Ask about a shorter time period."],
        ["result_count", "Ask for fewer results, for example the top 10."],
        ["scope_anchor", "Ask about a narrower scope, for example one project or one repository."],
        ["group_selection", "Ask about fewer groups."],
        ["comparison_pair", "Compare fewer subjects at a time."],
    ] as const)("words the %s axis in web's sentence", (axis, words) => {
        renderRefusal({
            ...hostFailure(REFUSAL_ITEMS_RESULT_COUNT),
            narrowerContinuation: { axis },
        });

        expect(screen.getByTestId("ask-dev-refusal-narrower").textContent).toBe(words);
    });

    it("says no narrower form exists when ACR named no axis, and offers no re-ask", () => {
        renderRefusal(hostFailure(REFUSAL_ITEMS_NO_AXIS));

        expect(screen.getByTestId("ask-dev-refusal")).toHaveAttribute("data-axis", "none");
        expect(screen.getByTestId("ask-dev-refusal-narrower").textContent).toBe(
            "No narrower form of this question can be suggested.",
        );
        expect(screen.queryByTestId("ask-dev-refusal-reask")).toBeNull();
    });

    it("the re-ask goes through the composer with ask-dev's clause, under the chain's root", async () => {
        const user = userEvent.setup();
        const source = renderRefusal(hostFailure(REFUSAL_ITEMS_RESULT_COUNT));

        await user.click(screen.getByTestId("ask-dev-refusal-reask"));

        await waitFor(() => expect(source.ask).toHaveBeenCalledTimes(1));
        expect(source.ask.mock.calls[0]?.[0]).toBe(
            "Which teams are struggling, and why, top 5 only?",
        );
        expect(source.ask.mock.calls[0]?.[1]?.narrowingRoot).toBe(ROOT);
        expect(source.retry).not.toHaveBeenCalled();
    });

    it("an earlier refusal keeps its words and offers no re-ask", () => {
        const source = hostSource(
            snapshotOf(
                userTurn(0, ROOT),
                assistantTurn(
                    1,
                    { kind: "failed", failure: hostFailure(REFUSAL_ITEMS_RESULT_COUNT) },
                    ROOT,
                ),
                userTurn(2, "Something else"),
                assistantTurn(3, {
                    kind: "failed",
                    failure: { code: "acr_unreachable", message: "Gone.", retryable: false },
                }),
            ),
        );
        render(<AskDevChat source={source} />);

        expect(screen.getByTestId("ask-dev-refusal-overrun")).toBeInTheDocument();
        expect(screen.queryByTestId("ask-dev-refusal-reask")).toBeNull();
    });

    it("each failed turn is named by its own heading", () => {
        const source = hostSource(
            snapshotOf(
                userTurn(0, "First"),
                assistantTurn(1, {
                    kind: "failed",
                    failure: { code: "acr_unreachable", message: "Gone.", retryable: false },
                }),
                userTurn(2, ROOT),
                assistantTurn(
                    3,
                    { kind: "failed", failure: hostFailure(REFUSAL_ITEMS_RESULT_COUNT) },
                    ROOT,
                ),
            ),
        );
        render(<AskDevChat source={source} />);

        expect(screen.getByRole("alert", { name: "No answer" })).toBeInTheDocument();
        expect(
            screen.getByRole("alert", { name: "No answer: too large to send" }),
        ).toBeInTheDocument();
    });

    it.each([
        ["the upstream code alone", { upstreamCode: "budget_refusal" }],
        ["the 413 alone", { httpStatus: 413 }],
    ])("reads as a budget refusal on %s", (_name, marker) => {
        renderRefusal({ code: "acr_rejected_request", message: "x", retryable: false, ...marker });

        expect(screen.getByTestId("ask-dev-refusal")).toHaveAttribute("data-kind", "budget");
        expect(
            screen.getByRole("alert", { name: "No answer: too large to send" }),
        ).toBeInTheDocument();
    });

    it("any other failure keeps its own words and claims nothing about size", () => {
        renderRefusal({
            code: "acr_rejected_request",
            httpStatus: 400,
            upstreamCode: "invalid_request",
            message: "Ask Dev rejected the investigation request.",
            retryable: false,
        });

        expect(screen.getByTestId("ask-dev-refusal")).toHaveAttribute("data-kind", "other");
        expect(screen.getByRole("alert", { name: "No answer" })).toBeInTheDocument();
        expect(screen.getByText("Ask Dev rejected the investigation request.")).toBeInTheDocument();
        expect(screen.queryByTestId("ask-dev-refusal-narrower")).toBeNull();
    });
});

describe("no raw code reaches a user, on any failure", () => {
    const RAW = /acr_[a-z_]+|HTTP \d|budget_refusal|not retryable|· retryable|\bACR\b/u;

    it.each([
        [
            "a budget refusal",
            {
                ...hostFailure(REFUSAL_BYTES_EVIDENCE_WINDOW),
                httpStatus: 413,
            },
        ],
        [
            "an outage",
            {
                code: "acr_runtime_unavailable",
                httpStatus: 503,
                upstreamCode: "upstream_unavailable",
                upstreamRequestId: "req_1",
                message: "Something it needs is unavailable.",
                retryable: true,
            },
        ],
        ["a local failure", { code: "acr_unreachable", message: "Gone.", retryable: true }],
    ] satisfies readonly (readonly [string, WorkbenchFailure])[])("%s", (_name, failure) => {
        renderRefusal(failure);

        expect(reachable(screen.getByRole("alert"))).not.toMatch(RAW);
    });

    it("keeps the failure's class for a test, in data attributes only", () => {
        renderRefusal({
            code: "acr_unreachable",
            message: "Gone.",
            retryable: true,
        });

        const alert = screen.getByRole("alert");
        expect(alert).toHaveAttribute("data-failure-code", "acr_unreachable");
        expect(alert).toHaveAttribute("data-retryable", "true");
    });

    it("the request id stays as a Reference line in web's word", () => {
        renderRefusal({
            code: "acr_investigation_failed",
            httpStatus: 500,
            upstreamRequestId: "req_abc123",
            message: "It failed.",
            retryable: true,
        });

        const line = screen.getByTestId("failure-reference");
        expect(line.textContent).toBe("Reference: req_abc123");
        expect(within(line).getByText("req_abc123").tagName).toBe("CODE");
    });

    it("says no reference when there is no request id", () => {
        renderRefusal({ code: "acr_unreachable", message: "Gone.", retryable: true });

        expect(screen.queryByTestId("failure-reference")).toBeNull();
    });

    it("keeps a validator's raw text off the page", () => {
        renderRefusal({
            code: "acr_contract_violation",
            message: "Ask Dev returned a result that does not meet the required format.",
            details: ["/coverage/sources/0 must have required property 'state'"],
            retryable: false,
        });

        expect(reachable(screen.getByRole("alert"))).not.toContain("/coverage/sources/0");
    });
});
