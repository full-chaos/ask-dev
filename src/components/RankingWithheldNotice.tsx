import { rankingWithheldOf } from "@/lib/ranking-withheld";
import type { InvestigationResult } from "@/lib/contracts";

/**
 * Neutral notice for the typed `ranking_withheld` marker the result boundary
 * (`withholdUnrankableRankings`) records. Renders nothing when nothing was
 * withheld. States the fact; never names a member, rank or score.
 */
export function RankingWithheldNotice({ result }: { readonly result: InvestigationResult }) {
    if (rankingWithheldOf(result) === undefined) return null;
    return (
        <p className="record__meta" data-testid="ranking-withheld-notice" role="note">
            Ranking not shown. This answer covers subjects of a kind this view does not rank, so
            their rank, score and ranking drivers were removed before display. Prose from the
            service is shown as the service wrote it.
        </p>
    );
}
