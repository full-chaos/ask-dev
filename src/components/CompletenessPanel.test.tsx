import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CompletenessPanel } from "@/components/CompletenessPanel";
import type { AnswerCompleteness, PlanRequirementOutcomeRow } from "@/lib/contracts";

/** A raw term is carried in `data-value`: a user reads the served or generic word instead. */
const byValue = (root: ParentNode, value: string): Element | null =>
    root.querySelector(`[data-value="${value}"]`);

/**
 * CHAOS-4413/CHAOS-4642: `completeness` is a REQUIRED field on the pinned
 * `context_fabric_investigation_result.v1` contract from this pin onward —
 * every result carries it, so this panel always renders something, never a
 * conditional "if present" gate the way `temporal`/`window_clarification`
 * (genuinely optional fields) are handled elsewhere.
 */
describe("CompletenessPanel", () => {
    it("shows no terminal status word: the raw value stays in a data attribute only (CHAOS-12245)", () => {
        const completeness: AnswerCompleteness = {
            terminal_status: "complete",
            claimed_facts_count: 4,
            rows_count: 2,
            state: "not_derived",
        };
        render(<CompletenessPanel completeness={completeness} />);
        const panel = screen.getByTestId("completeness-panel");
        expect(within(panel).queryByTestId("completeness-chip-row")).toBeNull();
        expect(panel.getAttribute("data-terminal-status")).toBe("complete");
        expect(panel.getAttribute("data-completeness-state")).toBe("not_derived");
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

    it("says zero as zero", () => {
        const counts = (claimed_facts_count: number, rows_count: number) => {
            const completeness: AnswerCompleteness = {
                terminal_status: "complete",
                claimed_facts_count,
                rows_count,
                state: "not_derived",
            };
            const { container, unmount } = render(
                <CompletenessPanel completeness={completeness} />,
            );
            const text = container.textContent ?? "";
            unmount();
            return text;
        };
        expect(counts(0, 5)).toContain("No facts stand behind this answer.");
        expect(counts(2, 0)).toContain("2 facts, with no source rows.");
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
    it("shows the terminal reason verbatim when the answer stopped short", () => {
        const completeness: AnswerCompleteness = {
            terminal_status: "partial",
            terminal_reason: "limitation_disclosed",
            claimed_facts_count: 2,
            rows_count: 0,
            state: "partial",
        };
        render(<CompletenessPanel completeness={completeness} />);
        expect(screen.getByTestId("completeness-terminal-reason")).toHaveTextContent(
            "limitation disclosed",
        );
    });
});

/**
 * CHAOS-12245, chris's ruling: web never shows the raw completeness state, nor a sentence that only
 * restates it. `terminal_status` and `state` badges are gone; `partial` and `degraded` add at most
 * one "Missing data" sentence (CHAOS-12429), with no state word.
 */
/** Each text node apart: `textContent` joins a heading to the next word, and `\\b` then misses it. */
function textNodesOf(root: Element): string {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts: string[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode.textContent ?? "");
    return texts.join(" ");
}

describe("CompletenessPanel — no raw completeness state in view", () => {
    const base = { claimed_facts_count: 0, rows_count: 0 } as const;

    for (const terminal_status of ["complete", "partial", "degraded", "no_match"] as const) {
        for (const state of ["complete", "partial", "degraded", "not_derived"] as const) {
            it(`shows neither "${terminal_status}" nor "${state}" as a word`, () => {
                render(<CompletenessPanel completeness={{ ...base, terminal_status, state }} />);
                const panel = screen.getByTestId("completeness-panel");
                expect(panel.querySelectorAll(".badge")).toHaveLength(0);
                // Not as any other text either: a state word is never display text.
                expect(textNodesOf(panel)).not.toMatch(
                    /\b(?:complete|partial|degraded|no[ _]match|not[ _]derived)\b/iu,
                );
                expect(byValue(document, `terminal_status: ${terminal_status}`)).toBeNull();
                expect(byValue(document, `state: ${state}`)).toBeNull();
                expect(panel.getAttribute("data-terminal-status")).toBe(terminal_status);
                expect(panel.getAttribute("data-completeness-state")).toBe(state);
            });
        }
    }

    it("the Withheld badge stays", () => {
        render(
            <CompletenessPanel
                completeness={{ ...base, terminal_status: "complete", state: "complete" }}
                rankingWithheld={{ reason: "subject_kind_not_ranked", members_affected: 1 }}
            />,
        );
        expect(screen.getByText("Withheld")).toBeInTheDocument();
        expect(screen.getByTestId("completeness-withheld")).toBeInTheDocument();
    });
});

describe("CompletenessPanel — the Missing data sentence (CHAOS-12429)", () => {
    const withRows = (
        state: AnswerCompleteness["state"],
        outcomes: PlanRequirementOutcomeRow[],
    ): AnswerCompleteness => ({
        terminal_status: "partial",
        claimed_facts_count: 2,
        rows_count: 2,
        state,
        outcomes,
    });
    const sentence = () => screen.queryByTestId("completeness-missing-data");

    it("says one plain sentence for partial: what was missing, by requirement, no state word", () => {
        render(
            <CompletenessPanel
                completeness={withRows("partial", [
                    outcomeRow({
                        requirement: "state/project",
                        obligation: "state",
                        outcome: "narrowed",
                        impact: "depth",
                        served: 2,
                        declared: 5,
                    }),
                    outcomeRow({
                        requirement: "ranking/team",
                        obligation: "ranking",
                        outcome: "unavailable",
                        impact: "dimension",
                        served: 0,
                        declared: 0,
                    }),
                ])}
            />,
        );
        expect(sentence()).toHaveTextContent(
            "Missing data: state narrowed (2 of 5); ranking unavailable.",
        );
        expect(sentence()!.textContent).not.toMatch(/partial|degraded|complete|derived/iu);
    });

    it("also says it for degraded", () => {
        render(
            <CompletenessPanel
                completeness={withRows("degraded", [
                    outcomeRow({
                        requirement: "flow/team",
                        obligation: "flow",
                        outcome: "not_attempted",
                        impact: "scope",
                        served: 0,
                        declared: 0,
                    }),
                ])}
            />,
        );
        expect(sentence()).toHaveTextContent("Missing data: flow not attempted.");
    });

    it("says nothing for complete or not_derived, even when a row names a gap", () => {
        const gap = outcomeRow({
            requirement: "state/project",
            obligation: "state",
            outcome: "unavailable",
            impact: "scope",
        });
        for (const state of ["complete", "not_derived"] as const) {
            const { unmount } = render(<CompletenessPanel completeness={withRows(state, [gap])} />);
            expect(sentence()).toBeNull();
            unmount();
        }
    });

    it("names a row with an empty obligation by its requirement", () => {
        render(
            <CompletenessPanel
                completeness={withRows("partial", [
                    outcomeRow({
                        requirement: "workload/team",
                        obligation: "  ",
                        outcome: "unavailable",
                        impact: "scope",
                    }),
                ])}
            />,
        );
        expect(sentence()).toHaveTextContent("Missing data: workload unavailable.");
    });

    it("skips a row that names nothing, and says nothing when no row names a gap", () => {
        const { unmount } = render(
            <CompletenessPanel
                completeness={withRows("partial", [
                    {
                        ...outcomeRow({ impact: "scope" }),
                        requirement: undefined,
                        obligation: undefined,
                    } as unknown as PlanRequirementOutcomeRow,
                    outcomeRow({
                        requirement: "health/team",
                        obligation: "health",
                        outcome: "satisfied",
                        impact: "none",
                    }),
                    outcomeRow({
                        requirement: "flow/team",
                        obligation: "flow",
                        outcome: "not_applicable",
                        impact: "none",
                    }),
                ])}
            />,
        );
        expect(sentence()).toBeNull();
        unmount();
    });

    it("skips a row whose requirement is empty, even when it carries an obligation", () => {
        render(
            <CompletenessPanel
                completeness={withRows("partial", [
                    outcomeRow({
                        requirement: "",
                        obligation: "state",
                        outcome: "unavailable",
                        impact: "scope",
                    }),
                ])}
            />,
        );
        expect(sentence()).toBeNull();
    });

    it("never says a state word as an obligation's name", () => {
        render(
            <CompletenessPanel
                completeness={withRows("degraded", [
                    outcomeRow({
                        requirement: "partial/team",
                        obligation: "partial",
                        outcome: "unavailable",
                        impact: "scope",
                    }),
                ])}
            />,
        );
        expect(sentence()).toBeNull();
    });

    it("uses the last row of a requirement: a later stage supersedes an earlier one", () => {
        render(
            <CompletenessPanel
                completeness={withRows("partial", [
                    outcomeRow({
                        requirement: "state/project",
                        obligation: "state",
                        outcome: "unavailable",
                        impact: "scope",
                        stage: "planning",
                    }),
                    outcomeRow({
                        requirement: "state/project",
                        obligation: "state",
                        outcome: "satisfied",
                        impact: "none",
                        stage: "projection",
                    }),
                ])}
            />,
        );
        expect(sentence()).toBeNull();
    });

    it("falls back to the generic path for an outcome it does not know, with no table", () => {
        render(
            <CompletenessPanel
                completeness={withRows("partial", [
                    {
                        ...outcomeRow({
                            requirement: "state/project",
                            obligation: "state",
                            impact: "scope",
                        }),
                        outcome: "brand_new_outcome",
                    } as unknown as PlanRequirementOutcomeRow,
                ])}
            />,
        );
        expect(sentence()).toHaveTextContent("Missing data: state brand new outcome.");
    });

    it("is not shown while parts are withheld", () => {
        render(
            <CompletenessPanel
                completeness={withRows("partial", [
                    outcomeRow({
                        requirement: "state/project",
                        obligation: "state",
                        outcome: "unavailable",
                        impact: "scope",
                    }),
                ])}
                rankingWithheld={{ reason: "subject_kind_not_ranked", members_affected: 1 }}
            />,
        );
        expect(sentence()).toBeNull();
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

    for (const outcome of [
        "satisfied",
        "narrowed",
        "unavailable",
        "not_applicable",
        "not_attempted",
    ] as const) {
        it(`renders the "${outcome}" outcome with its own title and tone`, () => {
            const completeness: AnswerCompleteness = {
                terminal_status: "partial",
                claimed_facts_count: 1,
                rows_count: 1,
                state: "partial",
                outcomes: [{ ...baseOutcomeRow(), outcome }],
            };
            const { unmount } = render(<CompletenessPanel completeness={completeness} />);

            const badge = byValue(document, `outcome: ${outcome}`)!;
            expect(badge).toHaveTextContent(outcome.replaceAll("_", " "));
            expect(badge).toHaveClass(EXPECTED_TONE[outcome]);

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
        outcomes.forEach((outcome, index) => {
            const rowElement = rows[index]!;
            expect(byValue(rowElement, outcome.requirement!)).toHaveTextContent(
                outcome.requirement!.replaceAll("_", " "),
            );
            expect(byValue(rowElement, `outcome: ${outcome.outcome}`)).toHaveTextContent(
                outcome.outcome.replaceAll("_", " "),
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
            "items (defaulted)",
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
        expect(screen.getByTestId("completeness-outcome-obligation")).toHaveTextContent(
            "obligation: read",
        );
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
        expect(screen.getByTestId("completeness-outcome-row")).toHaveTextContent("scope");
    });

    /** `served`/`declared` are their own column, alongside outcome and impact. */
    it("heads the counts as served against needed", () => {
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
        expect(screen.getByRole("columnheader", { name: "Served / needed" })).toBeInTheDocument();
    });

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
        expect(steps[0]).toHaveTextContent("planning");
        expect(steps[0]).toHaveTextContent("10");
        expect(steps[0]).toHaveTextContent("5");
        expect(steps[0]).toHaveTextContent("attention rank");
        expect(steps[1]).toHaveTextContent("projection");
        expect(steps[1]).toHaveTextContent("items");
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
