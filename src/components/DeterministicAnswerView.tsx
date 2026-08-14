import { AnswerPanel } from "@/components/AnswerPanel";
import { ChoiceNotice } from "@/components/ChoiceNotice";
import { ClarificationPanel, type ClarificationChoice } from "@/components/ClarificationPanel";
import { CoveragePanel } from "@/components/CoveragePanel";
import { EvidenceReferences } from "@/components/EvidenceReferences";
import { FindingsPanel } from "@/components/FindingsPanel";
import { SubjectResolutionPanel } from "@/components/SubjectResolutionPanel";
import { choiceDisposition } from "@/lib/clarification";
import type { InvestigationResult, SubjectRef } from "@/lib/contracts";

export type DeterministicAnswerViewProps = {
    readonly result: InvestigationResult;
    /** Supplied when the surface can re-ask; omitted in read-only contexts. */
    readonly onChooseCandidate?: ((choice: ClarificationChoice) => void) | undefined;
    readonly pending?: boolean | undefined;
    /** The subject the tester chose, when this result came from a re-ask. */
    readonly chosenSubject?: SubjectRef | undefined;
};

/**
 * The deterministic answer view — the REFERENCE answer and the fallback
 * (CHAOS-3738).
 *
 * A native component set renders the result directly. No model is involved and
 * nothing is inferred: every value on screen comes from the immutable result.
 * When M3's enriched view fails its pre-render validation, this is what the
 * tester sees instead, and the answer must be identical.
 *
 * Section order follows what a reader needs to trust the answer: what was said,
 * who it is about, what is left, what could not be read, and what the service
 * itself said it cannot support. Coverage and limitations are never collapsed
 * away and never shown only on failure.
 */
export function DeterministicAnswerView({
    result,
    onChooseCandidate,
    pending = false,
    chosenSubject,
}: DeterministicAnswerViewProps) {
    // Rendered in BOTH branches below. A dishonoured choice is invisible
    // otherwise: an answer reads as being about the chosen subject, and a second
    // clarification reads as an ordinary one.
    const notice =
        chosenSubject === undefined ? null : (
            <ChoiceNotice
                chosen={chosenSubject}
                disposition={choiceDisposition(result, chosenSubject)}
            />
        );

    // A clarification is not a failed answer, and must not be rendered as a
    // thin one. When ACR asks for a choice, the choice IS the content: it leads,
    // and the (empty) judgment panels do not appear above it competing for
    // attention.
    const needsClarification =
        result.status === "clarification_required" && onChooseCandidate !== undefined;

    if (needsClarification) {
        return (
            <article aria-label="Deterministic answer">
                {notice}
                <ClarificationPanel
                    onChoose={onChooseCandidate}
                    pending={pending}
                    result={result}
                />
                <CoveragePanel coverage={result.coverage} />
                <section className="panel" aria-labelledby="clarification-limitations-title">
                    <h2 className="panel__title" id="clarification-limitations-title">
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
                </section>
            </article>
        );
    }

    return (
        <article aria-label="Deterministic answer">
            {notice}
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
        </article>
    );
}
