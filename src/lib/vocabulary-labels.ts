import type { InvestigationResult } from "./contracts";
import { humanizeTerm, nonBlank } from "./presentation";

/**
 * The words ACR serves for its closed vocabularies (CHAOS-12413, CHAOS-4690). A lookup is not a
 * table: a new value arrives with its word and needs no change here, and a value with no entry
 * takes the generic path. The map holds only the values in one result, and a result can arrive with
 * none: the flag is off, an old pin wrote it, or the ranking was withheld.
 */
export type VocabularyLabels = InvestigationResult["vocabulary_labels"];

/** The vocabularies a render reads, as `<vocabulary>:<value>` keys name them. */
export type Vocabulary =
    | "answer_status"
    | "candidate_state"
    | "driver_standing"
    | "driver_window"
    | "fact_kind"
    | "member_outcome"
    | "prior_receipt_disposition"
    | "ranking_signal"
    | "requirement_outcome"
    | "structure_disposition"
    | "subject_kind"
    | "subject_kind_plural"
    | "threshold_label"
    | "window_provenance"
    | "window_relative_id";

/** The served word of one value, or `undefined` when the map has none. */
export function servedWord(
    labels: VocabularyLabels,
    vocabulary: Vocabulary,
    value: string,
): string | undefined {
    return nonBlank(labels?.[`${vocabulary}:${value}`]);
}

/** The word a reader sees: the served one, else the generic path. */
export function vocabularyWord(
    labels: VocabularyLabels,
    vocabulary: Vocabulary,
    value: string,
): string {
    return servedWord(labels, vocabulary, value) ?? humanizeTerm(value);
}

/** Claims neither a full answer nor a gap. */
const NEUTRAL_ANSWER_WORD = "Answer";

/**
 * The status pill's word. A status never takes the generic path, because CHAOS-12245 forbids a raw
 * status word. With no served word an answered status reads the neutral "Answer" (lead's ruling on
 * CHAOS-12417), and a result that did not answer has no pill: "Answer" would be untrue for it.
 */
export function answerStatusWord(result: InvestigationResult): string | undefined {
    const served = servedWord(result.vocabulary_labels, "answer_status", result.status);
    if (served !== undefined) return served;
    return result.status === "no_match" || result.status === "clarification_required"
        ? undefined
        : NEUTRAL_ANSWER_WORD;
}

/** The sentence ACR composes for a corrected status. There is no generic path: no map, no note. */
export function statusCorrectionNote(result: InvestigationResult): string | undefined {
    return nonBlank(result.vocabulary_labels?.["status_correction:note"]);
}
