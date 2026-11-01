import type { ReactNode } from "react";

import { useVocabularyLabels } from "./VocabularyWordContext";
import type { Cohort } from "../lib/contracts";
import { type VocabularyLabels, servedNote, servedWord } from "../lib/vocabulary-labels";

/** A restored answer is not validated, so a field can hold anything: show it, never throw. */
function rawText(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
}

type MeaningField = {
    readonly name: string;
    readonly value: unknown;
    /** ACR's words for this field. With none, the raw value stays in the closed fold. */
    readonly line: string | undefined;
};

/**
 * CHAOS-12480, CHAOS-12488: what a cohort rests on. A field with ACR's words is one line on the
 * page, and any other stays raw in the fold. Absent and false show nothing. Any other value shows
 * as it is: a population of zero is a measured value, with no sentence of its own. One sentence
 * holds the population and its bound. With nothing ranked there is no score to explain.
 */
function meaningFields(
    cohort: Cohort,
    labels: VocabularyLabels,
    ranked: boolean,
): readonly MeaningField[] {
    const { score_meaning, judgment_mismatch, population, population_lower_bound } = cohort;
    const populationLine = servedNote(labels, "population");
    const scoreLine =
        ranked && typeof score_meaning === "string"
            ? servedWord(labels, "cohort_score_meaning", score_meaning)
            : undefined;
    const fields: readonly MeaningField[] = [
        {
            name: "judgment_mismatch",
            value: judgment_mismatch,
            line: servedNote(labels, "judgment_mismatch"),
        },
        { name: "score_meaning", value: score_meaning, line: scoreLine },
        { name: "population", value: population, line: populationLine },
        { name: "population_lower_bound", value: population_lower_bound, line: populationLine },
    ];
    return fields.filter(({ value }) => value !== undefined && value !== null && value !== false);
}

export type CohortMeaningProps = {
    readonly cohort: Cohort;
    /** A table ranks this cohort, so its score has a meaning to state. */
    readonly ranked: boolean;
};

/** The fields with ACR's words, each one line on the page. */
export function CohortMeaningLines({ cohort, ranked }: CohortMeaningProps) {
    const fields = meaningFields(cohort, useVocabularyLabels(), ranked);
    return (
        <>
            {fields.map(({ name, line }) =>
                // The bound reads in the population's sentence.
                line === undefined || name === "population_lower_bound" ? null : (
                    <p className="record__meta" data-testid={`cohort-line-${name}`} key={name}>
                        {line}
                    </p>
                ),
            )}
        </>
    );
}

export type CohortMeaningDetailsProps = CohortMeaningProps & {
    /** Served text the panel has not put on the page itself. */
    readonly children?: ReactNode;
};

/**
 * What a cohort rests on, in one closed fold, under the ranked table or the member list. Every
 * member's reasons show: the status table draws its work items but not why they are here. A
 * zero-match has no reasons but can have a population, so the fold goes only when it would be empty.
 */
export function CohortMeaningDetails({ cohort, ranked, children }: CohortMeaningDetailsProps) {
    const fields = meaningFields(cohort, useVocabularyLabels(), ranked).filter(
        ({ line }) => line === undefined,
    );
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
            {fields.map(({ name, value }) => (
                <p className="record__meta" data-testid={`cohort-raw-${name}`} key={name}>
                    <code>
                        {name}: {rawText(value)}
                    </code>
                </p>
            ))}
        </details>
    );
}
