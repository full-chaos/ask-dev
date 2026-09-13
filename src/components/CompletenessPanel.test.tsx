import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CompletenessPanel } from "@/components/CompletenessPanel";
import type { AnswerCompleteness, PlanRequirementOutcomeRow } from "@/lib/contracts";

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
        expect(within(panel).getByTestId("completeness-chip-row")).toHaveTextContent("complete");
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
        expect(panel).toHaveTextContent("4 claimed facts");
        expect(panel).toHaveTextContent("2 rows");
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
        expect(panel).toHaveTextContent("1 claimed fact · 1 row");
        expect(panel).not.toHaveTextContent("1 claimed facts");
        expect(panel).not.toHaveTextContent("1 rows");
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
 * CHAOS-5640/CHAOS-5109: `state` is server-derived from the requirement
 * outcomes, independent of `terminal_status` — its own badge, exhaustive
 * over the four-member enum, with a tone that never reads `not_derived` as
 * `complete` and never hides it.
 */
describe("CompletenessPanel — completeness.state badge", () => {
    const EXPECTED_TONE: Record<AnswerCompleteness["state"], string> = {
        not_derived: "badge--neutral",
        complete: "badge--ok",
        partial: "badge--warn",
        degraded: "badge--bad",
    };

    for (const state of ["not_derived", "complete", "partial", "degraded"] as const) {
        it(`renders the "${state}" state with its own title and tone`, () => {
            const completeness: AnswerCompleteness = {
                terminal_status: "no_match",
                claimed_facts_count: 0,
                rows_count: 0,
                state,
            };
            const { unmount } = render(<CompletenessPanel completeness={completeness} />);

            const badge = screen.getByTitle(`state: ${state}`);
            expect(badge).toHaveTextContent(state.replaceAll("_", " "));
            expect(badge).toHaveClass(EXPECTED_TONE[state]);

            unmount();
        });
    }

    /**
     * D25/B2 (chris 2026-09-13): `terminal_status` (disposition) and `state`
     * (derived outcome) answer different questions and can legitimately
     * disagree on the same result. This panel never reconciles them — both
     * badges stay visible, unedited.
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
        expect(within(row).getByTitle("terminal_status: complete")).toHaveTextContent("complete");
        expect(within(row).getByTitle("state: partial")).toHaveTextContent("partial");
    });
});

function outcomeRow(overrides: Partial<PlanRequirementOutcomeRow> = {}): PlanRequirementOutcomeRow {
    return {
        stage: "assembled_result",
        requirement: "identity.default_requirement",
        obligation: "read",
        outcome: "satisfied",
        impact: "none",
        cause_observed: true,
        served: 1,
        declared: 1,
        ...overrides,
    };
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
        expect(screen.getByTitle("state: not_derived")).toBeInTheDocument();
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
            const row = within(rows[index]!);
            expect(row.getByTitle(outcome.requirement!)).toHaveTextContent(
                outcome.requirement!.replaceAll("_", " "),
            );
            expect(row.getByTitle(`outcome: ${outcome.outcome}`)).toHaveTextContent(
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
