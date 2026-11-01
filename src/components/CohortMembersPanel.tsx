import { useId } from "react";

import { CohortMeaningDetails, CohortMeaningLines } from "./CohortMeaningDetails";
import { useServedWord, useVocabularyWord } from "./VocabularyWordContext";
import { unrankedWorkItemMembers } from "./WorkItemStatusPanel";
import { askedForCohort, cohortRanking } from "../lib/cohort-ranking";
import type { Cohort, InvestigationResult } from "../lib/contracts";
import { nonBlank } from "../lib/presentation";
import { COHORT_SHAPE_RULES, renderShapesFor } from "../lib/render-shapes";

/**
 * Who the service left out of a cohort, and why, in its own words. A restored answer is not
 * validated, so a row that does not hold both draws nothing.
 */
export function CohortExclusions({ cohort }: { readonly cohort: Cohort }) {
    const exclusions = (Array.isArray(cohort.exclusions) ? cohort.exclusions : []).filter(
        (exclusion: Partial<NonNullable<Cohort["exclusions"]>[number]> | null) =>
            typeof exclusion?.subject?.label === "string" && typeof exclusion.reason === "string",
    );
    if (exclusions.length === 0) return null;
    return (
        <>
            <h3 className="panel__title" style={{ marginTop: 14 }}>
                Left out
            </h3>
            <ul className="stack stack--tight">
                {exclusions.map((exclusion, index) => (
                    // Index key: the contract does not promise a unique canonical id.
                    <li className="record__meta" data-testid="cohort-exclusion" key={index}>
                        {exclusion.subject.label}: {exclusion.reason}
                    </li>
                ))}
            </ul>
        </>
    );
}

/**
 * A cohort chart ACR served that cannot be checked: over a list with no scores, or with no cohort at
 * all. Said, never a silent absence (CHAOS-12484).
 */
function ChartsWithheld({ result }: { readonly result: InvestigationResult }) {
    const { withheld } = renderShapesFor(result, COHORT_SHAPE_RULES);
    if (withheld === 0) return null;
    return (
        <p className="record__meta" data-testid="render-shapes-withheld">
            {withheld === 1 ? "A chart was" : `${withheld} charts were`} withheld: it could not be
            checked against the facts it cites in this answer.
        </p>
    );
}

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
    const asked = askedForCohort(result.interpretation.shape, result);
    if (cohort === undefined) return asked ? <ChartsWithheld result={result} /> : null;
    if (cohortRanking(asked, cohort).state !== "not_computed") return null;

    const drawnByStatusTable = new Set(unrankedWorkItemMembers(cohort));
    const members = cohort.members.filter((member) => !drawnByStatusTable.has(member));
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
            <CohortMeaningLines cohort={cohort} ranked={false} />
            <ChartsWithheld result={result} />
            {cohort.members.length === 0 ? (
                <p className="panel__empty">The service returned no members.</p>
            ) : members.length === 0 ? null : (
                <ul className="stack stack--tight">
                    {members.map((member, index) => (
                        // Index key: the contract does not promise a unique canonical id, and this
                        // list is never reordered.
                        <li className="record__title" key={index}>
                            {member.subject.label}
                        </li>
                    ))}
                </ul>
            )}
            <CohortExclusions cohort={cohort} />
            <CohortMeaningDetails cohort={cohort} ranked={false} />
        </section>
    );
}
