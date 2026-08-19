import { AnswerPanel } from "@/components/AnswerPanel";
import { ChoiceNotice } from "@/components/ChoiceNotice";
import { ClarificationPanel, type ClarificationChoice } from "@/components/ClarificationPanel";
import { CoveragePanel } from "@/components/CoveragePanel";
import { EvidenceReferences } from "@/components/EvidenceReferences";
import { FindingsPanel } from "@/components/FindingsPanel";
import { StructureConfirmationNotice } from "@/components/StructureConfirmationNotice";
import { StructureNeedsPanel } from "@/components/StructureNeedsPanel";
import { SubjectResolutionPanel } from "@/components/SubjectResolutionPanel";
import { choiceDisposition } from "@/lib/clarification";
import type { PivotAwareInvestigationResult, SubjectRef } from "@/lib/contracts";
import type { StructureSelectionBatch } from "@/lib/structure-selections";

export type DeterministicAnswerViewProps = {
    readonly result: PivotAwareInvestigationResult;
    /** Supplied when the surface can re-ask; omitted in read-only contexts. */
    readonly onChooseCandidate?: ((choice: ClarificationChoice) => void) | undefined;
    /** CHAOS-3927 P2: supplied when the surface can re-ask with structure receipts. */
    readonly onConfirmStructure?: ((batch: StructureSelectionBatch) => void) | undefined;
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
    onConfirmStructure,
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
    //
    // This is INTRINSIC to the component, not conditional on a callback. It was
    // conditional, and that left every call site free to compose a clarification
    // into the normal answer shape by simply not passing one — the same dead end
    // as C3 and R3, reached a third way. Without a callback the panel renders
    // the prompt and candidates and says it cannot re-ask here; it never
    // degrades to the answer layout.
    // CHAOS-3927 P2: rendered above the subject candidates, per the design
    // brief's own elicitation-priority ordering (§2.2) — kind/anchor/handle
    // narrow WHICH subject before a subject candidate list would even help.
    // `structure_needs` and `confirmed_structure` render EXACTLY what the
    // result carries; see StructureNeedsPanel/StructureConfirmationNotice for
    // the boundary pins (never re-rank, never invent, receipts only).
    const structureNeedsPanel =
        result.structure_needs === undefined ? null : (
            // Keyed by result_id (codex round 1): StructureNeedsPanel holds
            // its accumulated selections in local state, and a re-ask that
            // returns a NEW result must not let a stale selection from the
            // PRIOR result's offers survive into it — the key forces a fresh
            // component instance per result, the same fix React's own docs
            // prescribe for "reset state when a prop changes".
            <StructureNeedsPanel
                key={result.result_id}
                onConfirm={onConfirmStructure}
                pending={pending}
                resultId={result.result_id}
                structureNeeds={result.structure_needs}
            />
        );
    const structureConfirmationNotice = (
        <StructureConfirmationNotice entries={result.confirmed_structure} />
    );

    if (result.status === "clarification_required") {
        return (
            <article aria-label="Deterministic answer">
                {notice}
                {structureConfirmationNotice}
                {structureNeedsPanel}
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
            {structureConfirmationNotice}
            {structureNeedsPanel}
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
