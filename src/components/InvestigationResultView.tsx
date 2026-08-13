import { AnswerPanel } from "@/components/AnswerPanel";
import { Badge } from "@/components/Badge";
import { CoveragePanel } from "@/components/CoveragePanel";
import { EvidenceReferences } from "@/components/EvidenceReferences";
import { FindingsPanel } from "@/components/FindingsPanel";
import { SubjectResolutionPanel } from "@/components/SubjectResolutionPanel";
import type { InvestigationResult } from "@/lib/contracts";
import { humanizeTerm, statusTone } from "@/lib/presentation";

export type InvestigationResultViewProps = {
    readonly result: InvestigationResult;
};

/**
 * Renders one investigation result.
 *
 * Section order follows what a reader needs to trust the answer: what was said,
 * who it is about, what is left, what could not be read, and what the service
 * itself said it cannot support. Limitations and coverage are never collapsed
 * away or shown only on failure.
 */
export function InvestigationResultView({ result }: InvestigationResultViewProps) {
    return (
        <article aria-label="Investigation result">
            <div className="result__head">
                <h2 className="result__question">{result.question}</h2>
                <Badge tone={statusTone(result.status)} title={result.status}>
                    {humanizeTerm(result.status)}
                </Badge>
                {result.reused ? (
                    <Badge tone="neutral" title="reused">
                        reused
                    </Badge>
                ) : null}
            </div>

            <AnswerPanel result={result} />
            <SubjectResolutionPanel resolution={result.subject_resolution} />
            <FindingsPanel
                title="Remaining work"
                findings={result.remaining_work}
                emptyMessage="No remaining work was reported."
            />
            <FindingsPanel
                title="Readiness gaps"
                findings={result.readiness_gaps}
                emptyMessage="No readiness gaps were reported."
            />
            <FindingsPanel
                title="Conflicts"
                findings={result.conflicts}
                emptyMessage="No conflicting evidence was reported."
            />
            <CoveragePanel coverage={result.coverage} />

            <section className="panel" aria-labelledby="limitations-title">
                <h2 className="panel__title" id="limitations-title">
                    Limitations
                </h2>
                {result.limitations.length === 0 ? (
                    <p className="panel__empty">The service reported no limitations.</p>
                ) : (
                    <ul className="stack stack--tight">
                        {result.limitations.map((limitation) => (
                            <li className="record" key={limitation}>
                                {limitation}
                            </li>
                        ))}
                    </ul>
                )}
                {result.warnings.length > 0 ? (
                    <>
                        <h3 className="panel__title" style={{ marginTop: 14 }}>
                            Warnings
                        </h3>
                        <ul className="stack stack--tight">
                            {result.warnings.map((warning) => (
                                <li className="record" key={warning}>
                                    {warning}
                                </li>
                            ))}
                        </ul>
                    </>
                ) : null}
            </section>

            <section className="panel" aria-labelledby="evidence-title">
                <h2 className="panel__title" id="evidence-title">
                    Evidence references
                </h2>
                {result.evidence_ref_ids.length === 0 ? (
                    <p className="panel__empty">No evidence was referenced.</p>
                ) : (
                    <EvidenceReferences evidenceRefIds={result.evidence_ref_ids} />
                )}
            </section>

            <section className="panel" aria-labelledby="versions-title">
                <h2 className="panel__title" id="versions-title">
                    Provenance
                </h2>
                <dl className="versions">
                    {Object.entries(result.versions).map(([name, value]) => (
                        <div key={name}>
                            <dt>{humanizeTerm(name)}</dt>
                            <dd>{String(value)}</dd>
                        </div>
                    ))}
                    <div>
                        <dt>result id</dt>
                        <dd>{result.result_id}</dd>
                    </div>
                    <div>
                        <dt>generated at</dt>
                        <dd>{result.generated_at}</dd>
                    </div>
                </dl>
            </section>
        </article>
    );
}
