import { Details } from "@/components/Details";
import { humanizeEvidenceRefId } from "@/lib/vocab-mapping";

export type EvidenceReferencesProps = {
    readonly evidenceRefIds: readonly string[] | undefined;
    readonly label?: string;
};

/**
 * Renders evidence reference IDs.
 *
 * The investigation result carries IDs, not resolved evidence bodies. The
 * workbench shows exactly those IDs — it does not fetch, summarize, or
 * paraphrase the evidence behind them.
 *
 * CHAOS-4673: the lead surface renders each id's mapped human label
 * (`humanizeEvidenceRefId`, e.g. `acr:v1:team:CHAOS` -> "Team: CHAOS") —
 * the raw `acr:v1:*` identifier itself moves behind a collapsed ▸Details,
 * never on the lead surface (acceptance: "no acr:v1:* strings outside
 * collapsed Details"). Fail-readable: an id this module doesn't recognize
 * still gets a generic "Evidence" label rather than leaking its raw form.
 */
export function EvidenceReferences({ evidenceRefIds, label }: EvidenceReferencesProps) {
    if (evidenceRefIds === undefined || evidenceRefIds.length === 0) return null;
    const mapped = evidenceRefIds.map((refId) => humanizeEvidenceRefId(refId));
    return (
        <>
            {label !== undefined ? <p className="record__meta">{label}</p> : null}
            <ul className="evidence-list">
                {mapped.map((entry) => (
                    <li className="evidence-ref" key={entry.raw}>
                        {entry.sentence}
                    </li>
                ))}
            </ul>
            <Details data-testid="evidence-ref-raw-ids" summary="Raw evidence ids">
                <ul className="evidence-list">
                    {mapped.map((entry) => (
                        <li className="evidence-ref" key={entry.raw}>
                            <code>{entry.raw}</code>
                        </li>
                    ))}
                </ul>
            </Details>
        </>
    );
}
