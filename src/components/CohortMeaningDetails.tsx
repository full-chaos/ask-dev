import type { ReactNode } from "react";

import type { Cohort } from "../lib/contracts";

/** A restored answer is not validated, so a field can hold anything: show it, never throw. */
function rawText(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * CHAOS-12480: the fields ACR serves no words for yet stay raw here until it does. A field that is
 * absent or false shows nothing. A population of zero is a measured value, so it shows.
 */
function rawFields(cohort: Cohort): readonly (readonly [string, string])[] {
    const fields: (readonly [string, string])[] = [];
    if (cohort.score_meaning !== undefined)
        fields.push(["score_meaning", rawText(cohort.score_meaning)]);
    if (cohort.judgment_mismatch === true) fields.push(["judgment_mismatch", "true"]);
    if (cohort.population !== undefined) fields.push(["population", rawText(cohort.population)]);
    if (cohort.population_lower_bound === true) fields.push(["population_lower_bound", "true"]);
    return fields;
}

export type CohortMeaningDetailsProps = {
    readonly cohort: Cohort;
    /** Served text the panel has not put on the page itself. */
    readonly children?: ReactNode;
};

/**
 * What a cohort rests on, in one closed fold, under the ranked table or the member list. Every
 * member's reasons show: the status table draws its work items but not why they are here. A
 * zero-match has no reasons but can have a population, so the fold goes only when it would be empty.
 */
export function CohortMeaningDetails({ cohort, children }: CohortMeaningDetailsProps) {
    const fields = rawFields(cohort);
    const { members } = cohort;
    if (members.length === 0 && fields.length === 0) return null;
    return (
        <details className="disclosure" data-testid="cohort-meaning-details">
            <summary>Details</summary>
            {children}
            {members.map((member, index) =>
                Array.isArray(member.inclusion_reasons) ? (
                    // Index key: the contract does not promise a unique canonical id.
                    <p className="record__meta" data-testid="cohort-inclusion-reasons" key={index}>
                        {member.subject.label}: {member.inclusion_reasons.join(" ")}
                    </p>
                ) : null,
            )}
            {fields.map(([name, value]) => (
                <p className="record__meta" data-testid={`cohort-raw-${name}`} key={name}>
                    <code>
                        {name}: {value}
                    </code>
                </p>
            ))}
        </details>
    );
}
