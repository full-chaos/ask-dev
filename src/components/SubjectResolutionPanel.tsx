import { Badge } from "@/components/Badge";
import { EvidenceReferences } from "@/components/EvidenceReferences";
import { PriorSubjectReceiptDisclosure } from "@/components/PriorSubjectReceiptDisclosure";
import type { SubjectResolution } from "@/lib/contracts";
import { candidateStateTone, formatConfidence, humanizeTerm } from "@/lib/presentation";

export type SubjectResolutionPanelProps = {
    readonly resolution: SubjectResolution;
};

/**
 * Shows which subjects the service committed to, and which candidates it could
 * not choose between. The clarification prompt is the service's own words; the
 * workbench never writes one.
 */
export function SubjectResolutionPanel({ resolution }: SubjectResolutionPanelProps) {
    return (
        <section className="panel" aria-labelledby="subjects-title">
            <h2 className="panel__title" id="subjects-title">
                Subjects
            </h2>
            {resolution.clarification_prompt !== undefined ? (
                <p className="answer__body">{resolution.clarification_prompt}</p>
            ) : null}
            <p className="record__meta">
                {resolution.committed.length === 0
                    ? "Nothing committed."
                    : `Committed: ${resolution.committed
                          .map((subject) => `${subject.label} (${subject.kind})`)
                          .join(", ")}`}
            </p>
            {resolution.candidates.length === 0 ? (
                <p className="panel__empty">No candidates were proposed.</p>
            ) : (
                <ul className="stack">
                    {resolution.candidates.map((candidate) => (
                        <li className="record" key={candidate.receipt_id}>
                            <div className="record__head">
                                <span className="record__title">{candidate.subject.label}</span>
                                <Badge
                                    tone={candidateStateTone(candidate.state)}
                                    title={candidate.state}
                                >
                                    {humanizeTerm(candidate.state)}
                                </Badge>
                                <span className="record__meta">
                                    {candidate.subject.kind} · {candidate.subject.canonical_id} ·
                                    confidence {formatConfidence(candidate.confidence)}
                                </span>
                            </div>
                            <ul className="stack stack--tight record__body">
                                {candidate.match_reasons.map((reason) => (
                                    <li className="record__meta" key={reason}>
                                        {reason}
                                    </li>
                                ))}
                            </ul>
                            <EvidenceReferences evidenceRefIds={candidate.evidence_ref_ids} />
                        </li>
                    ))}
                </ul>
            )}
            <PriorSubjectReceiptDisclosure
                dispositions={resolution.prior_subject_receipt_dispositions}
            />
        </section>
    );
}
