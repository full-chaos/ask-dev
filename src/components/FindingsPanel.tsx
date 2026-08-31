import { EvidenceReferences } from "@/components/EvidenceReferences";
import { SafeAnswerText } from "@/components/SafeAnswerText";
import type { DedupedFinding } from "@/lib/fact-dedup";
import { SURFACE_LABEL } from "@/lib/fact-dedup";
import { humanizeTerm } from "@/lib/presentation";

export type FindingsPanelProps = {
    readonly title: string;
    readonly findings: readonly DedupedFinding[];
    readonly emptyMessage: string;
};

/**
 * Renders one `Finding[]` section — remaining work, readiness gaps, or
 * conflicts.
 *
 * CHAOS-4669 defect 1: `findings` carries `@/lib/fact-dedup`'s dedup
 * verdict, not a bare `Finding[]`, since the SAME fact commonly reaches
 * more than one of these three surfaces (plus Limitations). A duplicate
 * (`isDuplicate: true`) renders as a compact one-line cross-reference to
 * whichever surface owns the full record — never a second full copy, and
 * never silently dropped either.
 */
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
                    {findings.map(({ finding, isDuplicate, primarySurface }) =>
                        isDuplicate ? (
                            <li className="record record--reference" key={finding.finding_id}>
                                {humanizeTerm(finding.kind)} — already shown in full under{" "}
                                {SURFACE_LABEL[primarySurface]}.
                            </li>
                        ) : (
                            <li className="record" key={finding.finding_id}>
                                <div className="record__head">
                                    <span className="record__title">
                                        {humanizeTerm(finding.kind)}
                                    </span>
                                    {finding.subjects !== undefined &&
                                    finding.subjects.length > 0 ? (
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
                        ),
                    )}
                </ul>
            )}
        </section>
    );
}
