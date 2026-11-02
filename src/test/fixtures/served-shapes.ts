import type { InvestigationResult } from "@/lib/contracts";

import categoryOrder from "./served-shapes/category-order.json";
import dateTable from "./served-shapes/date-oracle.json";
import edgeWords from "./served-shapes/edge-words.json";
import zoneLessTrend from "./served-shapes/zone-less-trend.json";

/**
 * Served shapes from the real encoder at acr `d617cbd2`: real `SelectRenderShapes`, `Validate`,
 * `ServeVocabularyLabels` and `json.Marshal`, never by hand (`served-shapes/generate.go.txt`).
 *
 * `category-order` is two ranked teams whose first driver family omits the top-ranked team.
 * `zone-less-trend` plots zone-less date-times across the Los Angeles spring gap. `edge-words` is
 * the contract example served at acr `da2efe68`, with the `relationship_type` words. `dateOracle` is
 * what ACR's own `parseRenderDate` reads: `millis` is null where it refuses the value.
 */
export const servedShapeScenarios = {
    "category-order": categoryOrder as unknown as InvestigationResult,
    "edge-words": edgeWords as unknown as InvestigationResult,
    "zone-less-trend": zoneLessTrend as unknown as InvestigationResult,
} as const;

export const dateOracle: readonly {
    readonly value: string;
    readonly millis: number | null;
}[] = dateTable;
