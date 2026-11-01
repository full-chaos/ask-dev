import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CompletenessPanel } from "@/components/CompletenessPanel";
import type { AnswerCompleteness, PlanRequirementOutcomeRow } from "@/lib/contracts";

/** A badge by its raw value: the value stays in `data-value`, and a user reads the word. */
function badge(root: HTMLElement, value: string): HTMLElement {
    const found = root.querySelector<HTMLElement>(`[data-value="${value}"]`);
    if (found === null) throw new Error(`no badge for ${value}`);
    return found;
}

/**
 * CHAOS-4413/CHAOS-4642: `completeness` is a REQUIRED field on the pinned
 * `context_fabric_investigation_result.v1` contract from this pin onward —
 * every result carries it, so this panel always renders something, never a
 * conditional "if present" gate the way `temporal`/`window_clarification`
 * (genuinely optional fields) are handled elsewhere.
 */
describe("CompletenessPanel", () => {
    it("shows the terminal status as visible chip text, not just a color", () => {
        const completeness: AnswerCompleteness = {
            terminal_status: "complete",
            claimed_facts_count: 4,
            rows_count: 2,
            state: "not_derived",
        };
        render(<CompletenessPanel completeness={completeness} />);
        const panel = screen.getByTestId("completeness-panel");
        // Web's rule: "Full answer" needs complete completeness too.
        expect(within(panel).getByTestId("completeness-chip-row")).toHaveTextContent("Answer");
    });

    it("shows the claimed-facts and row counts", () => {
        const completeness: AnswerCompleteness = {
            terminal_status: "complete",
            claimed_facts_count: 4,
            rows_count: 2,
            state: "not_derived",
        };
        render(<CompletenessPanel completeness={completeness} />);
        const panel = screen.getByTestId("completeness-panel");
        expect(panel).toHaveTextContent("4 facts from 2 source rows.");
    });

    it("singularizes a count of exactly one", () => {
        const completeness: AnswerCompleteness = {
            terminal_status: "complete",
            claimed_facts_count: 1,
            rows_count: 1,
            state: "not_derived",
        };
        render(<CompletenessPanel completeness={completeness} />);
        const panel = screen.getByTestId("completeness-panel");
        expect(panel).toHaveTextContent("1 fact from 1 source row.");
        expect(panel).not.toHaveTextContent("1 facts");
        expect(panel).not.toHaveTextContent("1 source rows");
    });

    /**
     * `terminal_reason` is ABSENT exactly when `terminal_status` is
     * `complete` (the schema's own conditional) — there is nothing to
     * disclose, so this panel must not invent one.
     */
    it("shows no terminal reason when the answer is complete", () => {
        const completeness: AnswerCompleteness = {
            terminal_status: "complete",
            claimed_facts_count: 4,
            rows_count: 2,
            state: "not_derived",
        };
        render(<CompletenessPanel completeness={completeness} />);
        expect(screen.queryByTestId("completeness-terminal-reason")).not.toBeInTheDocument();
    });

    /**
     * Present and one of the closed values on every non-complete status —
     * never the engine's or a model's own raw text (schema doc comment on
     * `AnswerCompleteness.terminal_reason`).
     */
    it("words the terminal reason when the answer stopped short", () => {
        const completeness: AnswerCompleteness = {
            terminal_status: "partial",
            terminal_reason: "limitation_disclosed",
            claimed_facts_count: 2,
            rows_count: 0,
            state: "partial",
        };
        render(<CompletenessPanel completeness={completeness} />);
        expect(screen.getByTestId("completeness-terminal-reason")).toHaveTextContent(
            "Ask Dev named a limitation of this answer.",
        );
    });
});

/**
 * CHAOS-5640/CHAOS-5109: `state` is server-derived from the requirement
 * outcomes, independent of `terminal_status` — its own badge, exhaustive
 * over the four-member enum, with a tone that never reads `not_derived` as
 * `complete` and never hides it.
 */
describe("CompletenessPanel — completeness.state badge", () => {
    const EXPECTED_TONE = { partial: "badge--warn", degraded: "badge--bad" } as const;
    const EXPECTED_WORDS = {
        partial: "Read in part",
        degraded: "Some data not available",
    } as const;

    // CHAOS-12245, chris's ruling: not derived renders nothing about completeness, and a complete
    // state adds nothing to the status pill, which already reads "Full answer".
    it.each(["not_derived", "complete"] as const)("says nothing for the %s state", (state) => {
        render(
            <CompletenessPanel
                completeness={{
                    terminal_status: "complete",
                    claimed_facts_count: 0,
                    rows_count: 0,
                    state,
                }}
            />,
        );

        expect(document.querySelector(`[data-value="state: ${state}"]`)).toBeNull();
        expect(screen.getByTestId("completeness-chip-row")).not.toHaveTextContent("Coverage");
    });

    for (const state of ["partial", "degraded"] as const) {
        it(`renders the "${state}" state with its own words and tone`, () => {
            const completeness: AnswerCompleteness = {
                terminal_status: "no_match",
                claimed_facts_count: 0,
                rows_count: 0,
                state,
            };
            const { unmount } = render(<CompletenessPanel completeness={completeness} />);

            const stateBadge = badge(document.body, `state: ${state}`);
            expect(stateBadge.textContent).toBe(EXPECTED_WORDS[state]);
            expect(stateBadge).toHaveClass(EXPECTED_TONE[state]);
            expect(stateBadge).not.toHaveAttribute("title");

            unmount();
        });
    }

    /**
     * D25/B2 (chris 2026-09-13): `terminal_status` (disposition) and `state`
     * (derived outcome) answer different questions and can legitimately
     * disagree on the same result. This panel never reconciles them — both
     * badges stay visible, each in its own words. Web's rule (CHAOS-12245) only
     * keeps the first from saying "Full answer" beside a partial state.
     */
    it("shows BOTH badges, unreconciled, when terminal_status and state disagree", () => {
        const completeness: AnswerCompleteness = {
            terminal_status: "complete",
            claimed_facts_count: 4,
            rows_count: 2,
            state: "partial",
        };
        render(<CompletenessPanel completeness={completeness} />);
        const row = screen.getByTestId("completeness-chip-row");
        expect(badge(row, "terminal_status: complete").textContent).toBe(
            "Answer, not fully covered",
        );
        expect(badge(row, "state: partial").textContent).toBe("Read in part");
    });
});

/**
 * The outcome badge's tone switch is exhaustive over the closed enum, same
 * discipline as the `state` badge above -- every member gets its own
 * tone-asserted test, not just the two an earlier wire-order test happens
 * to use.
 */
describe("CompletenessPanel — outcome badge tone", () => {
    const EXPECTED_TONE: Record<PlanRequirementOutcomeRow["outcome"], string> = {
        satisfied: "badge--ok",
        not_applicable: "badge--neutral",
        narrowed: "badge--warn",
        not_attempted: "badge--warn",
        unavailable: "badge--bad",
    };

    const EXPECTED_WORDS: Record<PlanRequirementOutcomeRow["outcome"], string> = {
        satisfied: "read in full",
        narrowed: "read in part",
        unavailable: "not available: not known",
        not_applicable: "does not apply",
        not_attempted: "not read: not known",
    };

    for (const outcome of [
        "satisfied",
        "narrowed",
        "unavailable",
        "not_applicable",
        "not_attempted",
    ] as const) {
        it(`renders the "${outcome}" outcome with its own words and tone`, () => {
            const completeness: AnswerCompleteness = {
                terminal_status: "partial",
                claimed_facts_count: 1,
                rows_count: 1,
                state: "partial",
                outcomes: [{ ...baseOutcomeRow(), outcome }],
            };
            const { unmount } = render(<CompletenessPanel completeness={completeness} />);

            const outcomeBadge = badge(document.body, `outcome: ${outcome}`);
            expect(outcomeBadge.textContent).toBe(EXPECTED_WORDS[outcome]);
            expect(outcomeBadge).toHaveClass(EXPECTED_TONE[outcome]);
            expect(outcomeBadge).not.toHaveAttribute("title");

            unmount();
        });
    }
});

function baseOutcomeRow(): PlanRequirementOutcomeRow {
    return {
        stage: "assembled_result",
        requirement: "identity.default_requirement",
        obligation: "read",
        outcome: "satisfied",
        impact: "none",
        cause_observed: true,
        served: 1,
        declared: 1,
    };
}

function outcomeRow(overrides: Partial<PlanRequirementOutcomeRow> = {}): PlanRequirementOutcomeRow {
    return { ...baseOutcomeRow(), ...overrides };
}

/**
 * CHAOS-5109: the outcome table is the reader-facing half of the same
 * derivation `state` above summarizes — one row per `outcomes[]` entry,
 * in the server's OWN order, never re-sorted or de-duplicated.
 */
describe("CompletenessPanel — requirement outcomes", () => {
    it("shows an explicit empty-state line when outcomes is absent, agreeing with not_derived", () => {
        const completeness: AnswerCompleteness = {
            terminal_status: "no_match",
            claimed_facts_count: 0,
            rows_count: 0,
            state: "not_derived",
        };
        render(<CompletenessPanel completeness={completeness} />);
        expect(screen.getByTestId("completeness-outcomes-empty")).toHaveTextContent(
            "No requirement outcomes were derived",
        );
        expect(screen.queryByTestId("completeness-outcomes-table")).not.toBeInTheDocument();
        expect(document.querySelector('[data-value="state: not_derived"]')).toBeNull();
    });

    it("shows an explicit empty-state line when outcomes is an empty array, agreeing with not_derived", () => {
        const completeness: AnswerCompleteness = {
            terminal_status: "no_match",
            claimed_facts_count: 0,
            rows_count: 0,
            state: "not_derived",
            outcomes: [],
        };
        render(<CompletenessPanel completeness={completeness} />);
        expect(screen.getByTestId("completeness-outcomes-empty")).toBeInTheDocument();
        expect(screen.queryByTestId("completeness-outcomes-table")).not.toBeInTheDocument();
    });

    it("renders one row per outcome, in wire order, with identity and outcome", () => {
        const outcomes: PlanRequirementOutcomeRow[] = [
            outcomeRow({ requirement: "identity.first_requirement", outcome: "satisfied" }),
            outcomeRow({ requirement: "identity.second_requirement", outcome: "narrowed" }),
            outcomeRow({ requirement: "identity.third_requirement", outcome: "unavailable" }),
        ];
        const completeness: AnswerCompleteness = {
            terminal_status: "partial",
            terminal_reason: "limitation_disclosed",
            claimed_facts_count: 3,
            rows_count: 3,
            state: "partial",
            outcomes,
        };
        render(<CompletenessPanel completeness={completeness} />);

        const rows = screen.getAllByTestId("completeness-outcome-row");
        expect(rows).toHaveLength(3);
        // Wire order, never re-sorted: row i shows outcome i's own fields.
        const OUTCOME_WORDS = ["read in full", "read in part", "not available: not known"];
        outcomes.forEach((outcome, index) => {
            const row = rows[index]!;
            // The identity stays on the cell for a test; a user reads what it needed.
            const cell = row.querySelector(`[data-requirement="${outcome.requirement!}"]`);
            expect(cell).toHaveTextContent("Read");
            expect(row.textContent).not.toContain(outcome.requirement!);
            expect(badge(row, `outcome: ${outcome.outcome}`).textContent).toBe(
                OUTCOME_WORDS[index],
            );
        });
    });

    it("shows the reason field (declared cause) beside the outcome when the row carries one", () => {
        const outcomes: PlanRequirementOutcomeRow[] = [
            outcomeRow({
                requirement: "identity.narrowed_requirement",
                outcome: "narrowed",
                impact: "scope",
                cause_narrowing: "top_n_selection",
                cause_observed: true,
            }),
        ];
        const completeness: AnswerCompleteness = {
            terminal_status: "partial",
            terminal_reason: "limitation_disclosed",
            claimed_facts_count: 1,
            rows_count: 1,
            state: "partial",
            outcomes,
        };
        render(<CompletenessPanel completeness={completeness} />);
        const row = screen.getByTestId("completeness-outcome-row");
        expect(row).toHaveTextContent("top n selection");
    });

    it("marks a defaulted (not observed) cause distinctly from a reported one", () => {
        const outcomes: PlanRequirementOutcomeRow[] = [
            outcomeRow({
                requirement: "identity.defaulted_requirement",
                outcome: "narrowed",
                impact: "scope",
                cause_overrun: "items",
                cause_observed: false,
            }),
        ];
        const completeness: AnswerCompleteness = {
            terminal_status: "partial",
            claimed_facts_count: 1,
            rows_count: 1,
            state: "partial",
            outcomes,
        };
        render(<CompletenessPanel completeness={completeness} />);
        expect(screen.getByTestId("completeness-outcome-row")).toHaveTextContent(
            "too many items (defaulted)",
        );
    });

    it("renders a row with no requirement identity as an honest gap, not a dropped row", () => {
        const {
            requirement: _requirement,
            obligation: _obligation,
            ...withoutIdentity
        } = outcomeRow();
        const outcomes: PlanRequirementOutcomeRow[] = [withoutIdentity];
        const completeness: AnswerCompleteness = {
            terminal_status: "complete",
            claimed_facts_count: 1,
            rows_count: 1,
            state: "complete",
            outcomes,
        };
        render(<CompletenessPanel completeness={completeness} />);
        const rows = screen.getAllByTestId("completeness-outcome-row");
        expect(rows).toHaveLength(1);
        expect(rows[0]).toHaveTextContent("—");
    });

    /**
     * `obligation` is present exactly when `requirement` is, per the
     * schema -- both must render, not just the identity.
     */
    it("renders the row's obligation beside its requirement identity", () => {
        const outcomes: PlanRequirementOutcomeRow[] = [
            outcomeRow({ requirement: "readiness.release", obligation: "read" }),
        ];
        const completeness: AnswerCompleteness = {
            terminal_status: "partial",
            claimed_facts_count: 1,
            rows_count: 1,
            state: "partial",
            outcomes,
        };
        render(<CompletenessPanel completeness={completeness} />);
        expect(screen.getByTestId("completeness-outcome-obligation").textContent).toBe("Read");
    });

    it("omits the obligation line when the row carries no obligation", () => {
        const { obligation: _obligation, ...withoutObligation } = outcomeRow();
        render(
            <CompletenessPanel
                completeness={{
                    terminal_status: "complete",
                    claimed_facts_count: 1,
                    rows_count: 1,
                    state: "complete",
                    outcomes: [withoutObligation],
                }}
            />,
        );
        expect(screen.queryByTestId("completeness-outcome-obligation")).not.toBeInTheDocument();
    });

    /**
     * `impact` -- "what the reader loses" -- is a different fact than the
     * outcome that caused it, so it is its own column.
     */
    it("shows the row's impact as its own visible column", () => {
        const outcomes: PlanRequirementOutcomeRow[] = [
            outcomeRow({ outcome: "narrowed", impact: "scope" }),
        ];
        render(
            <CompletenessPanel
                completeness={{
                    terminal_status: "partial",
                    claimed_facts_count: 1,
                    rows_count: 1,
                    state: "partial",
                    outcomes,
                }}
            />,
        );
        expect(screen.getByTestId("completeness-outcome-row")).toHaveTextContent("Narrower scope");
    });

    /** `served`/`declared` are their own column, alongside outcome and impact. */
    it("shows the row's served and declared counts", () => {
        const outcomes: PlanRequirementOutcomeRow[] = [outcomeRow({ served: 2, declared: 5 })];
        render(
            <CompletenessPanel
                completeness={{
                    terminal_status: "partial",
                    claimed_facts_count: 5,
                    rows_count: 2,
                    state: "partial",
                    outcomes,
                }}
            />,
        );
        expect(screen.getByTestId("completeness-outcome-row")).toHaveTextContent("2 / 5");
    });

    /**
     * The `refinements` step-by-step trail renders behind a per-row
     * disclosure, every step's own fields visible once opened, never
     * summarized away.
     */
    it("discloses every refinement step's own fields when the row carries a chain", () => {
        const outcomes: PlanRequirementOutcomeRow[] = [
            outcomeRow({
                outcome: "narrowed",
                impact: "scope",
                refinements: [
                    { stage: "planning", basis: "attention_rank", before: 10, after: 5 },
                    { stage: "projection", overrun: "items", before: 5, after: 3 },
                ],
            }),
        ];
        render(
            <CompletenessPanel
                completeness={{
                    terminal_status: "partial",
                    claimed_facts_count: 3,
                    rows_count: 3,
                    state: "partial",
                    outcomes,
                }}
            />,
        );
        const row = screen.getByTestId("completeness-outcome-row");
        expect(within(row).getByText("2 refinement steps")).toBeInTheDocument();
        const steps = within(row).getAllByTestId("completeness-outcome-refinement-step");
        expect(steps).toHaveLength(2);
        expect(steps[0]).toHaveTextContent("while planning");
        expect(steps[0]).toHaveTextContent("10");
        expect(steps[0]).toHaveTextContent("5");
        expect(steps[0]).toHaveTextContent("by attention rank");
        expect(steps[1]).toHaveTextContent("while shaping the answer");
        expect(steps[1]).toHaveTextContent("too many items");
    });

    it("shows no refinement disclosure when the row carries no refinements", () => {
        const outcomes: PlanRequirementOutcomeRow[] = [outcomeRow()];
        render(
            <CompletenessPanel
                completeness={{
                    terminal_status: "complete",
                    claimed_facts_count: 1,
                    rows_count: 1,
                    state: "complete",
                    outcomes,
                }}
            />,
        );
        expect(
            screen.queryByTestId("completeness-outcome-refinement-step"),
        ).not.toBeInTheDocument();
    });

    /**
     * `outcomes` carries `@maxItems 200` on the wire — this panel renders
     * what the contract sends, never a client-side cap of its own.
     */
    it("renders all 200 rows at the contract's own bound, without truncation", () => {
        const outcomes: PlanRequirementOutcomeRow[] = Array.from({ length: 200 }, (_unused, i) =>
            outcomeRow({ requirement: `identity.requirement_${String(i)}` }),
        );
        const completeness: AnswerCompleteness = {
            terminal_status: "complete",
            claimed_facts_count: 200,
            rows_count: 200,
            state: "complete",
            outcomes,
        };
        render(<CompletenessPanel completeness={completeness} />);
        expect(screen.getAllByTestId("completeness-outcome-row")).toHaveLength(200);
    });
});

/**
 * Every pinned example under `src/contracts/examples` that carries a
 * `completeness` block must render through this panel without throwing —
 * enumerated from the files themselves, never a hand-picked subset, so a
 * new example added later is covered automatically.
 */
describe("CompletenessPanel — every example fixture carrying completeness", () => {
    const EXAMPLES_DIR = path.resolve(import.meta.dirname, "../contracts/examples");
    const exampleFiles = readdirSync(EXAMPLES_DIR).filter((entry) => entry.endsWith(".json"));

    const completenessExamples = exampleFiles
        .map((file) => {
            const value = JSON.parse(readFileSync(path.join(EXAMPLES_DIR, file), "utf8")) as {
                completeness?: AnswerCompleteness;
            };
            return { file, completeness: value.completeness };
        })
        .filter(
            (entry): entry is { file: string; completeness: AnswerCompleteness } =>
                entry.completeness !== undefined,
        );

    // A regression here means the fixture set changed shape and this sweep
    // silently stopped covering anything — fail loudly instead of passing
    // vacuously on zero fixtures.
    it("found at least one example carrying completeness", () => {
        expect(completenessExamples.length).toBeGreaterThan(0);
    });

    for (const { file, completeness } of completenessExamples) {
        it(`renders ${file} without throwing`, () => {
            const { unmount } = render(<CompletenessPanel completeness={completeness} />);
            expect(screen.getByTestId("completeness-panel")).toBeInTheDocument();
            unmount();
        });
    }
});
