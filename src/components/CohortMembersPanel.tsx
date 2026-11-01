import { useId } from "react";

import { useServedWord, useVocabularyWord } from "./VocabularyWordContext";
import { unrankedWorkItemMembers } from "./WorkItemStatusPanel";
import { cohortRanking } from "../lib/cohort-ranking";
import type { InvestigationResult } from "../lib/contracts";
import { nonBlank } from "../lib/presentation";
import { servesCohortShape } from "../lib/render-shapes";

/**
 * A cohort with nothing ranked: "who owns this", "which pull requests are open" (lead's ruling on
 * CHAOS-3748, gap 1). The members are the answer, for every kind the gate lets through, so they are
 * drawn in the service's order with the service's own `rationale` and `exclusions`. No rank, no
 * score. A zero-match still draws: its `rationale` is the only reason the cohort gives, and zero
 * is a measured value, not a missing one (AGENTS.md check 12).
 *
 * Work items the status table draws are not listed twice.
 */
export function CohortMembersPanel({ result }: { readonly result: InvestigationResult }) {
    const idPrefix = useId();
    const word = useVocabularyWord();
    const served = useServedWord();
    const { cohort } = result;
    const ranking = cohortRanking(result.interpretation.shape, cohort, servesCohortShape(result));
    if (ranking.state !== "not_computed") return null;
    if (cohort === undefined) return null;

    const drawnByStatusTable = new Set(unrankedWorkItemMembers(cohort));
    const members = cohort.members.filter((member) => !drawnByStatusTable.has(member));
    const exclusions = cohort.exclusions ?? [];
    const plural = served("subject_kind_plural", cohort.kind);
    const singular = word("subject_kind", cohort.kind);
    const rationale = nonBlank(cohort.rationale);
    const titleId = `${idPrefix}-cohort-members-title`;
    return (
        <section
            role="group"
            className="panel"
            aria-labelledby={titleId}
            data-testid="cohort-members-panel"
        >
            <h2 className="panel__title" id={titleId}>
                {plural ?? "Members"}
            </h2>
            {cohort.complete && !cohort.truncated ? null : (
                <p className="record__meta" data-testid="cohort-members-notice">
                    {cohort.truncated
                        ? `This list covers only the ${plural ?? "members"} the service returned — the cohort was truncated, so it is not every ${singular}.`
                        : `The service did not report this cohort as complete, so this list may not cover every ${singular}.`}
                </p>
            )}
            {rationale === undefined ? null : <p className="record__meta">{rationale}</p>}
            {cohort.members.length === 0 ? (
                <p className="panel__empty">The service returned no members.</p>
            ) : members.length === 0 ? null : (
                <ul className="stack stack--tight">
                    {members.map((member) => (
                        <li className="record__title" key={member.subject.canonical_id}>
                            {member.subject.label}
                        </li>
                    ))}
                </ul>
            )}
            {exclusions.length === 0 ? null : (
                <>
                    <h3 className="panel__title" style={{ marginTop: 14 }}>
                        Left out
                    </h3>
                    <ul className="stack stack--tight">
                        {exclusions.map((exclusion) => (
                            <li
                                className="record__meta"
                                data-testid="cohort-exclusion"
                                key={exclusion.subject.canonical_id}
                            >
                                {exclusion.subject.label}: {exclusion.reason}
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </section>
    );
}
