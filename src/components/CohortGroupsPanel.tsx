import { useId } from "react";

import type { Cohort } from "@/lib/contracts";
import { humanizeTerm } from "@/lib/presentation";

export type CohortGroupsPanelProps = {
    readonly cohort: Cohort | undefined;
};

/**
 * CHAOS-4636/CHAOS-4668: per-group complete/truncated, for a genuinely
 * grouped cohort answer ("team A complete, team B truncated" — the shape
 * `Cohort.complete`/`.truncated` alone cannot express, since those two are
 * defined as the conjunction/disjunction over the groups once groups exist).
 *
 * Gated on field presence, not on `interpretation.shape` intent, unlike
 * `CohortRankingPanel`: `groups` is itself the evidence that a grouped
 * answer was assembled, and this disclosure never re-derives — it echoes
 * `Cohort.groups` verbatim. Renders independently of whether a ranking table
 * applies (a grouped-family answer need not be a ranked one), so it can
 * surface even where `CohortRankingPanel` itself renders nothing.
 *
 * `groups` is schema-OPTIONAL and, per lane-4636's measured finding on real
 * `dh_0830` data (CHAOS-4668 comment), does not co-occur with a ranked
 * cohort there — expect this panel to need a fixture to observe rendering
 * against live data.
 */
export function CohortGroupsPanel({ cohort }: CohortGroupsPanelProps) {
    const idPrefix = useId();
    const groups = cohort?.groups ?? [];
    if (groups.length === 0) return null;
    return (
        <details className="disclosure" data-testid="cohort-groups-panel">
            <summary id={`${idPrefix}-cohort-groups-title`}>
                {groups.length} group{groups.length === 1 ? "" : "s"}
            </summary>
            <ul className="stack stack--tight">
                {groups.map((group) => (
                    <li className="record__meta" key={group.subject.canonical_id}>
                        {group.subject.label}:{" "}
                        {group.complete && !group.truncated
                            ? "complete"
                            : group.truncated
                              ? "truncated"
                              : "incomplete"}{" "}
                        — {group.member_canonical_ids.length} of {group.total}{" "}
                        {humanizeTerm(cohort?.kind ?? "member")}
                        {group.total === 1 ? "" : "s"} shown
                    </li>
                ))}
            </ul>
        </details>
    );
}
