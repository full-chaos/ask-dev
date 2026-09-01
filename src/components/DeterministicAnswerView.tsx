import { useId } from "react";

import { AnswerPanel } from "@/components/AnswerPanel";
import { AnswerPlanPanel } from "@/components/AnswerPlanPanel";
import { ChoiceNotice } from "@/components/ChoiceNotice";
import { ChosenAnswersSummaryCard } from "@/components/ChosenAnswersSummaryCard";
import { ClarificationPanel, type ClarificationChoice } from "@/components/ClarificationPanel";
import { CohortGroupsPanel } from "@/components/CohortGroupsPanel";
import { CohortRankingPanel } from "@/components/CohortRankingPanel";
import { CompletenessPanel } from "@/components/CompletenessPanel";
import { CoveragePanel } from "@/components/CoveragePanel";
import { DriversPanel } from "@/components/DriversPanel";
import { EvidenceReferences } from "@/components/EvidenceReferences";
import { FactRowsPanels } from "@/components/FactRowsPanel";
import { FindingsPanel } from "@/components/FindingsPanel";
import { LimitationsPanel } from "@/components/LimitationsPanel";
import { PriorSubjectReceiptDisclosure } from "@/components/PriorSubjectReceiptDisclosure";
import { StructureConfirmationNotice } from "@/components/StructureConfirmationNotice";
import { StructureNeedsPanel } from "@/components/StructureNeedsPanel";
import { SubjectResolutionPanel } from "@/components/SubjectResolutionPanel";
import { choiceDisposition } from "@/lib/clarification";
import { isCohortIntent, rankingTable } from "@/lib/cohort-ranking";
import type {
    BoundStructureReceipt,
    InvestigationResult,
    StructureNeedKind,
    SubjectRef,
} from "@/lib/contracts";
import { dedupeFindings, identityLimitations } from "@/lib/fact-dedup";
import {
    EMPTY_STRUCTURE_SELECTION_BATCH,
    type StructureSelectionBatch,
} from "@/lib/structure-selections";
import { hasVetoedStructureConfirmation, structureMemberLabel } from "@/lib/structure-disposition";

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
    /**
     * CHAOS-4343 items 1/2: the STRUCTURE_NEEDS candidate axis
     * (`candidate_options`, CHAOS-4012) — a SEPARATE surface from
     * `selectedCandidateReceiptIds` above (`subject_resolution.candidates`),
     * with its own receipt namespace (`candr_` via `prior_candidate_receipts`
     * vs the unconstrained `prior_subject_receipts`). Same multi-select
     * discipline: several picks, each its own turn-2 request.
     */
    readonly selectedStructureCandidateReceiptIds?: ReadonlySet<string> | undefined;
    readonly onToggleStructureCandidate?: ((receiptId: string) => void) | undefined;
    /**
     * CHAOS-3927 P2: supplied when the surface can re-ask with structure
     * receipts. `candidateReceipts` mirrors `onConfirmCandidates`'s own
     * array — every currently-selected `candidate_options` entry, one
     * request per entry.
     */
    readonly onConfirmStructure?:
        | ((
              batch: StructureSelectionBatch,
              candidateReceipts: readonly BoundStructureReceipt[],
          ) => void)
        | undefined;
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
    /**
     * CHAOS-4671: `"inline"` (default) is the UNCHANGED pre-4671 shape —
     * `/workbench` (the only other call site) always gets this, so its
     * panel-stack behavior is byte-for-byte untouched by this prop's
     * existence.
     *
     * `"popup"` is the Ask Dev chat surface: the floating
     * `ClarificationPopup` (`page.tsx`) owns every actionable offer
     * exclusively, so this view renders NEITHER `StructureNeedsPanel` NOR
     * `ClarificationPanel` inline for the LIVE turn (a callback is
     * supplied) — no duplicate "offer panel in the transcript" the ticket
     * rules out. For a FROZEN turn (no callback), it renders a collapsed
     * "how this was resolved" detail instead of the old inert panel with
     * "shown for inspection only" text — no dead controls either way. The
     * "your selections were applied" chip panel (`StructureConfirmationNotice`)
     * is likewise replaced by the compact `ChosenAnswersSummaryCard`,
     * EXCEPT when a selection was vetoed — that still needs the full alert
     * treatment, so `StructureConfirmationNotice` renders unchanged in that
     * one case regardless of `offersPresentation`.
     */
    readonly offersPresentation?: "inline" | "popup" | undefined;
};

/**
 * The frozen-turn "how this was resolved" collapsed detail (CHAOS-4671,
 * `offersPresentation === "popup"` only) — no controls, just what was asked.
 * Replaces the old inert `StructureNeedsPanel`/`ClarificationPanel` echo
 * (`data-testid="cannot-confirm-structure-here"`/`"cannot-choose-here"`),
 * which rendered every offer as a disabled-looking-but-still-a-`<button>`
 * control in a permanently dead state — exactly the "inspection only" dead
 * control the ticket rules out.
 */
function FrozenOffersDisclosure({
    missingMembers,
    subjectPrompt,
}: {
    readonly missingMembers: readonly StructureNeedKind[];
    readonly subjectPrompt: string | undefined;
}) {
    if (missingMembers.length === 0 && subjectPrompt === undefined) return null;
    return (
        <details className="disclosure" data-testid="frozen-offers-disclosure">
            <summary>How this was resolved</summary>
            <div className="stack stack--tight">
                {missingMembers.length > 0 ? (
                    <p className="record__meta">
                        Asked about:{" "}
                        {missingMembers.map((member) => structureMemberLabel(member)).join(", ")}.
                    </p>
                ) : null}
                {subjectPrompt === undefined ? null : (
                    <p className="record__meta">{subjectPrompt}</p>
                )}
            </div>
        </details>
    );
}

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
    selectedStructureCandidateReceiptIds = EMPTY_SELECTED_CANDIDATE_RECEIPT_IDS,
    onToggleStructureCandidate,
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
    offersPresentation = "inline",
}: DeterministicAnswerViewProps) {
    // Portability/multi-instance safety (codex review round 2, CHAOS-4343:
    // several DeterministicAnswerView instances now commonly coexist — one
    // per stacked turn — so a hardcoded heading id here breaks
    // `aria-labelledby` the same way it did in `ClarificationPanel` before
    // that fix, the same class `StructureNeedsPanel` already guards against
    // with `useId()`).
    const idPrefix = useId();
    // Shared by `notice` below and, in popup mode, `ChosenAnswersSummaryCard`
    // (CHAOS-4671) — one computation, not two independent calls that could
    // drift.
    const disposition =
        chosenSubject === undefined ? undefined : choiceDisposition(result, chosenSubject);
    // CHAOS-4669 defect 1: computed once, from the SAME four fields the
    // decisive branch below already renders as separate cards — see
    // `@/lib/fact-dedup`'s own header for why the answer prose itself is
    // out of scope. Unused on the `clarification_required` branch (its own
    // `LimitationsPanel` call below uses `identityLimitations` instead —
    // that branch renders no Findings panels to dedupe against), but
    // computing it unconditionally keeps this one hook call ahead of every
    // early return, matching every other hook in this component.
    const dedupedFindings = dedupeFindings({
        remaining_work: result.remaining_work,
        readiness_gaps: result.readiness_gaps,
        conflicts: result.conflicts,
        limitations: result.limitations,
    });
    // Rendered in BOTH branches below. A dishonoured choice is invisible
    // otherwise: an answer reads as being about the chosen subject, and a second
    // clarification reads as an ordinary one.
    const notice =
        chosenSubject === undefined || disposition === undefined ? null : (
            <ChoiceNotice chosen={chosenSubject} disposition={disposition} />
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
    // CHAOS-4671: in popup mode the LIVE turn's offers are owned exclusively
    // by `ClarificationPopup` (`page.tsx`, floating above the chat input) —
    // rendering them here too would be the exact "inline offer panel in the
    // transcript" the ticket rules out. A FROZEN turn (no `onConfirmStructure`)
    // gets the collapsed disclosure instead of the old inert panel.
    const isLiveInPopupMode = offersPresentation === "popup" && onConfirmStructure !== undefined;
    const isFrozenInPopupMode = offersPresentation === "popup" && onConfirmStructure === undefined;
    function renderStructureNeedsPanel() {
        if (result.structure_needs === undefined || isLiveInPopupMode) return null;
        if (isFrozenInPopupMode) {
            return (
                <FrozenOffersDisclosure
                    key={result.result_id}
                    missingMembers={result.structure_needs.missing}
                    subjectPrompt={undefined}
                />
            );
        }
        // Keyed by result_id (codex round 1): resets the panel's own local
        // (non-selection) UI state — e.g. a namespace-mismatch alert — per
        // result. `batch`/`onToggle` are lifted to the caller (codex round
        // 3), so the SELECTION itself survives a switch to the raw view's
        // own instance of this panel.
        return (
            <StructureNeedsPanel
                key={result.result_id}
                batch={structureBatch}
                onConfirm={onConfirmStructure}
                onReject={onRejectStructure}
                onToggle={onToggleStructure}
                onToggleCandidate={onToggleStructureCandidate}
                pending={pending}
                resultId={result.result_id}
                selectedCandidateReceiptIds={selectedStructureCandidateReceiptIds}
                structureNeeds={result.structure_needs}
            />
        );
    }
    const structureNeedsPanel = renderStructureNeedsPanel();
    // A veto still needs the full alert treatment regardless of presentation
    // mode — only the "everything applied cleanly" case collapses to the
    // compact card in popup mode (see `ChosenAnswersSummaryCard`'s own
    // header for why it deliberately does not cover vetoes).
    const anyVetoed = hasVetoedStructureConfirmation(result.confirmed_structure);
    const structureConfirmationNotice =
        offersPresentation === "popup" && !anyVetoed ? (
            <ChosenAnswersSummaryCard
                chosenSubject={chosenSubject}
                confirmedStructure={result.confirmed_structure}
                disposition={disposition}
            />
        ) : (
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
                {(() => {
                    const isLiveCandidatesInPopupMode =
                        offersPresentation === "popup" && onConfirmCandidates !== undefined;
                    if (isLiveCandidatesInPopupMode) return null;
                    if (offersPresentation === "popup") {
                        return (
                            <FrozenOffersDisclosure
                                missingMembers={[]}
                                subjectPrompt={
                                    result.subject_resolution.candidates.length === 0
                                        ? undefined
                                        : (result.subject_resolution.clarification_prompt ??
                                          "Which subject did you mean?")
                                }
                            />
                        );
                    }
                    return (
                        <ClarificationPanel
                            onConfirm={onConfirmCandidates}
                            onToggle={onToggleCandidate}
                            pending={pending}
                            result={result}
                            selectedReceiptIds={selectedCandidateReceiptIds}
                        />
                    );
                })()}
                <CoveragePanel coverage={result.coverage} />
                <CompletenessPanel completeness={result.completeness} />
                <AnswerPlanPanel answerPlan={result.answer_plan} />
                {
                    // codex review round 2 (CHAOS-4581): extracting the old
                    // inline Limitations block into `LimitationsPanel`
                    // (shared with the decisive branch below) means this
                    // branch now ALSO surfaces `result.warnings` — the prior
                    // inline copy here never rendered them. Deliberate, not
                    // accidental: `warnings` is unconditional on the base
                    // result type (not gated by status), a `clarification_required`
                    // result can legitimately carry them, and they are purely
                    // informational (never gate the clarification flow) — so
                    // showing them here closes a real gap rather than
                    // widening scope. Pinned by
                    // `DeterministicAnswerView.test.tsx`'s "clarification
                    // branch shows warnings" test.
                }
                <LimitationsPanel
                    limitations={identityLimitations(result.limitations)}
                    warnings={result.warnings}
                />
            </article>
        );
    }

    return (
        <article aria-label="Deterministic answer" data-state={result.status}>
            {
                // `notice` (a dishonoured prior choice) and `structureNeedsPanel`
                // (a fresh ask for more input) both change how everything BELOW
                // should be read — a dishonoured choice means the answer may not
                // even be about the subject the reader expects, and unresolved
                // structure needs mean the answer is known-incomplete. Both stay
                // first for that reason. `structureConfirmationNotice` (the
                // "your selections were applied" chip row) is provenance, not a
                // caveat — codex review round 1 flagged it sitting ahead of
                // Ranked Teams as contradicting "RANKED TEAMS leads"; it now
                // renders with `SubjectResolutionPanel` below, the panel it is
                // thematically closest to (both are "what got resolved and how").
            }
            {notice}
            {structureNeedsPanel}
            {
                // CHAOS-4669: the answer block IS the lead panel — chris's
                // 08-31 UX notes ("the answer is buried under data
                // references and charts") refine CHAOS-4581's own
                // "panels lead, prose follows" bar rather than reversing
                // it: 4581 was never "prose never leads", it was "prose
                // does not read as a WALL ahead of the decision-carrying
                // panels". `AnswerPanel` itself stayed short by
                // construction the whole time (deterministic_answer +
                // direct_judgment only; `current_state` already behind its
                // own Details) — so leading with it is not reintroducing
                // that wall, it is finishing the same fix: answer summary
                // -> rich charts -> collapsed evidence.
            }
            <AnswerPanel result={result} />
            {
                // codex review round 3 (CHAOS-4581, preserved here): the
                // ticket specifies TWO distinct sequences for the CHARTS
                // that follow the answer, not one shared order — a cohort
                // answer wants "RANKED TEAMS ... then principal driver
                // cards" (Drivers immediately after Ranked Teams), while a
                // single-subject answer wants fact rows ahead of Drivers.
                // `isCohortIntent`/`rankingTable` use the SAME gate
                // `CohortRankingPanel`/`DriversPanel` already use, so this
                // never drifts from what those panels actually decide to
                // render.
            }
            <CohortRankingPanel
                cohort={result.cohort}
                result={result}
                shape={result.interpretation.shape}
            />
            <CohortGroupsPanel cohort={result.cohort} />
            {isCohortIntent(result.interpretation.shape) &&
            result.cohort !== undefined &&
            rankingTable(result.cohort.members) !== null ? (
                <>
                    <DriversPanel result={result} />
                    <FactRowsPanels facts={result.claimed_facts} result={result} />
                </>
            ) : (
                <>
                    <FactRowsPanels facts={result.claimed_facts} result={result} />
                    <DriversPanel result={result} />
                </>
            )}
            {
                // Everything below here is the COLLAPSED EVIDENCE tier
                // (CHAOS-4669): coverage/completeness/limitations as a
                // compact strip (CSS only — each panel is still a full,
                // independently testable component; `.strip` just lays
                // them out side by side and each keeps its own
                // collapsed-by-default detail), then plan provenance,
                // selection provenance, subject resolution, findings, and
                // raw evidence references.
            }
            <div className="strip">
                <CoveragePanel coverage={result.coverage} />
                <CompletenessPanel completeness={result.completeness} />
                <LimitationsPanel
                    limitations={dedupedFindings.limitations}
                    warnings={result.warnings}
                />
            </div>
            <AnswerPlanPanel answerPlan={result.answer_plan} />
            {structureConfirmationNotice}
            <SubjectResolutionPanel
                evidenceRefLabels={result.evidence_ref_labels}
                resolution={result.subject_resolution}
            />
            <FindingsPanel
                evidenceRefLabels={result.evidence_ref_labels}
                title="Remaining work"
                findings={dedupedFindings.remaining_work}
                emptyMessage="No remaining work was reported."
            />
            <FindingsPanel
                evidenceRefLabels={result.evidence_ref_labels}
                title="Readiness gaps"
                findings={dedupedFindings.readiness_gaps}
                emptyMessage="No readiness gaps were reported."
            />
            <FindingsPanel
                evidenceRefLabels={result.evidence_ref_labels}
                title="Conflicts"
                findings={dedupedFindings.conflicts}
                emptyMessage="No conflicting evidence was reported."
            />

            <section className="panel" aria-labelledby={`${idPrefix}-evidence-title`}>
                <h2 className="panel__title" id={`${idPrefix}-evidence-title`}>
                    Evidence references
                </h2>
                {result.evidence_ref_ids.length === 0 ? (
                    <p className="panel__empty">No evidence was referenced.</p>
                ) : (
                    <EvidenceReferences
                        evidenceRefIds={result.evidence_ref_ids}
                        evidenceRefLabels={result.evidence_ref_labels}
                    />
                )}
            </section>
        </article>
    );
}
