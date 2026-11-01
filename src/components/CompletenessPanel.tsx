import { ScrollRegion } from "./ScrollRegion";
import type { RankingWithheld } from "../lib/ranking-withheld";
import { useId } from "react";

import { Badge } from "./Badge";
import type {
    AnswerCompleteness,
    PlanRequirementOutcomeRow,
    RequirementRefinement,
} from "../lib/contracts";
import { missingDataSentence } from "../lib/missing-data";
import { humanizeTerm, planRequirementOutcomeTone } from "../lib/presentation";

export type CompletenessPanelProps = {
    readonly completeness: AnswerCompleteness;
    /**
     * Present when the Workbench withheld parts of this answer. Status and
     * completeness must then NOT read Complete: a withheld part is unknown
     * here, not complete.
     */
    readonly rankingWithheld?: RankingWithheld | undefined;
};

/**
 * The declared cause behind one row's outcome, when the server named one --
 * `cause_coverage`/`cause_narrowing`/`cause_overrun` are not mutually
 * exclusive on the wire, so every one the row carries is shown, never just
 * the first. `cause_observed` is per-row, not per-cause: it says whether
 * THIS row's named cause was reported by a mechanism or defaulted to, and is
 * appended so a defaulted cause is never mistaken for an observed one.
 */
/** How many facts and source rows stand behind the answer; zero is said as zero. */
function factCountText(completeness: AnswerCompleteness): string {
    const facts = completeness.claimed_facts_count;
    const rows = completeness.rows_count;
    if (facts === 0) return "No facts stand behind this answer.";
    const factWord = facts === 1 ? "1 fact" : `${facts.toLocaleString("en-US")} facts`;
    if (rows === 0) return `${factWord}, with no source rows.`;
    const rowWord = rows === 1 ? "1 source row" : `${rows.toLocaleString("en-US")} source rows`;
    return `${factWord} from ${rowWord}.`;
}

function outcomeCauses(row: PlanRequirementOutcomeRow): readonly string[] {
    const causes = [row.cause_coverage, row.cause_narrowing, row.cause_overrun].filter(
        (value): value is string => value !== undefined,
    );
    if (causes.length === 0) return [];
    return row.cause_observed ? causes : causes.map((cause) => `${cause} (defaulted)`);
}

/**
 * One `RequirementRefinement` step, as its own field=value pairs -- a
 * closed-vocabulary trail, never prose. `basis`/`overrun`/`coverage` are
 * not mutually exclusive on the wire (the schema requires at least one),
 * so every one the step carries is shown.
 */
function RefinementStep({
    step,
    index,
}: {
    readonly step: RequirementRefinement;
    readonly index: number;
}) {
    const causes = [
        step.basis === undefined ? null : `basis: ${humanizeTerm(step.basis)}`,
        step.overrun === undefined ? null : `overrun: ${humanizeTerm(step.overrun)}`,
        step.coverage === undefined ? null : `coverage: ${humanizeTerm(step.coverage)}`,
    ].filter((entry): entry is string => entry !== null);
    return (
        <li className="record__meta" data-testid="completeness-outcome-refinement-step">
            {`${String(index + 1)}. ${humanizeTerm(step.stage)} — ${String(step.before)} → ${String(step.after)}${causes.length === 0 ? "" : ` (${causes.join(", ")})`}`}
        </li>
    );
}

/**
 * CHAOS-4413/CHAOS-4642/CHAOS-5640/CHAOS-5109: shows how much of an answer is
 * here and why it stopped where it did.
 *
 * CHAOS-12245, chris's ruling: the raw completeness never shows. Neither `terminal_status` nor
 * `state` is drawn as a badge or a word; both stay in `data-*` attributes on the panel for a
 * program to read. `complete` and `not_derived` add nothing. `partial` and `degraded` add at most
 * one "Missing data" sentence built from the requirement rows (`missingDataSentence`, CHAOS-12429),
 * which carries no state word. The Withheld badge stays: a withheld part is unknown here, not
 * complete, so the sentence is not shown then either.
 *
 * `claimed_facts_count` and `rows_count` are the engine's own UN-CLAMPED totals -- independent of
 * this Workbench's own request-time budget (`options.max_*` in `buildInvestigationRequest`) -- so
 * they can legitimately exceed what any single panel actually renders; that is the point, not a bug
 * (AGENTS.md check 11: completeness is a public contract field, richer than the prose).
 * `terminal_reason` is a closed vocabulary naming WHY, never the engine's or a model's own raw
 * text (CHAOS-4413's own schema doc comment) -- shown verbatim, exactly like `CoveragePanel`'s
 * degraded reasons. (CHAOS-12417 moves the counts, the reason and the outcomes table.)
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
 * Every field on a row is either a visible column or a disclosed one, never
 * silently absent (same "nothing is silently discarded" discipline as
 * `CohortRankingPanel`/`CoveragePanel`): `obligation` renders beside the
 * `requirement` identity (present exactly when `requirement` is, per the
 * schema); `impact` is its own column, since "what the reader loses" is a
 * different fact than the outcome that caused it; `served`/`declared` are
 * their own column; the `refinements` step-by-step trail, when the row
 * carries one, sits behind a per-row `<details>` (same pattern as
 * `CoveragePanel`'s "Source details") rather than crowding the scannable
 * row, since it is optional narrative depth on top of the row's own facts.
 *
 * `refusal_basis` is a machine field this panel does not render — same rule
 * `DeterministicAnswerView` already applies to the top-level field of the
 * same name: what must reach the reader is the service's own limitation
 * sentence, not the closed-vocabulary token.
 */
export function CompletenessPanel({ completeness, rankingWithheld }: CompletenessPanelProps) {
    const withheld = rankingWithheld !== undefined;
    const idPrefix = useId();
    const outcomes = completeness.outcomes ?? [];
    // CHAOS-12245: the raw state is never shown; a partial or degraded answer adds this one
    // sentence at most. While parts are withheld, completeness is not stated at all.
    const missingData = withheld ? null : missingDataSentence(completeness);
    return (
        <section
            role="group"
            className="panel panel--card panel--compact"
            aria-labelledby={`${idPrefix}-completeness-title`}
            data-testid="completeness-panel"
            data-terminal-status={completeness.terminal_status}
            data-completeness-state={completeness.state}
        >
            <h2 className="panel__title" id={`${idPrefix}-completeness-title`}>
                Completeness
            </h2>
            {withheld ? (
                <div className="chip-row" data-testid="completeness-chip-row">
                    <Badge
                        tone="warn"
                        data-value={`withheld; service terminal_status: ${completeness.terminal_status}, state: ${completeness.state}`}
                    >
                        Withheld
                    </Badge>
                </div>
            ) : null}
            <p className="record__meta">{factCountText(completeness)}</p>
            {withheld ? (
                <p className="coverage__reason" data-testid="completeness-withheld">
                    Parts of this answer were withheld, so completeness is not stated here.
                </p>
            ) : null}
            {missingData === null ? null : (
                <p className="coverage__reason" data-testid="completeness-missing-data">
                    {missingData}
                </p>
            )}
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
                <ScrollRegion label="Requirement outcomes">
                    <table className="fact-table" data-testid="completeness-outcomes-table">
                        <thead>
                            <tr>
                                <th scope="col">Requirement</th>
                                <th scope="col">Outcome</th>
                                <th scope="col">Impact</th>
                                <th scope="col">Served / needed</th>
                                <th scope="col">Reason</th>
                            </tr>
                        </thead>
                        <tbody>
                            {outcomes.map((row, index) => {
                                const causes = outcomeCauses(row);
                                const refinements = row.refinements ?? [];
                                return (
                                    // Index key: rows carry no unique id on the
                                    // wire and this list is never reordered or
                                    // filtered, only ever rendered in the
                                    // server's own append-only order.
                                    <tr data-testid="completeness-outcome-row" key={index}>
                                        <td data-value={row.requirement}>
                                            {row.requirement === undefined
                                                ? "—"
                                                : humanizeTerm(row.requirement)}
                                            {row.obligation === undefined ? null : (
                                                <>
                                                    <br />
                                                    <span
                                                        className="record__meta"
                                                        data-testid="completeness-outcome-obligation"
                                                    >
                                                        {`obligation: ${humanizeTerm(row.obligation)}`}
                                                    </span>
                                                </>
                                            )}
                                        </td>
                                        <td>
                                            <Badge
                                                tone={planRequirementOutcomeTone(row.outcome)}
                                                data-value={`outcome: ${row.outcome}`}
                                            >
                                                {humanizeTerm(row.outcome)}
                                            </Badge>
                                        </td>
                                        <td>{humanizeTerm(row.impact)}</td>
                                        <td>{`${String(row.served)} / ${String(row.declared)}`}</td>
                                        <td>
                                            {causes.length === 0
                                                ? "—"
                                                : causes.map(humanizeTerm).join(" · ")}
                                            {refinements.length === 0 ? null : (
                                                <details className="disclosure">
                                                    <summary>
                                                        {refinements.length === 1
                                                            ? "1 refinement step"
                                                            : `${String(refinements.length)} refinement steps`}
                                                    </summary>
                                                    <ul className="stack stack--tight">
                                                        {refinements.map((step, stepIndex) => (
                                                            // Index key: steps carry no unique
                                                            // id on the wire and this chain is
                                                            // never reordered or filtered.
                                                            <RefinementStep
                                                                key={stepIndex}
                                                                step={step}
                                                                index={stepIndex}
                                                            />
                                                        ))}
                                                    </ul>
                                                </details>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </ScrollRegion>
            )}
        </section>
    );
}
