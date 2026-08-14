"use client";

import { Badge } from "@/components/Badge";
import { EvidenceReferences } from "@/components/EvidenceReferences";
import type { InvestigationResult, SubjectCandidate } from "@/lib/contracts";
import { candidateStateTone, formatConfidence, humanizeTerm } from "@/lib/presentation";

export type ClarificationChoice = {
    readonly result_id: string;
    readonly receipt_id: string;
};

export type ClarificationPanelProps = {
    readonly result: InvestigationResult;
    readonly onChoose: (choice: ClarificationChoice) => void;
    readonly pending: boolean;
};

/**
 * The disambiguation flow (CHAOS-3738).
 *
 * When ACR cannot commit a subject it returns `clarification_required` with
 * ranked candidates, and the tester picks one. This is one of the Workbench's
 * few authorized interactions — and, until CHAOS-3810 lands, it is expected to
 * be the FIRST real non-error result the Workbench ever renders, so it is built
 * to be read as carefully as an answer.
 *
 * The choice is carried back as ACR's own `receipt_id`, not as a re-typed
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
    resultId,
    rank,
    pending,
    onChoose,
}: {
    readonly candidate: SubjectCandidate;
    readonly resultId: string;
    readonly rank: number;
    readonly pending: boolean;
    readonly onChoose: (choice: ClarificationChoice) => void;
}) {
    return (
        <li className="record">
            <div className="record__head">
                <span className="record__meta">#{rank}</span>
                <span className="record__title">{candidate.subject.label}</span>
                <Badge tone={candidateStateTone(candidate.state)} title={candidate.state}>
                    {humanizeTerm(candidate.state)}
                </Badge>
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
            <button
                className="question-form__submit"
                type="button"
                disabled={pending}
                onClick={() => onChoose({ result_id: resultId, receipt_id: candidate.receipt_id })}
            >
                Ask again about {candidate.subject.label}
            </button>
        </li>
    );
}

export function ClarificationPanel({ result, onChoose, pending }: ClarificationPanelProps) {
    const { candidates, clarification_prompt: prompt } = result.subject_resolution;

    return (
        <section className="panel" aria-labelledby="clarification-title">
            <h2 className="panel__title" id="clarification-title">
                Which subject did you mean?
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
                            onChoose={onChoose}
                            pending={pending}
                            rank={index + 1}
                            resultId={result.result_id}
                        />
                    ))}
                </ul>
            )}
        </section>
    );
}
