import { useId } from "react";

import { Badge } from "@/components/Badge";
import { RenderShapeChart } from "@/components/RenderShapeChart";
import type {
    Cohort,
    CohortMember,
    CohortMemberDriver,
    InterpretedShape,
    InvestigationResult,
} from "@/lib/contracts";
import { isCohortIntent, rankingTable } from "@/lib/cohort-ranking";
import { COHORT_SHAPE_RULES, renderShapesFor } from "@/lib/render-shapes";
import { cohortDataCompletenessTone, cohortOutcomeTone, humanizeTerm } from "@/lib/presentation";

export type CohortRankingPanelProps = {
    /**
     * CHAOS-4415: the whole answer, so the panel can read the render shapes
     * acr selected for this cohort AND re-resolve every plotted number
     * against the cohort in the same document. Optional: an answer from a
     * pre-4415 acr carries none, and the panel is unchanged for it.
     */
    readonly result: InvestigationResult | undefined;
    readonly cohort: Cohort | undefined;
    /**
     * `interpretation.shape` — what the question actually asked for. Required,
     * not optional: a caller that simply forgot to pass it would silently get
     * the old unconditional rendering back.
     */
    readonly shape: InterpretedShape;
};

/** A driver's contribution, as the member itself states it. Nothing re-derived. */
function DriverCell({ driver }: { readonly driver: CohortMemberDriver }) {
    const thresholdLabel = driver.threshold_labels?.[0];
    return (
        <li className="ranking__driver">
            <span className="ranking__driver-signal">{humanizeTerm(driver.signal)}</span>{" "}
            <span className="record__meta">
                value {driver.value} · contributed {driver.weight_contributed} of {driver.weight}
                {thresholdLabel === undefined ? null : <> · {humanizeTerm(thresholdLabel)}</>}
            </span>
        </li>
    );
}

/** The labels of members the cohort carries but acr did not rank. */
function unrankedLabels(members: readonly CohortMember[]): readonly string[] {
    return members
        .filter((member) => member.ranking_computed !== true)
        .map((member) => member.subject.label);
}

/**
 * The cohort ranking table (CHAOS-4449; acr CHAOS-4398 PR3/PR3b).
 *
 * One row per member acr actually ranked, in its own `attention_rank` order,
 * built by `@/lib/cohort-ranking` from fields the member already carries —
 * see that module for why each rule is acr's and not this repo's.
 *
 * Four boundary rules hold this panel honest:
 *
 * 0. **Conditional on intent, never default.** A ranking renders only when the
 *    question asked for one (`interpretation.shape`), not merely because the
 *    result carries cohort data — the pinned canonical example is
 *    `single_subject` and still carries a ranked team cohort, so the two come
 *    apart in practice (AGENTS.md check 10; see `isCohortIntent`). Nothing is
 *    lost when the gate closes: the raw cohort stays visible in the canonical
 *    result inspector, which is the view that exists to show everything.
 *
 * 1. **Never a bare score, and fail closed.** Every score renders with its
 *    `outcome` beside it and its strongest drivers below it. A member that
 *    scored while carrying NO drivers has its score **withheld** — the number
 *    is not shown at all, and the row says why. The pinned schema accepts
 *    that shape, so Ajv will not reject it upstream and this view is the last
 *    place to catch it; AGENTS.md:40 requires failing closed here rather than
 *    masking an answer-quality failure. Withheld rather than dropped: the row
 *    and its outcome still render, because omitting the member silently would
 *    be the opposite failure.
 * 2. **A missing ranking is not an empty one.** When acr ranked no member the
 *    panel renders nothing at all, because an empty table would read as
 *    "ranked, and nothing qualified" — a different claim from "ranking never
 *    ran" (`ranking_computed`'s own distinction).
 * 3. **Nothing is silently discarded.** acr's reference table drops members it
 *    did not rank; dropping them without a word is the exact shape
 *    `silent-discard-closure.test.ts` exists to close, so they are named
 *    under the table instead. `unrankedLabels` can only name members the
 *    cohort still CARRIES, though — so the cohort-level `complete`/`truncated`
 *    flags are surfaced too. Without them a census that never finished, or one
 *    cut by the 250-member cap, would read as an exhaustive ranking of every
 *    team (AGENTS.md checks 11 and 12: completeness is a public contract
 *    field, and missing is not healthy).
 */
export function CohortRankingPanel({ cohort, result, shape }: CohortRankingPanelProps) {
    // Several answered turns coexist on the chat surface, so a hardcoded id
    // would make the second panel's `aria-labelledby` resolve to the FIRST
    // panel's heading — the same multi-instance bug `DeterministicAnswerView`
    // and `StructureNeedsPanel` already use `useId()` to avoid.
    const idPrefix = useId();
    if (!isCohortIntent(shape)) return null;
    if (cohort === undefined) return null;
    const rows = rankingTable(cohort.members);
    if (rows === null) return null;

    const unranked = unrankedLabels(cohort.members);

    // CHAOS-4415: the charts acr selected FOR THIS COHORT — the attention
    // score bars and the per-driver contribution stack that explains them.
    // Read, never decided: if acr selected none, none render, and this panel
    // is byte-identical to its pre-4415 self. A shape whose numbers do not
    // re-resolve against this same cohort is withheld and SAID, not dropped
    // quietly, for the same reason a score with no drivers behind it is
    // (rule 1 above).
    const { shapes: cohortShapes, withheld: withheldShapes } =
        result === undefined
            ? { shapes: [], withheld: 0 }
            : renderShapesFor(result, COHORT_SHAPE_RULES);

    return (
        <section
            className="panel"
            aria-labelledby={`${idPrefix}-cohort-ranking-title`}
            data-testid="cohort-ranking-panel"
        >
            <h2 className="panel__title" id={`${idPrefix}-cohort-ranking-title`}>
                Ranked {humanizeTerm(cohort.kind)}s
            </h2>
            {cohort.complete && !cohort.truncated ? null : (
                <p className="record__meta" data-testid="cohort-incomplete-notice">
                    {cohort.truncated
                        ? `This ranking covers only the ${humanizeTerm(cohort.kind)}s the service returned — the cohort was truncated, so it is not every ${humanizeTerm(cohort.kind)}.`
                        : `The service did not report this cohort as complete, so this ranking may not cover every ${humanizeTerm(cohort.kind)}.`}
                </p>
            )}
            {
                // Above the table: when the question asked for a ranking, the
                // ranking IS the answer, and the score bars plus their
                // breakdown are the fastest reading of it. The table stays
                // directly below, carrying every value the chart shows plus
                // the ones it does not.
            }
            {cohortShapes.map((cohortShape) => (
                <RenderShapeChart key={cohortShape.shape_id} shape={cohortShape} />
            ))}
            {withheldShapes > 0 ? (
                <p className="record__meta" data-testid="render-shapes-withheld">
                    {withheldShapes === 1 ? "A chart was" : `${withheldShapes} charts were`}{" "}
                    withheld: the plotted values did not match the facts they cite in this answer.
                </p>
            ) : null}
            <div className="fact-table-wrap">
                <table className="fact-table">
                    <thead>
                        <tr>
                            <th scope="col">Rank</th>
                            <th scope="col">{humanizeTerm(cohort.kind)}</th>
                            <th scope="col">Score</th>
                            <th scope="col">Outcome</th>
                            <th scope="col">Data completeness</th>
                            <th scope="col">Window</th>
                            <th scope="col">Top drivers</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr data-testid="ranking-row" key={row.member.subject.canonical_id}>
                                <td>{row.attentionRank}</td>
                                <td title={row.member.subject.canonical_id}>
                                    {row.member.subject.label}
                                </td>
                                <td>
                                    {
                                        // Three distinct states, never collapsed:
                                        // a real score; an em dash for "the service
                                        // sent none" (the contract distinguishes
                                        // that from a score of 0, and `outcome`
                                        // next door says which); and "withheld"
                                        // for a score this view refuses to show
                                        // because nothing explains it.
                                        row.scoreWithheld ? (
                                            <span
                                                className="panel__empty"
                                                data-testid="score-withheld"
                                            >
                                                withheld
                                            </span>
                                        ) : row.score === null ? (
                                            "—"
                                        ) : (
                                            row.score
                                        )
                                    }
                                </td>
                                <td>
                                    {row.member.outcome === undefined ? (
                                        "—"
                                    ) : (
                                        <Badge
                                            tone={cohortOutcomeTone(row.member.outcome)}
                                            title={row.member.outcome}
                                        >
                                            {humanizeTerm(row.member.outcome)}
                                        </Badge>
                                    )}
                                </td>
                                <td>
                                    {row.member.data_completeness === undefined ? (
                                        "—"
                                    ) : (
                                        <Badge
                                            tone={cohortDataCompletenessTone(
                                                row.member.data_completeness,
                                            )}
                                            title={row.member.data_completeness}
                                        >
                                            {humanizeTerm(row.member.data_completeness)}
                                        </Badge>
                                    )}
                                </td>
                                <td>{humanizeTerm(row.window)}</td>
                                <td>
                                    {row.topDrivers.length === 0 ? (
                                        <span className="panel__empty">
                                            {row.scoreWithheld
                                                ? "No drivers reported — score withheld."
                                                : "No drivers reported."}
                                        </span>
                                    ) : (
                                        <ul className="ranking__drivers">
                                            {row.topDrivers.map((driver) => (
                                                <DriverCell driver={driver} key={driver.signal} />
                                            ))}
                                        </ul>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {rows.map((row) =>
                row.member.missing_signals === undefined ? null : (
                    <p className="record__meta" key={`${row.member.subject.canonical_id}-missing`}>
                        {row.member.subject.label} — missing signals:{" "}
                        {row.member.missing_signals.map(humanizeTerm).join(", ")}
                    </p>
                ),
            )}
            {unranked.length === 0 ? null : (
                <p className="record__meta" data-testid="unranked-members">
                    Not ranked by the service: {unranked.join(", ")}.
                </p>
            )}
        </section>
    );
}
