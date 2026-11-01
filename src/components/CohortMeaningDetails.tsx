import { EvidenceReferences } from "./EvidenceReferences";
import { useVocabularyLabels } from "./VocabularyWordContext";
import type { Cohort, CohortMember, EvidenceRefLabels } from "../lib/contracts";
import { nonBlank, rawText } from "../lib/presentation";
import { type VocabularyLabels, servedNote, servedWord } from "../lib/vocabulary-labels";

/** The rows that hold both a name and a reason: a restored answer is not validated. */
function readableExclusions(cohort: Cohort) {
    return (Array.isArray(cohort.exclusions) ? cohort.exclusions : []).filter(
        (exclusion: Partial<NonNullable<Cohort["exclusions"]>[number]> | null) =>
            typeof exclusion?.subject?.label === "string" && typeof exclusion.reason === "string",
    );
}

/** Who the service left out of a cohort, and why, in its own words. */
export function CohortExclusions({ cohort }: { readonly cohort: Cohort }) {
    const exclusions = readableExclusions(cohort);
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
    // A sentence states a value ACR would write it for. An odd one stays raw: a word must not hide it.
    const populationLine =
        typeof population === "number" && population > 0
            ? servedNote(labels, "population")
            : undefined;
    const scoreLine =
        ranked && typeof score_meaning === "string"
            ? servedWord(labels, "cohort_score_meaning", score_meaning)
            : undefined;
    const fields: readonly MeaningField[] = [
        {
            name: "judgment_mismatch",
            value: judgment_mismatch,
            line: judgment_mismatch === true ? servedNote(labels, "judgment_mismatch") : undefined,
        },
        { name: "score_meaning", value: score_meaning, line: scoreLine },
        { name: "population", value: population, line: populationLine },
        {
            name: "population_lower_bound",
            value: population_lower_bound,
            line: population_lower_bound === true ? populationLine : undefined,
        },
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
    readonly evidenceRefLabels: EvidenceRefLabels;
    /** Members whose evidence another panel on the page draws. */
    readonly evidenceElsewhere?: ReadonlySet<CohortMember>;
};

/**
 * What a cohort rests on, in one closed fold, under the ranked table or the member list. Every
 * member's reasons show: the status table draws its work items but not why they are here. A
 * zero-match has no reasons but can have a population, so the fold goes only when it would be empty.
 * A ranked panel's page has no room for the rationale and the exclusions, so they sit here. A member
 * list draws them on the page.
 */
export function CohortMeaningDetails({
    cohort,
    ranked,
    evidenceRefLabels,
    evidenceElsewhere,
}: CohortMeaningDetailsProps) {
    const fields = meaningFields(cohort, useVocabularyLabels(), ranked).filter(
        ({ line }) => line === undefined,
    );
    const members = cohort.members.filter((member) => Array.isArray(member.inclusion_reasons));
    const cited = cohort.members.filter(
        (member) =>
            Array.isArray(member.evidence_ref_ids) &&
            member.evidence_ref_ids.length > 0 &&
            !evidenceElsewhere?.has(member),
    );
    const rationale =
        ranked && typeof cohort.rationale === "string" ? nonBlank(cohort.rationale) : undefined;
    const excluded = ranked && readableExclusions(cohort).length > 0;
    if (
        rationale === undefined &&
        !excluded &&
        members.length === 0 &&
        cited.length === 0 &&
        fields.length === 0
    ) {
        return null;
    }
    return (
        <details className="disclosure" data-testid="cohort-meaning-details">
            <summary>Details</summary>
            {rationale === undefined ? null : <p className="record__meta">{rationale}</p>}
            {excluded ? <CohortExclusions cohort={cohort} /> : null}
            {members.map((member, index) => (
                // Index key: the contract does not promise a unique canonical id.
                <p className="record__meta" data-testid="cohort-inclusion-reasons" key={index}>
                    {member.subject.label}: {member.inclusion_reasons.join(" ")}
                </p>
            ))}
            {cited.map((member, index) => (
                // Index key: the contract does not promise a unique canonical id.
                <div data-testid="cohort-member-evidence" key={index}>
                    <EvidenceReferences
                        evidenceRefIds={member.evidence_ref_ids}
                        evidenceRefLabels={evidenceRefLabels}
                        label={`Evidence: ${member.subject.label}`}
                    />
                </div>
            ))}
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
