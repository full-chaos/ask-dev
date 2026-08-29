import { Badge } from "@/components/Badge";
import type { Cohort, CohortMember, CohortMemberDriver } from "@/lib/contracts";
import { rankingTable } from "@/lib/cohort-ranking";
import { cohortDataCompletenessTone, cohortOutcomeTone, humanizeTerm } from "@/lib/presentation";

export type CohortRankingPanelProps = {
    readonly cohort: Cohort | undefined;
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
 * Three boundary rules hold this panel honest:
 *
 * 1. **Never a bare score.** Every score renders with its `outcome` beside it
 *    and its strongest drivers below it, and a member that scored while
 *    carrying no drivers says so in words rather than leaving the cell blank
 *    (North Star check 8; acr's `rankingTableRow` comment states the same
 *    rule from the producing side).
 * 2. **A missing ranking is not an empty one.** When acr ranked no member the
 *    panel renders nothing at all, because an empty table would read as
 *    "ranked, and nothing qualified" — a different claim from "ranking never
 *    ran" (`ranking_computed`'s own distinction).
 * 3. **Nothing is silently discarded.** acr's reference table drops members it
 *    did not rank; dropping them without a word is the exact shape
 *    `silent-discard-closure.test.ts` exists to close, so they are named
 *    under the table instead.
 */
export function CohortRankingPanel({ cohort }: CohortRankingPanelProps) {
    if (cohort === undefined) return null;
    const rows = rankingTable(cohort.members);
    if (rows === null) return null;

    const unranked = unrankedLabels(cohort.members);

    return (
        <section className="panel" aria-labelledby="cohort-ranking-title">
            <h2 className="panel__title" id="cohort-ranking-title">
                Ranked {humanizeTerm(cohort.kind)}s
            </h2>
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
                                        // An em dash, never a blank or a zero: the
                                        // contract distinguishes "no score" from a
                                        // score of 0, and `outcome` in the next
                                        // column says which this is.
                                        row.score === null ? "—" : row.score
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
                                        <span className="panel__empty">No drivers reported.</span>
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
