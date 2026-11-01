import { ScrollRegion } from "./ScrollRegion";
import { useId } from "react";

import { Badge } from "./Badge";
import { RenderShapeChart } from "./RenderShapeChart";
import type {
    ClaimedFact,
    Cohort,
    CohortMember,
    CohortMemberDriver,
    InterpretedShape,
    InvestigationResult,
} from "../lib/contracts";
import {
    askedForCohort,
    cohortRanking,
    formatCohortScore,
    memberDriversText,
} from "../lib/cohort-ranking";
import { coverageCaption } from "../lib/coverage-caption";
import { rollupForSubject } from "../lib/investment-rollup";
import { COHORT_SHAPE_RULES, renderShapesFor } from "../lib/render-shapes";
import { cohortOutcomeTone, rawText } from "../lib/presentation";
import { CohortMeaningDetails, CohortMeaningLines } from "./CohortMeaningDetails";
import { InvestmentRollupLabel } from "./InvestmentRollupLabel";
import { useServedWord, useVocabularyWord } from "./VocabularyWordContext";

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
    const word = useVocabularyWord();
    const thresholdLabel = driver.threshold_labels?.[0];
    return (
        <li className="ranking__driver">
            <span className="ranking__driver-signal">{word("ranking_signal", driver.signal)}</span>{" "}
            <span className="record__meta">
                value {rawText(driver.value)} · contributed {rawText(driver.weight_contributed)} of{" "}
                {rawText(driver.weight)}
                {thresholdLabel === undefined ? null : (
                    <> · {word("threshold_label", thresholdLabel)}</>
                )}
            </span>
        </li>
    );
}

/**
 * The members the cohort carries but acr did not rank, by name, each with its served driver rows
 * when it has any (they often say why it was not ranked). The same `memberDriversText` as the
 * ranking table, so the two never disagree (CHAOS-12245, CHAOS-12429).
 */
function unrankedLabels(members: readonly CohortMember[]): readonly string[] {
    return members
        .filter((member) => member.ranking_computed !== true)
        .map((member) => {
            const drivers = memberDriversText(member);
            return drivers === null ? member.subject.label : `${member.subject.label} (${drivers})`;
        });
}

/** CHAOS-12178: a member whose investment claim is the owning team's roll-up says so. */
function MemberRollup({
    claims,
    subject,
}: {
    readonly claims: readonly ClaimedFact[];
    readonly subject: CohortMember["subject"];
}) {
    const rollup = rollupForSubject(claims, subject);
    if (rollup === null) return null;
    return (
        <div>
            <InvestmentRollupLabel rollup={rollup} />
        </div>
    );
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
 *    apart in practice (AGENTS.md check 10; see `isCohortIntent`).
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
 * 2. **A missing ranking is not an empty one.** When nothing was ranked this
 *    panel renders nothing, because an empty table would read as "ranked, and
 *    nothing qualified". `CohortMembersPanel` draws the members instead.
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
    const word = useVocabularyWord();
    const served = useServedWord();
    const ranking = cohortRanking(askedForCohort(shape, result), cohort);
    if (ranking.state === "not_requested" || ranking.state === "not_computed") return null;
    if (ranking.state === "kind_not_ranked") {
        // The cohort's kind (or a member's) is outside the closed allowlist --
        // an open-vocabulary value, or `person`, which is never ranked
        // (AGENTS.md: no person-to-person rankings). No score, rank or
        // member name is rendered.
        return (
            <section
                role="group"
                className="panel"
                aria-labelledby={`${idPrefix}-cohort-ranking-title`}
                data-testid="cohort-ranking-withheld"
            >
                <h2 className="panel__title" id={`${idPrefix}-cohort-ranking-title`}>
                    Ranking not shown
                </h2>
                <p className="record__meta">
                    This answer carries a cohort of a kind this view does not rank, so no ranking is
                    shown.
                </p>
            </section>
        );
    }
    if (cohort === undefined) return null;
    const rows = ranking.rows;
    // The served plural, or the cohort's own word for its rows: no pluralizer here (CHAOS-12417).
    const plural = served("subject_kind_plural", cohort.kind) ?? "members";
    const singular = word("subject_kind", cohort.kind);

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
            role="group"
            className="panel"
            aria-labelledby={`${idPrefix}-cohort-ranking-title`}
            data-testid="cohort-ranking-panel"
        >
            <h2 className="panel__title" id={`${idPrefix}-cohort-ranking-title`}>
                Ranked {plural}
            </h2>
            {cohort.complete && !cohort.truncated ? null : (
                <p className="record__meta" data-testid="cohort-incomplete-notice">
                    {cohort.truncated
                        ? `This ranking covers only the ${plural} the service returned — the cohort was truncated, so it is not every ${singular}.`
                        : `The service did not report this cohort as complete, so this ranking may not cover every ${singular}.`}
                </p>
            )}
            <CohortMeaningLines cohort={cohort} ranked />
            {
                // Above the table: when the question asked for a ranking, the
                // ranking IS the answer, and the score bars plus their
                // breakdown are the fastest reading of it. The table stays
                // directly below, carrying every value the chart shows plus
                // the ones it does not.
            }
            {cohortShapes.map((cohortShape) => {
                // CHAOS-12429 E: which ranked members this chart does not show, counted from the
                // verified cohort, never from the chart's numbers.
                const caption = coverageCaption(cohortShape, cohort);
                return (
                    <div key={cohortShape.shape_id}>
                        <RenderShapeChart cohort={cohort} shape={cohortShape} />
                        {caption.sentences.length === 0 ? null : (
                            <p className="record__meta" data-testid="cohort-chart-caption">
                                {caption.sentences.join(" ")}
                            </p>
                        )}
                    </div>
                );
            })}
            {withheldShapes > 0 ? (
                <p className="record__meta" data-testid="render-shapes-withheld">
                    {withheldShapes === 1 ? "A chart was" : `${withheldShapes} charts were`}{" "}
                    withheld: it could not be checked against the facts it cites in this answer.
                </p>
            ) : null}
            <ScrollRegion label="Ranking">
                <table className="fact-table">
                    <thead>
                        <tr>
                            <th scope="col">Rank</th>
                            <th scope="col">{singular}</th>
                            <th scope="col">Score</th>
                            <th scope="col">Outcome</th>
                            <th scope="col">Window</th>
                            <th scope="col">Top drivers</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr data-testid="ranking-row" key={row.member.subject.canonical_id}>
                                <td>{row.attentionRank}</td>
                                <td data-subject-id={row.member.subject.canonical_id}>
                                    {row.member.subject.label}
                                    <MemberRollup
                                        claims={result?.claimed_facts ?? []}
                                        subject={row.member.subject}
                                    />
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
                                            formatCohortScore(row.score)
                                        )
                                    }
                                </td>
                                <td>
                                    {row.member.outcome === undefined ? (
                                        "—"
                                    ) : (
                                        <Badge
                                            tone={cohortOutcomeTone(row.member.outcome)}
                                            data-value={row.member.outcome}
                                        >
                                            {word("member_outcome", row.member.outcome)}
                                        </Badge>
                                    )}
                                </td>
                                <td>{word("driver_window", row.window)}</td>
                                <td>
                                    {
                                        // The member's served driver rows, from the one shared
                                        // `memberDriversText`; nothing when it serves none.
                                        memberDriversText(row.member) === null ? null : (
                                            <p
                                                className="record__meta"
                                                data-testid="ranking-drivers-count"
                                            >
                                                {memberDriversText(row.member)}
                                            </p>
                                        )
                                    }
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
                                    {row.otherDrivers.length === 0 ? null : (
                                        <details
                                            className="disclosure"
                                            data-testid="ranking-other-drivers"
                                        >
                                            <summary>Other drivers</summary>
                                            <ul className="ranking__drivers">
                                                {row.otherDrivers.map((driver) => (
                                                    <DriverCell
                                                        driver={driver}
                                                        key={driver.signal}
                                                    />
                                                ))}
                                            </ul>
                                        </details>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </ScrollRegion>
            {rows.map((row) =>
                row.member.missing_signals === undefined ? null : (
                    <p className="record__meta" key={`${row.member.subject.canonical_id}-missing`}>
                        {row.member.subject.label} — missing signals:{" "}
                        {row.member.missing_signals
                            .map((signal) => word("ranking_signal", signal))
                            .join(", ")}
                    </p>
                ),
            )}
            {unranked.length === 0 ? null : (
                <p className="record__meta" data-testid="unranked-members">
                    Not ranked by the service: {unranked.join(", ")}.
                </p>
            )}
            <CohortMeaningDetails cohort={cohort} ranked />
        </section>
    );
}
