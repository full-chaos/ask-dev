import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AskDevChat } from "@/components/chat/AskDevChat";
import type { InvestigationResult } from "@/lib/contracts";
import type { ChatSource } from "@/render/source";
import { createStandaloneSource } from "@/render/standalone-source";
import { investigateFromGlobalFetch } from "@/test/fixtures/investigate-fake";
import { mockScenarios } from "@/test/fixtures/investigations";

/**
 * CHAOS-12146 (lead ruling, option A). Two picks on ONE popup axis:
 * - a host's popup (any source without `multiPick`) is single-select per axis: the second tap
 *   replaces the first, so one Continue sends ONE request. acr refuses two receipts of one
 *   structure member in one request (`confirmation_conflict`), and a host runs a batch in
 *   sequence, so a fan-out would send its second request after a newer result;
 * - the standalone Workbench (`multiPick`) keeps the CHAOS-4343 fan-out, one request per pick,
 *   only while no follow-up request carries a receipt bound to an older result.
 */

const QUESTION_RESULT = "result_two_0001";

function twoCandidates(): InvestigationResult {
    const base = mockScenarios().find((entry) => entry.id === "clarification")!.result;
    return {
        ...structuredClone(base),
        result_id: QUESTION_RESULT,
        structure_needs: {
            missing: ["subject_candidate"],
            candidate_options: [
                {
                    receipt_id: "candr_container_0001",
                    option_id: "candidate_container",
                    label: "Container",
                    kind: "project",
                    canonical_id: "project:container",
                    offer_source: "engine",
                },
                {
                    receipt_id: "candr_repo_0001",
                    option_id: "candidate_repo",
                    label: "Repo",
                    kind: "repository",
                    canonical_id: "repository:repo",
                    offer_source: "engine",
                },
            ],
        },
    };
}

function answered(n: number): InvestigationResult {
    const base = mockScenarios().find((entry) => entry.id === "complete")?.result;
    return {
        ...structuredClone(base ?? mockScenarios()[0]!.result),
        result_id: `result_answer_000${String(n)}`,
        status: "complete",
    };
}

type Sent = { readonly body: Record<string, unknown>; readonly newestServed: string | undefined };

/** Each request, with the newest result the page had been served when it went out. */
const sent: Sent[] = [];

beforeEach(() => {
    sent.length = 0;
    let newestServed: string | undefined;
    vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init: { body: string }) => {
            const body = JSON.parse(init.body) as Record<string, unknown>;
            sent.push({ body, newestServed });
            const result = sent.length === 1 ? twoCandidates() : answered(sent.length);
            // A real answer takes time: later requests of a batch may go out before it lands.
            return new Promise((resolve) =>
                setTimeout(() => {
                    newestServed = result.result_id;
                    resolve({ json: () => Promise.resolve({ result }) });
                }, 20),
            );
        }),
    );
    Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
    vi.unstubAllGlobals();
});

/** Two structure-candidate taps, Continue, one subject tap, Continue: one confirm. */
async function pickTwoOnOneAxis(source: ChatSource) {
    const user = userEvent.setup();
    render(<AskDevChat source={source} />);
    await user.type(screen.getByPlaceholderText(/Ask about a project/), "Is Atlas on track?");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Did you mean one of these?");
    await user.click(screen.getByRole("button", { name: /Container/ }));
    await user.click(screen.getByRole("button", { name: /Repo/ }));
    await user.click(screen.getByRole("button", { name: /^Continue/ }));
    await waitFor(() =>
        expect(document.querySelector(".clarification-popup")?.textContent).toMatch(/Atlas/),
    );
    await user.click(
        within(document.querySelector<HTMLElement>(".clarification-popup")!).getAllByRole(
            "button",
            { name: /Atlas/ },
        )[0]!,
    );
    await user.click(screen.getByRole("button", { name: /^Continue with/ }));
    await waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(2));
    await new Promise((resolve) => setTimeout(resolve, 120));
    return sent.slice(1);
}

/**
 * Every receipt a request carries, as `result_id:receipt_id`: every `prior…Receipts` field the
 * request has (subject, candidate, kind, anchor, handle, window), so no receipt family is skipped.
 */
function receiptsOf(body: Record<string, unknown>): string[] {
    return Object.entries(body)
        .filter(([field]) => /^prior[A-Z]\w*Receipts$/u.test(field))
        .flatMap(([, receipts]) =>
            ((receipts as { result_id: string; receipt_id: string }[] | undefined) ?? []).map(
                (receipt) => `${receipt.result_id}:${receipt.receipt_id}`,
            ),
        );
}

describe("two picks on one popup axis (CHAOS-12146)", () => {
    it("a host's popup keeps the second pick only, and one Continue sends ONE request", async () => {
        const { multiPick: _workbenchOnly, ...host } = createStandaloneSource(
            investigateFromGlobalFetch,
        );
        const followUps = await pickTwoOnOneAxis(host);
        expect(followUps).toHaveLength(1);
        expect(receiptsOf(followUps[0]!.body)).toEqual([
            `${QUESTION_RESULT}:receipt_atlas_project`,
            `${QUESTION_RESULT}:candr_repo_0001`,
        ]);
    });

    it("the Workbench fans out, and no follow-up carries a receipt of an older result", async () => {
        const followUps = await pickTwoOnOneAxis(
            createStandaloneSource(investigateFromGlobalFetch),
        );
        expect(followUps).toHaveLength(2);
        for (const { body, newestServed } of followUps) {
            // Each request goes out while the clarification is still the newest result served.
            expect(newestServed).toBe(QUESTION_RESULT);
            for (const receipt of receiptsOf(body)) {
                expect(receipt.startsWith(`${newestServed ?? ""}:`)).toBe(true);
            }
        }
    });
});
