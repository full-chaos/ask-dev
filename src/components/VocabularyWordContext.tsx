import { createContext, useContext } from "react";

import type { ClaimedFact } from "../lib/contracts";
import { humanizeTerm } from "../lib/presentation";
import {
    type Vocabulary,
    type VocabularyLabels,
    servedNote,
    servedWord,
    vocabularyWord,
} from "../lib/vocabulary-labels";

/**
 * This answer's served words, for every panel inside it. A context, not a prop: a dozen panels read
 * it, several answers stand on one page, and a panel with no provider takes the generic path.
 */
export const VocabularyLabelsContext = createContext<VocabularyLabels>(undefined);

/** The served words of the answer around this panel. */
export function useVocabularyLabels(): VocabularyLabels {
    return useContext(VocabularyLabelsContext);
}

/** `word("driver_standing", value)`: the served word, else the generic path. */
export function useVocabularyWord(): (vocabulary: Vocabulary, value: string) => string {
    const labels = useVocabularyLabels();
    return (vocabulary, value) => vocabularyWord(labels, vocabulary, value);
}

/**
 * A claim's field: ACR's word, else the generic path. A derived claim's field is free text, even
 * when it matches a declared name, so it never reads a served word (ACR's rule).
 */
export function useClaimFieldWord(): (claim: ClaimedFact) => string {
    const word = useVocabularyWord();
    return ({ field, derived_from }) =>
        (derived_from?.length ?? 0) === 0 ? word("fact_field", field) : humanizeTerm(field);
}

/** `note("reused")`: the sentence ACR composes for one field of this answer, if it has one. */
export function useServedNote(): (field: string) => string | undefined {
    const labels = useVocabularyLabels();
    return (field) => servedNote(labels, field);
}

/** `served("subject_kind_plural", value)`: only the served word, for a caller with its own floor. */
export function useServedWord(): (vocabulary: Vocabulary, value: string) => string | undefined {
    const labels = useVocabularyLabels();
    return (vocabulary, value) => servedWord(labels, vocabulary, value);
}
