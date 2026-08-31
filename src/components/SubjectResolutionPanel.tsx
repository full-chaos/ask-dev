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
 *
 * CHAOS-4669 (defect 4, standing empty-states rule): renders nothing when
 * the resolution is genuinely contentless — no clarification prompt, no
 * committed subjects, no candidates, and no prior-turn receipt disclosure
 * to show. "Nothing committed. / No candidates were proposed." as a full
 * panel for two sentences of negative space is exactly the "contentless
 * meta panel" the ticket names (chris's UX notes, "SUBJECTS — Nothing
 * committed. No candidates were proposed."). This is NOT the standing
 * "missing is not healthy" rule in reverse: a subject resolution with
 * nothing to disclose is not a coverage gap the reader needs to see — it
 * is the ordinary shape of an answer that never had an ambiguous subject
 * to begin with, and `CoveragePanel`/`LimitationsPanel` already own
 * disclosing what could not be read.
 */
export function SubjectResolutionPanel({ resolution }: SubjectResolutionPanelProps) {
    const hasPriorReceiptDisclosure =
        resolution.prior_subject_receipt_dispositions !== undefined &&
        resolution.prior_subject_receipt_dispositions.length > 0;
    const isContentless =
        resolution.clarification_prompt === undefined &&
        resolution.committed.length === 0 &&
        resolution.candidates.length === 0 &&
        !hasPriorReceiptDisclosure;
    if (isContentless) return null;
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
