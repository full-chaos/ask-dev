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
                                <p className="record__body">
                                    {/*
                                     * codex round 3, finding 3: `primarySurface` is a
                                     * DOMAIN ranking (see fact-dedup's `SURFACE_PRIORITY`
                                     * doc comment), not this page's render order — the
                                     * primary can render BELOW this reference. "already"
                                     * would be a false positional claim in that case.
                                     */}
                                    {humanizeTerm(finding.kind)} — also shown in full under{" "}
                                    {SURFACE_LABEL[primarySurface]}.
                                </p>
                                {/*
                                 * codex round 5: `subjects` is independent, optional
                                 * contract data — equal `claimed_fact_ids`/text does NOT
                                 * guarantee equal subject scope (a primary about "Alpha"
                                 * and a same-claim duplicate about "Beta" are both real).
                                 * Same never-silently-drop reasoning as the evidence block
                                 * below, just a different field.
                                 */}
                                {finding.subjects !== undefined && finding.subjects.length > 0 ? (
                                    <p className="record__meta">
                                        {finding.subjects
                                            .map((subject) => subject.label)
                                            .join(", ")}
                                    </p>
                                ) : null}
                                {/*
                                 * codex round 2, finding 3: the cross-referenced primary
                                 * lives on a DIFFERENT `FindingsPanel` instance (a different
                                 * surface's own render), so this component has no way to
                                 * diff this duplicate's evidence against it. Always
                                 * rendering this occurrence's OWN evidence here — even when
                                 * it duplicates the primary's — is the only way to never
                                 * silently drop evidence unique to this occurrence.
                                 */}
                                <EvidenceReferences
                                    evidenceRefIds={finding.evidence_ref_ids}
                                    label="Evidence"
                                />
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
