import { Badge } from "@/components/Badge";
import { EvidenceReferences } from "@/components/EvidenceReferences";
import type { InvestigationResult, RelationshipPath, SubjectRef } from "@/lib/contracts";
import { formatConfidence, humanizeTerm } from "@/lib/presentation";

export type CanonicalResultInspectorProps = {
    readonly result: InvestigationResult;
};

function subjectLabel(subject: SubjectRef): string {
    return `${subject.label} · ${subject.kind} · ${subject.canonical_id}`;
}

function PathRecord({ path }: { readonly path: RelationshipPath }) {
    return (
        <li className="record">
            <div className="record__head">
                <span className="record__title">{path.path_id}</span>
                {path.truncated ? (
                    <Badge tone="warn" title="truncated">
                        truncated
                    </Badge>
                ) : null}
            </div>
            {path.why_relevant !== undefined ? (
                <p className="record__body">{path.why_relevant}</p>
            ) : null}
            <ul className="stack stack--tight record__body">
                {path.edges.map((edge, index) => (
                    <li className="record__meta" key={`${path.path_id}-edge-${index}`}>
                        <code>{edge.from.label}</code> —{edge.type}→ <code>{edge.to.label}</code> ·{" "}
                        {humanizeTerm(edge.derivation)} · {humanizeTerm(edge.epistemic_status)}
                        {edge.observed_at === undefined ? "" : ` · observed ${edge.observed_at}`}
                    </li>
                ))}
            </ul>
            <EvidenceReferences evidenceRefIds={path.evidence_ref_ids} label="Evidence" />
        </li>
    );
}

/**
 * The canonical result inspector — the complete ACR result with its structure
 * UNHIDDEN (CHAOS-3738).
 *
 * This view exists so presentation can never mask an answer-quality failure. It
 * shows what the deterministic and enriched views summarize or omit: bound
 * receipts, the analytical goal and scope, cohort membership with its
 * inclusion and exclusion rationale, relationship and evidence paths, canonical
 * facts, every version stamp, and the raw contract payload.
 *
 * Nothing here is filtered for readability. If a field is in the result, it is
 * on this page.
 */
export function CanonicalResultInspector({ result }: CanonicalResultInspectorProps) {
    const interpretation = result.interpretation;
    return (
        <article aria-label="Canonical result inspector">
            <section className="panel" aria-labelledby="goal-title">
                <h2 className="panel__title" id="goal-title">
                    Analytical goal and scope
                </h2>
                <dl className="versions">
                    <div>
                        <dt>shape</dt>
                        <dd>{interpretation.shape}</dd>
                    </div>
                    <div>
                        <dt>requested judgment</dt>
                        <dd>{interpretation.requested_judgment}</dd>
                    </div>
                    <div>
                        <dt>time axis</dt>
                        <dd>{interpretation.time_context.axis}</dd>
                    </div>
                    <div>
                        <dt>clarification needed</dt>
                        <dd>{String(interpretation.clarification_needed)}</dd>
                    </div>
                </dl>
                {interpretation.clarification_reason !== undefined ? (
                    <p className="record__meta">{interpretation.clarification_reason}</p>
                ) : null}
                <h3 className="panel__title" style={{ marginTop: 14 }}>
                    Subject terms
                </h3>
                {interpretation.subject_terms === undefined ||
                interpretation.subject_terms.length === 0 ? (
                    <p className="panel__empty">No subject terms were extracted.</p>
                ) : (
                    <ul className="evidence-list">
                        {interpretation.subject_terms.map((term) => (
                            <li className="evidence-ref" key={term}>
                                {term}
                            </li>
                        ))}
                    </ul>
                )}
                <h3 className="panel__title" style={{ marginTop: 14 }}>
                    Fact requirements
                </h3>
                {interpretation.fact_requirements.length === 0 ? (
                    <p className="panel__empty">No fact requirements were planned.</p>
                ) : (
                    <ul className="stack stack--tight">
                        {interpretation.fact_requirements.map((requirement, index) => (
                            <li className="record" key={`${requirement.kind}-${index}`}>
                                <span className="record__title">{requirement.kind}</span>
                                <p className="record__meta">
                                    {(requirement.subjects ?? []).map(subjectLabel).join(" | ") ||
                                        "no subjects"}
                                </p>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="panel" aria-labelledby="receipts-title">
                <h2 className="panel__title" id="receipts-title">
                    Resolved subjects and bound receipts
                </h2>
                {result.subject_resolution.candidates.length === 0 ? (
                    <p className="panel__empty">No candidates were proposed.</p>
                ) : (
                    <ul className="stack stack--tight">
                        {result.subject_resolution.candidates.map((candidate) => (
                            <li className="record" key={candidate.receipt_id}>
                                <div className="record__head">
                                    <span className="record__title">
                                        {subjectLabel(candidate.subject)}
                                    </span>
                                    <Badge tone="neutral" title={candidate.state}>
                                        {humanizeTerm(candidate.state)}
                                    </Badge>
                                </div>
                                <p className="record__meta">
                                    receipt <code>{candidate.receipt_id}</code> · confidence{" "}
                                    {formatConfidence(candidate.confidence)}
                                </p>
                            </li>
                        ))}
                    </ul>
                )}
                <h3 className="panel__title" style={{ marginTop: 14 }}>
                    Committed
                </h3>
                {result.subject_resolution.committed.length === 0 ? (
                    <p className="panel__empty">Nothing was committed.</p>
                ) : (
                    <ul className="stack stack--tight">
                        {result.subject_resolution.committed.map((subject) => (
                            <li className="record__meta" key={subject.canonical_id}>
                                {subjectLabel(subject)}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="panel" aria-labelledby="cohort-title">
                <h2 className="panel__title" id="cohort-title">
                    Cohort
                </h2>
                {result.cohort === undefined ? (
                    <p className="panel__empty">This result carries no cohort.</p>
                ) : (
                    <>
                        <p className="record__meta">
                            {result.cohort.kind} · {result.cohort.members.length} members ·{" "}
                            {result.cohort.complete ? "complete" : "incomplete"}
                            {result.cohort.truncated === true ? " · truncated" : ""}
                        </p>
                        {result.cohort.rationale !== undefined ? (
                            <p className="answer__body">{result.cohort.rationale}</p>
                        ) : null}
                        <ul className="stack stack--tight">
                            {result.cohort.members.map((member) => (
                                <li className="record" key={member.subject.canonical_id}>
                                    <span className="record__title">
                                        {subjectLabel(member.subject)}
                                    </span>
                                    <p className="record__meta">
                                        {(member.inclusion_reasons ?? []).join("; ") ||
                                            "no inclusion reason given"}
                                    </p>
                                </li>
                            ))}
                        </ul>
                        <h3 className="panel__title" style={{ marginTop: 14 }}>
                            Exclusions
                        </h3>
                        {result.cohort.exclusions === undefined ||
                        result.cohort.exclusions.length === 0 ? (
                            <p className="panel__empty">Nothing was excluded.</p>
                        ) : (
                            <ul className="stack stack--tight">
                                {result.cohort.exclusions.map((exclusion) => (
                                    <li className="record" key={exclusion.subject.canonical_id}>
                                        <span className="record__title">
                                            {subjectLabel(exclusion.subject)}
                                        </span>
                                        <p className="record__meta">{exclusion.reason}</p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </>
                )}
            </section>

            <section className="panel" aria-labelledby="paths-title">
                <h2 className="panel__title" id="paths-title">
                    Relationship and evidence paths
                </h2>
                {result.paths.length === 0 ? (
                    <p className="panel__empty">No paths were returned.</p>
                ) : (
                    <ul className="stack">
                        {result.paths.map((path) => (
                            <PathRecord key={path.path_id} path={path} />
                        ))}
                    </ul>
                )}
            </section>

            <section className="panel" aria-labelledby="facts-title">
                <h2 className="panel__title" id="facts-title">
                    Canonical facts
                </h2>
                {result.claimed_facts.length === 0 ? (
                    <p className="panel__empty">No canonical facts were claimed.</p>
                ) : (
                    <ul className="stack stack--tight">
                        {result.claimed_facts.map((fact) => (
                            <li className="record" key={fact.claim_id}>
                                <span className="record__title">
                                    {fact.kind} · {fact.field}
                                </span>
                                <p className="record__meta">
                                    {subjectLabel(fact.subject)} ={" "}
                                    <code>{JSON.stringify(fact.value)}</code>
                                </p>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="panel" aria-labelledby="versions-title">
                <h2 className="panel__title" id="versions-title">
                    Projection, query, rule, and backend versions
                </h2>
                <dl className="versions">
                    {/* Sorted, not insertion-ordered. An inspector whose field
                        order depends on JSON key order makes two runs of the
                        same investigation look different for no reason, and
                        diffing them becomes unreliable. */}
                    {Object.entries(result.versions)
                        .sort(([left], [right]) => left.localeCompare(right))
                        .map(([name, value]) => (
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
                        <dt>request id</dt>
                        <dd>{result.request_id}</dd>
                    </div>
                    <div>
                        <dt>generated at</dt>
                        <dd>{result.generated_at}</dd>
                    </div>
                    <div>
                        <dt>reused</dt>
                        <dd>{String(result.reused)}</dd>
                    </div>
                </dl>
            </section>

            <section className="panel" aria-labelledby="raw-title">
                <h2 className="panel__title" id="raw-title">
                    Raw contract payload
                </h2>
                <p className="record__meta">
                    The immutable result exactly as ACR returned it, after schema validation.
                </p>
                <pre className="raw-payload">
                    <code>{JSON.stringify(result, null, 2)}</code>
                </pre>
            </section>
        </article>
    );
}
