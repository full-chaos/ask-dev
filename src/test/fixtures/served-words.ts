import type { InvestigationResult } from "@/lib/contracts";

import clarification from "./served-words/clarification.json";
import corrected from "./served-words/corrected.json";
import degraded from "./served-words/degraded.json";
import everyVocabulary from "./served-words/every-vocabulary.json";
import fullAnswer from "./served-words/full-answer.json";
import noMatch from "./served-words/no-match.json";
import notFullyCovered from "./served-words/not-fully-covered.json";
import plainAnswer from "./served-words/plain-answer.json";

/**
 * Results as ACR serves them with ACR_CONTEXT_FABRIC_VOCABULARY_LABELS_ENABLED on (CHAOS-12417).
 *
 * Built by the real encoder at acr `d617cbd2`, the pin of `src/contracts/manifest.json`, never by
 * hand: `served-words/generate.go.txt` loads acr's own contract examples, sets the structured
 * fields, and runs `ComputeAnswerCompleteness`, `ApplyServerCompletenessAuthority` and
 * `ServeVocabularyLabels`. To rebuild after a pin move, copy it to `cmd/zz12417fixture/main.go` in
 * an acr checkout at the pin and run `go run ./cmd/zz12417fixture <this directory>`.
 */
export const servedWordScenarios = {
    clarification: clarification as unknown as InvestigationResult,
    corrected: corrected as unknown as InvestigationResult,
    degraded: degraded as unknown as InvestigationResult,
    "every-vocabulary": everyVocabulary as unknown as InvestigationResult,
    "full-answer": fullAnswer as unknown as InvestigationResult,
    "no-match": noMatch as unknown as InvestigationResult,
    "not-fully-covered": notFullyCovered as unknown as InvestigationResult,
    "plain-answer": plainAnswer as unknown as InvestigationResult,
} as const;
