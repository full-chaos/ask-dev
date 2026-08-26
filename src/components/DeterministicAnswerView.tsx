import { AnswerPanel } from "@/components/AnswerPanel";
import { ChoiceNotice } from "@/components/ChoiceNotice";
import { ClarificationPanel, type ClarificationChoice } from "@/components/ClarificationPanel";
import { CoveragePanel } from "@/components/CoveragePanel";
import { EvidenceReferences } from "@/components/EvidenceReferences";
import { FindingsPanel } from "@/components/FindingsPanel";
import { PriorSubjectReceiptDisclosure } from "@/components/PriorSubjectReceiptDisclosure";
import { StructureConfirmationNotice } from "@/components/StructureConfirmationNotice";
import { StructureNeedsPanel } from "@/components/StructureNeedsPanel";
import { SubjectResolutionPanel } from "@/components/SubjectResolutionPanel";
import { choiceDisposition } from "@/lib/clarification";
import type {
    BoundStructureReceipt,
    InvestigationResult,
    StructureNeedKind,
    SubjectRef,
} from "@/lib/contracts";
import {
    EMPTY_STRUCTURE_SELECTION_BATCH,
    type StructureSelectionBatch,
} from "@/lib/structure-selections";

export type DeterministicAnswerViewProps = {
    readonly result: InvestigationResult;
    /**
     * CHAOS-4343 items 1/2: the candidate receipt ids selected so far on
     * THIS result, owned by the caller — same "shared across every
     * simultaneous rendering" rule `structureBatch` already holds below.
     */
    readonly selectedCandidateReceiptIds?: ReadonlySet<string> | undefined;
    /** Toggles one candidate's selection. Supplied when the surface can re-ask. */
    readonly onToggleCandidate?: ((receiptId: string) => void) | undefined;
    /**
     * Fires once per confirmed selection (see `ClarificationPanel`'s own
     * `onConfirm` doc comment): the caller re-asks about EVERY entry in
     * `choices`, each as its own independent turn-2 request.
     */
    readonly onConfirmCandidates?: ((choices: readonly ClarificationChoice[]) => void) | undefined;
    /** CHAOS-3927 P2: supplied when the surface can re-ask with structure receipts. */
    readonly onConfirmStructure?: ((batch: StructureSelectionBatch) => void) | undefined;
    /**
     * The shared selection batch (codex round 3): owned by the caller, not
     * this view, because the SAME StructureNeedsPanel offers are also
     * rendered in the raw inspector view — a tester switching between them
     * must not lose their picks. Defaults to empty for callers (this
     * repo's other DeterministicAnswerView call sites) that never offer a
     * re-ask and so have no batch to share.
     */
    readonly structureBatch?: StructureSelectionBatch | undefined;
    readonly onToggleStructure?:
        ((member: StructureNeedKind, receipt: BoundStructureReceipt) => void) | undefined;
    /**
     * CHAOS-4171: threaded the same way as `onToggleStructure` — defaults
     * to a harmless no-op below, because the rejection branch it feeds can
     * only fire once `StructureNeedsPanel` is mounted, which itself only
     * happens when a caller has already supplied `onConfirmStructure`.
     */
    readonly onRejectStructure?: ((member: StructureNeedKind) => void) | undefined;
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
const EMPTY_SELECTED_CANDIDATE_RECEIPT_IDS: ReadonlySet<string> = new Set();

export function DeterministicAnswerView({
    result,
    selectedCandidateReceiptIds = EMPTY_SELECTED_CANDIDATE_RECEIPT_IDS,
    onToggleCandidate,
    onConfirmCandidates,
    onConfirmStructure,
    structureBatch = EMPTY_STRUCTURE_SELECTION_BATCH,
    // No-op default: harmless, because the offer buttons that would call it
    // only render when onConfirmStructure is ALSO supplied (see
    // StructureNeedsPanel's own onConfirm-gated rendering), and any caller
    // wiring one without the other is a call-site bug, not a runtime path.
    onToggleStructure = () => {},
    onRejectStructure = () => {},
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
            // Keyed by result_id (codex round 1): resets the panel's own
            // local (non-selection) UI state — e.g. a namespace-mismatch
            // alert — per result. `batch`/`onToggle` are lifted to the
            // caller (codex round 3), so the SELECTION itself survives a
            // switch to the raw view's own instance of this panel.
            <StructureNeedsPanel
                key={result.result_id}
                batch={structureBatch}
                onConfirm={onConfirmStructure}
                onReject={onRejectStructure}
                onToggle={onToggleStructure}
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
            // `data-state` mirrors `result.status` VERBATIM — a discriminating
            // hook for tests, distinct from `aria-label` (which stays
            // "Deterministic answer" in both branches below on purpose: the
            // component's accessible identity does not change just because
            // its content does). Without this, "the article is present" and
            // "the article is present AND the result is actually decisive"
            // are indistinguishable to a query, which let a chat-surface e2e
            // regression pass vacuously — see tests/chat.spec.ts's positive
            // clarification-chip control.
            <article aria-label="Deterministic answer" data-state={result.status}>
                {notice}
                {
                    // codex finding (CHAOS-4171 PR3): `prior_subject_receipt_dispositions`
                    // can be present on a `clarification_required` result too — a
                    // prior choice can be dropped in the SAME turn a fresh
                    // clarification is asked, which is exactly when a tester
                    // most needs to see it. `SubjectResolutionPanel` (used
                    // below in the decisive branch) is not rendered here — it
                    // would duplicate ClarificationPanel's own candidate list
                    // — so this shares the disclosure component directly.
                }
                <PriorSubjectReceiptDisclosure
                    dispositions={result.subject_resolution.prior_subject_receipt_dispositions}
                />
                {structureConfirmationNotice}
                {structureNeedsPanel}
                <ClarificationPanel
                    onConfirm={onConfirmCandidates}
                    onToggle={onToggleCandidate}
                    pending={pending}
                    result={result}
                    selectedReceiptIds={selectedCandidateReceiptIds}
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
        <article aria-label="Deterministic answer" data-state={result.status}>
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
