import { askedForCohort, cohortRanking } from "./cohort-ranking";
import type { InvestigationResult, RenderShape } from "./contracts";
import { factsWithRows } from "./fact-rows";
import { COHORT_SHAPE_RULES, renderShapesFor, shapeMentionsClaim } from "./render-shapes";

/**
 * The one account of every served shape (rich views plan, section 4): the shapes no panel draws or
 * says, so the answer can say them. Selectors read by rule, so a shape under any other rule reaches
 * no panel: without this, a contract widening draws nothing and says nothing.
 *
 * - A cohort chart belongs to the ranking, which draws it or says it was withheld. "Ranking not
 *   shown" says it too. With no ranking, `CohortMembersPanel` says only the charts that fail their
 *   check, so a chart that passes is left over here.
 * - A trend belongs to the panel of a fact it cites, and only a fact with `rows` has a panel. That
 *   panel draws it or says it was withheld.
 * - Every other shape has no reader.
 */
export function shapesNoPanelTakes(result: InvestigationResult): readonly RenderShape[] {
    const { state } = cohortRanking(
        askedForCohort(result.interpretation.shape, result),
        result.cohort,
    );
    const rankingTakesItsCharts = state === "rows" || state === "kind_not_ranked";
    const verifiedCohortCharts = renderShapesFor(result, COHORT_SHAPE_RULES).shapes;
    const claimsWithAPanel = factsWithRows(result.claimed_facts).map((fact) => fact.claim_id);
    return (result.render_shapes ?? []).filter((shape) => {
        if (COHORT_SHAPE_RULES.includes(shape.selected_by)) {
            return !rankingTakesItsCharts && verifiedCohortCharts.includes(shape);
        }
        return !(
            shape.selected_by === "dated_fact_trend" &&
            claimsWithAPanel.some((claimId) => shapeMentionsClaim(shape, claimId))
        );
    });
}
