"use client";

import { useId } from "react";

import { Badge } from "@/components/Badge";
import { EvidenceReferences } from "@/components/EvidenceReferences";
import type { InvestigationResult, SubjectCandidate } from "@/lib/contracts";
import { candidateStateTone, formatConfidence, humanizeTerm } from "@/lib/presentation";
import { CANNOT_REASK_HERE_COPY } from "@/lib/vocab-mapping";

export type ClarificationChoice = {
    readonly result_id: string;
    readonly receipt_id: string;
};

const EMPTY_SELECTED_RECEIPT_IDS: ReadonlySet<string> = new Set();

export type ClarificationPanelProps = {
    readonly result: InvestigationResult;
    /** The candidate receipt ids selected so far, owned by the caller (mirrors `StructureNeedsPanel`'s `batch`). */
    readonly selectedReceiptIds?: ReadonlySet<string> | undefined;
    /**
     * Called when a candidate's own Select/Unselect control is toggled.
     * Absent when the surrounding surface cannot re-ask.
     *
     * The panel still renders the prompt and the candidates — a clarification
     * must never be reduced to an ordinary answer just because this particular
     * context cannot act on it. It says so instead.
     */
    readonly onToggle?: ((receiptId: string) => void) | undefined;
    /**
     * CHAOS-4343 items 1/2: accumulate-and-re-ask-PER-PICK, the same UX
     * discipline `StructureNeedsPanel`'s own "Ask again with these
     * selections" already holds — selecting leads, confirming follows.
     * Unlike a structure member (one pick, one shared re-ask), each selected
     * candidate becomes its OWN independent turn-2 request: `choices` is
     * every currently-selected candidate, in ACR's own ranked order, and the
     * caller fires one request PER entry, each getting its own result panel
     * and its own pending/answered/failed status.
     */
    readonly onConfirm?: ((choices: readonly ClarificationChoice[]) => void) | undefined;
    readonly pending?: boolean | undefined;
};

/**
 * The disambiguation flow (CHAOS-3738; multi-select CHAOS-4343).
 *
 * When ACR cannot commit a subject it returns `clarification_required` with
 * ranked candidates, and the tester picks one or more. This is one of the
 * Workbench's few authorized interactions — and, until CHAOS-3810 lands, it is
 * expected to be the FIRST real non-error result the Workbench ever renders,
 * so it is built to be read as carefully as an answer.
 *
 * Each choice is carried back as ACR's own `receipt_id`, not as a re-typed
 * subject name. That matters for the read-only boundary: the Workbench never
 * names or authorizes a subject on the tester's behalf, it hands back an
 * identifier ACR issued. Candidates outside the result cannot be chosen because
 * the UI can only offer what the result contains.
 *
 * Candidates are shown in the order ACR ranked them. The Workbench does not
 * re-sort by confidence or anything else: the ranking is part of the answer,
 * and re-ordering it would be the presentation layer quietly forming a judgment.
 */
function CandidateRecord({
    candidate,
    rank,
    pending,
    selected,
    onToggle,
}: {
    readonly candidate: SubjectCandidate;
    readonly rank: number;
    readonly pending: boolean;
    readonly selected: boolean;
    readonly onToggle: (() => void) | undefined;
}) {
    return (
        <li className="record">
            <div className="record__head">
                <span className="record__meta">#{rank}</span>
                <span className="record__title">{candidate.subject.label}</span>
                <Badge tone={candidateStateTone(candidate.state)} title={candidate.state}>
                    {humanizeTerm(candidate.state)}
                </Badge>
                {selected ? (
                    <Badge tone="ok" title="selected">
                        selected
                    </Badge>
                ) : null}
                <span className="record__meta">
                    {candidate.subject.kind} · {candidate.subject.canonical_id} · confidence{" "}
                    {formatConfidence(candidate.confidence)}
                </span>
            </div>
            <ul className="stack stack--tight record__body">
                {candidate.match_reasons.map((reason) => (
                    <li className="record__meta" key={reason}>
                        {reason}
                    </li>
                ))}
            </ul>
            <EvidenceReferences evidenceRefIds={candidate.evidence_ref_ids} label="Evidence" />
            <p className="record__meta">
                receipt <code>{candidate.receipt_id}</code>
            </p>
            {onToggle === undefined ? null : (
                <button
                    aria-pressed={selected}
                    className="question-form__submit"
                    type="button"
                    disabled={pending}
                    onClick={onToggle}
                >
                    {selected
                        ? `Unselect ${candidate.subject.label}`
                        : `Select ${candidate.subject.label}`}
                </button>
            )}
        </li>
    );
}

export function ClarificationPanel({
    result,
    selectedReceiptIds = EMPTY_SELECTED_RECEIPT_IDS,
    onToggle,
    onConfirm,
    pending = false,
}: ClarificationPanelProps) {
    // Portability/multi-instance safety (CHAOS-4343: item 2 makes several
    // simultaneous ClarificationPanel instances — one per stacked turn — the
    // COMMON case, not a rare edge case): a hardcoded heading id broke
    // `aria-labelledby` the moment two instances shared the DOM, the same
    // class of bug `StructureNeedsPanel` already fixed with `useId()` (see
    // that component's own header comment for why).
    const idPrefix = useId();
    const { candidates, clarification_prompt: prompt } = result.subject_resolution;
    const selectedCount = candidates.filter((candidate) =>
        selectedReceiptIds.has(candidate.receipt_id),
    ).length;

    return (
        <section className="panel" aria-labelledby={`${idPrefix}-clarification-title`}>
            {/* Callback-aware, like the wrapper copy. An interrogative heading
                over candidates the reader cannot choose is promise-shaped text,
                and it is OUR chrome — so it adapts. ACR's clarification_prompt
                below stays verbatim whatever the context, because that is data,
                not chrome, and the inspection-only line covers it. */}
            <h2 className="panel__title" id={`${idPrefix}-clarification-title`}>
                {onConfirm === undefined ? "Subject candidates" : "Which subject did you mean?"}
            </h2>
            {prompt === undefined ? (
                <p className="answer__body">
                    ACR could not commit to a subject and asked for a choice.
                </p>
            ) : (
                // The service's own wording. The Workbench never writes a
                // clarification prompt of its own.
                <p className="answer__body">{prompt}</p>
            )}
            {result.interpretation.clarification_reason === undefined ? null : (
                <p className="record__meta">{result.interpretation.clarification_reason}</p>
            )}
            {onConfirm === undefined ? (
                <p className="record__meta" data-testid="cannot-choose-here">
                    {CANNOT_REASK_HERE_COPY}
                </p>
            ) : null}

            {candidates.length === 0 ? (
                // A clarification with nothing to choose is a dead end, and
                // saying so is more useful than an empty list that looks like a
                // loading state.
                <p className="panel__empty">
                    No candidates were offered, so there is nothing to choose. Try a more specific
                    question.
                </p>
            ) : (
                <ul className="stack">
                    {candidates.map((candidate, index) => (
                        <CandidateRecord
                            candidate={candidate}
                            key={candidate.receipt_id}
                            onToggle={
                                onToggle === undefined
                                    ? undefined
                                    : () => {
                                          onToggle(candidate.receipt_id);
                                      }
                            }
                            pending={pending}
                            rank={index + 1}
                            selected={selectedReceiptIds.has(candidate.receipt_id)}
                        />
                    ))}
                </ul>
            )}

            {candidates.length === 0 || onConfirm === undefined ? null : (
                <button
                    className="question-form__submit"
                    disabled={pending || selectedCount === 0}
                    onClick={() => {
                        // Built from `candidates` in ACR's OWN order (never
                        // selection-click order — the same "never re-sort"
                        // rule this panel already holds for rendering).
                        onConfirm(
                            candidates
                                .filter((candidate) => selectedReceiptIds.has(candidate.receipt_id))
                                .map((candidate) => ({
                                    result_id: result.result_id,
                                    receipt_id: candidate.receipt_id,
                                })),
                        );
                    }}
                    type="button"
                >
                    {selectedCount === 0
                        ? "Ask about the selected candidates"
                        : `Ask about ${String(selectedCount)} selected candidate${selectedCount === 1 ? "" : "s"}`}
                </button>
            )}
        </section>
    );
}
