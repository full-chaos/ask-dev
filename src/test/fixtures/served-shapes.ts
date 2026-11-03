import type { InvestigationResult } from "@/lib/contracts";

import cadenceEveryDay from "./served-shapes/cadence-every-day.json";
import cadenceMissingDay from "./served-shapes/cadence-missing-day.json";
import categoryOrder from "./served-shapes/category-order.json";
import comparisonTableServed from "./served-shapes/comparison-table-served.json";
import comparisonTable from "./served-shapes/comparison-table.json";
import dateTable from "./served-shapes/date-oracle.json";
import investmentSunburst from "./served-shapes/investment-sunburst.json";
import investmentTreemap from "./served-shapes/investment-treemap.json";
import landscapeQuadrant from "./served-shapes/landscape-quadrant.json";
import measureUnitsLabelsOff from "./served-shapes/measure-units-labels-off.json";
import measureUnitsRepository from "./served-shapes/measure-units-repository.json";
import measureUnitsUndeclared from "./served-shapes/measure-units-undeclared.json";
import measureUnits from "./served-shapes/measure-units.json";
import edgeWords from "./served-shapes/edge-words.json";
import repositoryFlowSankey from "./served-shapes/repository-flow-sankey.json";
import forecastCurve from "./served-shapes/forecast-curve.json";
import forecastNoRun from "./served-shapes/forecast-no-run.json";
import forecastNotStored from "./served-shapes/forecast-not-stored.json";
import zoneLessTrend from "./served-shapes/zone-less-trend.json";

/**
 * Served shapes from the real encoder at acr `d617cbd2`: real `SelectRenderShapes`, `Validate`,
 * `ServeVocabularyLabels` and `json.Marshal`, never by hand (`served-shapes/generate.go.txt`).
 *
 * `category-order` is two ranked teams whose first driver family omits the top-ranked team.
 * `zone-less-trend` plots zone-less date-times across the Los Angeles spring gap. `edge-words` is
 * the contract example served at acr `da2efe68`, with the `relationship_type` words.
 * `comparison-table` is a real served `explicit_comparison` answer with its claims and table added
 * by hand, kept because it holds the gap no served table has yet (CHAOS-12513).
 * `comparison-table-served` is a whole served document from acr's real selector (acr `1589a903`):
 * real data, with its claims written through `supplied_synthesis`, because the stock oracle writes
 * one claim.
 * `investment-treemap` is the real selector with the flag on, at the producer commit `ab88349f`
 * (`served-shapes/generate-treemap.go.txt`). `dateOracle` is
 * what ACR's own `parseRenderDate` reads: `millis` is null where it refuses the value.
 * `measure-units*` are the contract example through ACR's real declared units and cadence, selector
 * and encoder at 4eb93cf9 (`served-shapes/generate-units.go.txt`): with words, with the labels flag
 * off, with no declaration at all, and with the commits claim about a repository, whose daily
 * metrics declare a unit and a cadence (CHAOS-12570, CHAOS-12571). `cadence-missing-day` and
 * `cadence-every-day` are that last case with the workload and commits days set to 28, 29 and 31
 * August, and to 28, 29 and 30 August, through the same real cadence (CHAOS-12571).
 * `repository-flow-sankey` is one team's claim with a declared `repository_theme_breakdown` table and
 * the sankey that plots it, through ACR's real vocabulary labels, `Validate` and encoder at the
 * contract commit (`served-shapes/generate-sankey.go.txt`). No producer emits the rule yet
 * (CHAOS-12582), so the shape is built as ACR's own contract test builds it (CHAOS-12579).
 * `landscape-quadrant` is a whole served document from acr's real engine (`Engine.Investigate` over a
 * real ClickHouse, production registry, flag on) at the producer branch, acr #1963 9599f5c0
 * (`TestAComparisonOfTeamsOnOneDayDrawsTheirQuadrant`, p4-acr-conversation): five teams of the dho
 * mixed world, one per provider, compared on landscape facts. The landscape rows are hand-seeded.
 * The fifth team has one identity, so the real rule gives it no point (CHAOS-12624).
 * `forecast-*` are stored forecast rows through ACR's real team workload field writer, claim attach,
 * forecast summary, selector (forecast flag on) and encoder (`served-shapes/generate-forecast.go.txt`,
 * CHAOS-4613): a curve with runs stopped at the horizon, every run at the horizon, and no stored
 * distribution. The last two serve the percentiles table, not a curve.
 * `investment-sunburst` is one repository's claim with a declared `subcategory_breakdown` table and
 * the sunburst that plots it, through ACR's real vocabulary labels, `Validate` and encoder at the
 * contract commit 89c9133c (`served-shapes/generate-sunburst.go.txt`, CHAOS-12812). No producer
 * emits the rule yet (CHAOS-12554), so the shape is built as ACR's own contract test builds it.
 */
export const servedShapeScenarios = {
    "cadence-every-day": cadenceEveryDay as unknown as InvestigationResult,
    "cadence-missing-day": cadenceMissingDay as unknown as InvestigationResult,
    "category-order": categoryOrder as unknown as InvestigationResult,
    "comparison-table": comparisonTable as unknown as InvestigationResult,
    "comparison-table-served": comparisonTableServed as unknown as InvestigationResult,
    "investment-sunburst": investmentSunburst as unknown as InvestigationResult,
    "investment-treemap": investmentTreemap as unknown as InvestigationResult,
    "landscape-quadrant": landscapeQuadrant as unknown as InvestigationResult,
    "edge-words": edgeWords as unknown as InvestigationResult,
    "forecast-curve": forecastCurve as unknown as InvestigationResult,
    "forecast-no-run": forecastNoRun as unknown as InvestigationResult,
    "forecast-not-stored": forecastNotStored as unknown as InvestigationResult,
    "measure-units": measureUnits as unknown as InvestigationResult,
    "measure-units-labels-off": measureUnitsLabelsOff as unknown as InvestigationResult,
    "measure-units-repository": measureUnitsRepository as unknown as InvestigationResult,
    "measure-units-undeclared": measureUnitsUndeclared as unknown as InvestigationResult,
    "repository-flow-sankey": repositoryFlowSankey as unknown as InvestigationResult,
    "zone-less-trend": zoneLessTrend as unknown as InvestigationResult,
} as const;

export const dateOracle: readonly {
    readonly value: string;
    readonly millis: number | null;
}[] = dateTable;
