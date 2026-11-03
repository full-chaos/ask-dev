import { askedForCohort, cohortRanking } from "./cohort-ranking";
import type { InvestigationResult, RenderShape } from "./contracts";
import { factsWithAPanel } from "./fact-rows";
import {
    COHORT_SHAPE_RULES,
    COMPARISON_RULE,
    FACT_PANEL_RULES,
    LANDSCAPE_POSITION_RULE,
    FORECAST_PERCENTILES_RULE,
    renderShapesFor,
    shapeMentionsClaim,
} from "./render-shapes";

/**
 * The one account of every served shape (rich views plan, section 4): the shapes no panel draws or
 * says, so the answer can say them. Selectors read by rule, so a shape under any other rule reaches
 * no panel: without this, a contract widening draws nothing and says nothing.
 *
 * - A cohort chart belongs to the ranking, which draws it or says it was withheld. "Ranking not
 *   shown" says it too. With no ranking, `CohortMembersPanel` says only the charts that fail their
 *   check, so a chart that passes is left over here.
 * - A trend or a treemap belongs to the panel of a fact it cites, and only a fact with `rows`, on no
 *   person, has a panel. That panel draws it or says it was withheld.
 * - A side-by-side table, a quadrant (CHAOS-12624) and a forecast percentiles table (CHAOS-4613)
 *   each have a panel of their own, which draws it or says it was withheld.
 * - Every other shape has no reader.
 */
export function shapesNoPanelTakes(result: InvestigationResult): readonly RenderShape[] {
    const { state } = cohortRanking(
        askedForCohort(result.interpretation.shape, result),
        result.cohort,
    );
    const rankingTakesItsCharts = state === "rows" || state === "kind_not_ranked";
    const verifiedCohortCharts = renderShapesFor(result, COHORT_SHAPE_RULES).shapes;
    const claimsWithAPanel = factsWithAPanel(result.claimed_facts).map((fact) => fact.claim_id);
    return (result.render_shapes ?? []).filter((shape) => {
        if (COHORT_SHAPE_RULES.includes(shape.selected_by)) {
            return !rankingTakesItsCharts && verifiedCohortCharts.includes(shape);
        }
        if (shape.selected_by === COMPARISON_RULE) return false;
        if (shape.selected_by === LANDSCAPE_POSITION_RULE) return false;
        if (shape.selected_by === FORECAST_PERCENTILES_RULE) return false;
        return !(
            FACT_PANEL_RULES.includes(shape.selected_by) &&
            claimsWithAPanel.some((claimId) => shapeMentionsClaim(shape, claimId))
        );
    });
}
