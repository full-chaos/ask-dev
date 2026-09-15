import { useId } from "react";

import { EvidenceReferences } from "@/components/EvidenceReferences";
import { SafeAnswerText } from "@/components/SafeAnswerText";
import type { ClaimedFact, CohortMember, InvestigationResult, SubjectRef } from "@/lib/contracts";
import { cellText } from "@/lib/fact-rows";
import { isCohortIntent } from "@/lib/cohort-ranking";

export type WorkItemStatusPanelProps = {
    readonly result: InvestigationResult;
};

/**
 * The contract does not promise canonical IDs are unique across kinds. Keep
 * both parts of a subject identity when joining cohort members to facts.
 */
function subjectKey(subject: SubjectRef): string {
    return JSON.stringify([subject.kind, subject.canonical_id]);
}

function unrankedWorkItemMembers(cohort: InvestigationResult["cohort"]): CohortMember[] {
    if (cohort === undefined || cohort.kind !== "work_item") return [];
    return cohort.members.filter(
        (member) => member.subject.kind === "work_item" && member.ranking_computed !== true,
    );
}

function statusFactsBySubject(facts: readonly ClaimedFact[]): ReadonlyMap<string, ClaimedFact[]> {
    const bySubject = new Map<string, ClaimedFact[]>();
    for (const fact of facts) {
        // `kind: "status"` is the producer's existing status vocabulary. The
        // field remains producer-owned, so the consumer does not invent or
        // translate a second field vocabulary here.
        if (fact.kind !== "status" || fact.subject.kind !== "work_item") continue;
        const key = subjectKey(fact.subject);
        const existing = bySubject.get(key);
        if (existing === undefined) {
            bySubject.set(key, [fact]);
        } else {
            existing.push(fact);
        }
    }
    return bySubject;
}

function StatusCell({ facts }: { readonly facts: readonly ClaimedFact[] }) {
    if (facts.length === 0) {
        return (
            <span className="panel__empty" data-testid="work-item-status-missing">
                No status evidence in this answer
            </span>
        );
    }

    return (
        <ul className="work-item-status__observations">
            {facts.map((fact, index) => (
                <li data-claim-id={fact.claim_id} key={`${fact.claim_id}-${index}`}>
                    <SafeAnswerText text={cellText(fact.value)} />
                </li>
            ))}
        </ul>
    );
}

/**
 * Displays the existing scalar status claims for an unranked work-item
 * cohort. This is a view over the result document: it does not rank members,
 * create a table-shaped fact, select a latest observation, or map provider
 * states to a product judgment.
 */
export function WorkItemStatusPanel({ result }: WorkItemStatusPanelProps) {
    const idPrefix = useId();
    if (!isCohortIntent(result.interpretation.shape)) return null;

    const members = unrankedWorkItemMembers(result.cohort);
    if (members.length === 0) return null;

    const factsBySubject = statusFactsBySubject(result.claimed_facts);
    const titleId = `${idPrefix}-work-item-status-title`;

    return (
        <section
            aria-labelledby={titleId}
            className="panel panel--card"
            data-testid="work-item-status-panel"
        >
            <h2 className="panel__title" id={titleId}>
                Work item status
            </h2>
            <div className="fact-table-wrap">
                <table
                    className="fact-table work-item-status__table"
                    data-testid="work-item-status-table"
                >
                    <caption className="sr-only">Work item status</caption>
                    <thead>
                        <tr>
                            <th scope="col">Work item</th>
                            <th scope="col">Status</th>
                            <th scope="col">Evidence</th>
                        </tr>
                    </thead>
                    <tbody>
                        {members.map((member, index) => {
                            const key = subjectKey(member.subject);
                            const statusFacts = factsBySubject.get(key) ?? [];
                            const evidenceRefIds = member.evidence_ref_ids;
                            return (
                                <tr
                                    data-subject-id={member.subject.canonical_id}
                                    data-subject-kind={member.subject.kind}
                                    data-testid="work-item-status-row"
                                    key={`${key}-${index}`}
                                >
                                    <th scope="row" title={member.subject.canonical_id}>
                                        {member.subject.label}
                                    </th>
                                    <td data-testid="work-item-status-value">
                                        <StatusCell facts={statusFacts} />
                                    </td>
                                    <td data-testid="work-item-status-evidence">
                                        {evidenceRefIds === undefined ||
                                        evidenceRefIds.length === 0 ? (
                                            <span aria-label="No evidence references">—</span>
                                        ) : (
                                            <EvidenceReferences
                                                evidenceRefIds={evidenceRefIds}
                                                evidenceRefLabels={result.evidence_ref_labels}
                                            />
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
