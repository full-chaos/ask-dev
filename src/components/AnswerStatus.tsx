import { Badge } from "./Badge";
import type { InvestigationResult } from "../lib/contracts";
import { statusTone } from "../lib/presentation";
import { answerStatusWord, servedWord, statusCorrectionNote } from "../lib/vocabulary-labels";

/**
 * How the service calls this answer, in its own words (CHAOS-12245, CHAOS-12417), and the sentence
 * that says when it corrected the status. Both are served: the render has no table over `status`,
 * and a raw status word is never shown. The tone is colour, not words; the neutral word carries the
 * neutral tone, so it implies no state the service did not name.
 */
export function AnswerStatus({ result }: { readonly result: InvestigationResult }) {
    const word = answerStatusWord(result);
    const note = statusCorrectionNote(result);
    if (word === undefined && note === undefined) return null;
    const served = servedWord(result.vocabulary_labels, "answer_status", result.status);
    return (
        <div>
            {word === undefined ? null : (
                <div className="chip-row">
                    <Badge
                        data-testid="ask-dev-answer-status"
                        tone={served === undefined ? "neutral" : statusTone(result.status)}
                    >
                        {word}
                    </Badge>
                </div>
            )}
            {note === undefined ? null : (
                <p className="record__meta" data-testid="answer-status-correction">
                    {note}
                </p>
            )}
        </div>
    );
}
