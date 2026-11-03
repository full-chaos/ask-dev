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
    | "completion_distribution_state"
    | "cohort_score_meaning"
    | "driver_source_state"
    | "driver_standing"
    | "driver_window"
    | "fact_field"
    | "fact_kind"
    | "investment_theme"
    | "measure_unit"
    | "member_outcome"
    | "prior_receipt_disposition"
    | "ranking_signal"
    | "relationship_type"
    | "requirement_outcome"
    | "structure_disposition"
    | "subcategory"
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

/**
 * True unless the answer serves a word for `token` and `label` is not that word (CHAOS-12697). This
 * is the answer's own served map, not a consumer copy (CHAOS-4690): a token the map holds no word
 * for (the flag is off, an old pin, or a token the answer does not use) stays trusted to acr's
 * validator, so it is true. Every rich-shape verifier holds its words through this one check.
 */
export function isServedWordOrUnserved(
    labels: VocabularyLabels,
    vocabulary: Vocabulary,
    token: string,
    label: string,
): boolean {
    const word = servedWord(labels, vocabulary, token);
    return word === undefined || word === label;
}

/**
 * The sentence ACR composes for one field of this result (CHAOS-12487). There is no generic path:
 * no key, no line, and the raw field stays in its fold. The map holds a key only for a field that
 * says something, and near the size bound ACR sheds most of them.
 */
export function servedNote(labels: VocabularyLabels, field: string): string | undefined {
    return nonBlank(labels?.[`${field}:note`]);
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
export function answerStatusWord(
    result: Pick<InvestigationResult, "status"> & { readonly vocabulary_labels?: VocabularyLabels },
): string | undefined {
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
