import { useId } from "react";

import { Badge } from "@/components/Badge";
import type { AnswerCompleteness, PlanRequirementOutcomeRow } from "@/lib/contracts";
import {
    completenessStateTone,
    humanizeTerm,
    planRequirementOutcomeTone,
    statusTone,
} from "@/lib/presentation";

export type CompletenessPanelProps = {
    readonly completeness: AnswerCompleteness;
};

/**
 * The declared cause behind one row's outcome, when the server named one --
 * `cause_coverage`/`cause_narrowing`/`cause_overrun` are not mutually
 * exclusive on the wire, so every one the row carries is shown, never just
 * the first. `cause_observed` is per-row, not per-cause: it says whether
 * THIS row's named cause was reported by a mechanism or defaulted to, and is
 * appended so a defaulted cause is never mistaken for an observed one.
 */
function outcomeCauses(row: PlanRequirementOutcomeRow): readonly string[] {
    const causes = [row.cause_coverage, row.cause_narrowing, row.cause_overrun].filter(
        (value): value is string => value !== undefined,
    );
    if (causes.length === 0) return [];
    return row.cause_observed ? causes : causes.map((cause) => `${cause} (defaulted)`);
}

/**
 * CHAOS-4413/CHAOS-4642/CHAOS-5640/CHAOS-5109: shows how much of an answer is
 * here and why it stopped where it did.
 *
 * `terminal_status` reuses the exact same closed vocabulary as the result's
 * own `status` (`statusTone` is exhaustive over both), so its badge always
 * reads consistently with the rest of the page. `claimed_facts_count` and
 * `rows_count` are the engine's own UN-CLAMPED totals — independent of this
 * Workbench's own request-time budget (`options.max_*` in
 * `buildInvestigationRequest`) — so they can legitimately exceed what any
 * single panel actually renders; that is the point, not a bug (AGENTS.md
 * check 11: completeness is a public contract field, richer than the prose).
 * `terminal_reason` is a closed vocabulary naming WHY, never the engine's or
 * a model's own raw text (CHAOS-4413's own schema doc comment) — shown
 * verbatim, exactly like `CoveragePanel`'s degraded reasons.
 *
 * `state` (CHAOS-5640) is a SECOND, independent completeness signal, server-
 * derived from the requirement outcomes below it rather than authored —
 * never model text and never reconciled against `terminal_status`. The two
 * vocabularies answer different questions (disposition vs derived outcome)
 * and can legitimately disagree on the same result (e.g. a `complete`
 * disposition with a `partial` derived state); when they do, BOTH badges
 * stay visible side by side — this panel never picks a winner or collapses
 * one into the other. `not_derived` gets its own badge and tone
 * (`completenessStateTone`), never the `complete` tone and never omitted:
 * an answer with no derived outcomes is an honest gap, not a vacuous
 * success (the exact failure `AnswerCompleteness.state`'s schema doc
 * comment names).
 *
 * `outcomes` (CHAOS-5109) is the one authority for what this answer was
 * supposed to contain and what became of it — rendered one row per entry,
 * in the SERVER'S OWN ORDER, never re-sorted or de-duplicated (every stage
 * only appends to it, so wire order is itself part of what it discloses).
 * Absent or empty renders an explicit empty-state line instead of a table;
 * the contract guarantees that shape agrees with `state === "not_derived"`
 * (an empty outcome set is exactly what makes `state` `not_derived`), so
 * this view need not re-derive or assert that invariant itself.
 *
 * `refusal_basis` is a machine field this panel does not render — same rule
 * `DeterministicAnswerView` already applies to the top-level field of the
 * same name: what must reach the reader is the service's own limitation
 * sentence, not the closed-vocabulary token.
 */
export function CompletenessPanel({ completeness }: CompletenessPanelProps) {
    const idPrefix = useId();
    const outcomes = completeness.outcomes ?? [];
    return (
        <section
            className="panel panel--card panel--compact"
            aria-labelledby={`${idPrefix}-completeness-title`}
            data-testid="completeness-panel"
        >
            <h2 className="panel__title" id={`${idPrefix}-completeness-title`}>
                Completeness
            </h2>
            <div className="chip-row" data-testid="completeness-chip-row">
                <Badge
                    tone={statusTone(completeness.terminal_status)}
                    title={`terminal_status: ${completeness.terminal_status}`}
                >
                    {humanizeTerm(completeness.terminal_status)}
                </Badge>
                <Badge
                    tone={completenessStateTone(completeness.state)}
                    title={`state: ${completeness.state}`}
                >
                    {humanizeTerm(completeness.state)}
                </Badge>
            </div>
            <p className="record__meta">
                {`${String(completeness.claimed_facts_count)} claimed fact${completeness.claimed_facts_count === 1 ? "" : "s"} · ${String(completeness.rows_count)} row${completeness.rows_count === 1 ? "" : "s"}`}
            </p>
            {completeness.terminal_reason !== undefined ? (
                <p className="coverage__reason" data-testid="completeness-terminal-reason">
                    {humanizeTerm(completeness.terminal_reason)}
                </p>
            ) : null}
            <h3 className="panel__title" style={{ marginTop: 14 }}>
                Requirement outcomes
            </h3>
            {outcomes.length === 0 ? (
                <p className="panel__empty" data-testid="completeness-outcomes-empty">
                    No requirement outcomes were derived for this answer.
                </p>
            ) : (
                <div className="fact-table-wrap">
                    <table className="fact-table" data-testid="completeness-outcomes-table">
                        <thead>
                            <tr>
                                <th scope="col">Requirement</th>
                                <th scope="col">Outcome</th>
                                <th scope="col">Reason</th>
                            </tr>
                        </thead>
                        <tbody>
                            {outcomes.map((row, index) => {
                                const causes = outcomeCauses(row);
                                return (
                                    // Index key: rows carry no unique id on the
                                    // wire and this list is never reordered or
                                    // filtered, only ever rendered in the
                                    // server's own append-only order.
                                    <tr data-testid="completeness-outcome-row" key={index}>
                                        <td title={row.requirement}>
                                            {row.requirement === undefined
                                                ? "—"
                                                : humanizeTerm(row.requirement)}
                                        </td>
                                        <td>
                                            <Badge
                                                tone={planRequirementOutcomeTone(row.outcome)}
                                                title={`outcome: ${row.outcome}`}
                                            >
                                                {humanizeTerm(row.outcome)}
                                            </Badge>
                                        </td>
                                        <td>
                                            {causes.length === 0
                                                ? "—"
                                                : causes.map(humanizeTerm).join(" · ")}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
