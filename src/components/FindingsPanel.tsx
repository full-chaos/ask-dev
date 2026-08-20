import { EvidenceReferences } from "@/components/EvidenceReferences";
import { SafeAnswerText } from "@/components/SafeAnswerText";
import type { Finding } from "@/lib/contracts";
import { humanizeTerm } from "@/lib/presentation";

export type FindingsPanelProps = {
    readonly title: string;
    readonly findings: readonly Finding[];
    readonly emptyMessage: string;
};

/** Renders one `Finding[]` section — remaining work, readiness gaps, or conflicts. */
export function FindingsPanel({ title, findings, emptyMessage }: FindingsPanelProps) {
    const titleId = `findings-${title.toLowerCase().replaceAll(" ", "-")}`;
    return (
        <section className="panel" aria-labelledby={titleId}>
            <h2 className="panel__title" id={titleId}>
                {title}
            </h2>
            {findings.length === 0 ? (
                <p className="panel__empty">{emptyMessage}</p>
            ) : (
                <ul className="stack">
                    {findings.map((finding) => (
                        <li className="record" key={finding.finding_id}>
                            <div className="record__head">
                                <span className="record__title">{humanizeTerm(finding.kind)}</span>
                                {finding.subjects !== undefined && finding.subjects.length > 0 ? (
                                    <span className="record__meta">
                                        {finding.subjects
                                            .map((subject) => subject.label)
                                            .join(", ")}
                                    </span>
                                ) : null}
                            </div>
                            <p className="record__body">
                                <SafeAnswerText text={finding.summary} />
                            </p>
                            <EvidenceReferences
                                evidenceRefIds={finding.evidence_ref_ids}
                                label="Evidence"
                            />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
