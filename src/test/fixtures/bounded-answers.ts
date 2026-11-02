import type { AnswerProjection } from "@/lib/contracts";

import boundedAnswer from "./bounded-answers/bounded-answer.json";
import boundedNoMatch from "./bounded-answers/bounded-no-match.json";
import boundedPartialTable from "./bounded-answers/bounded-partial-table.json";

/**
 * ACR's bounded answers (CHAOS-12559), from ACR's real projector at acr `271ce38b`, the pin of
 * `src/contracts/manifest.json`, never by hand: `bounded-answers/generate.go.txt` runs
 * `answerprojection.Project`, `MarkFullResultOmitted` and `Validate` over results ACR's real
 * encoder served (`served-words/full-answer.json`, `served-shapes/comparison-table-served.json`,
 * `served-words/no-match.json`), with small counts, so each projection drops rows and declares the
 * drops in `projection_budget`. To rebuild after a pin move, copy it to `cmd/zz12559fixture/main.go`
 * in an acr checkout at the pin and run `go run ./cmd/zz12559fixture <src/test/fixtures> <this
 * directory>/bounded-answers`.
 */
export const boundedAnswerScenarios = {
    "bounded-answer": boundedAnswer as unknown as AnswerProjection,
    "bounded-no-match": boundedNoMatch as unknown as AnswerProjection,
    "bounded-partial-table": boundedPartialTable as unknown as AnswerProjection,
} as const;
