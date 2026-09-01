import { Details } from "@/components/Details";
import type { EvidenceRefLabels } from "@/lib/contracts";
import { nonBlank } from "@/lib/presentation";

export type EvidenceReferencesProps = {
    readonly evidenceRefIds: readonly string[] | undefined;
    /**
     * CHAOS-4690/CHAOS-4691: `InvestigationResult.evidence_ref_labels` --
     * the engine's own display label per evidence ref id reachable on the
     * result (`ContextFabricEvidenceRefLabel`, contract-owned and
     * totality-tested, not a consumer-side lookup table). `undefined` for a
     * pre-4690 stored result that predates the field (the ruled legacy
     * exception, CHAOS-4691's pin delta item 6) -- every id then falls
     * through to the generic floor below, same as an id this map's key set
     * does not cover.
     */
    readonly evidenceRefLabels: EvidenceRefLabels;
    readonly label?: string;
};

/** The deterministic fail-readable floor for an id absent from `evidenceRefLabels` -- never a guess at what the id names. */
const GENERIC_EVIDENCE_LABEL = "Evidence";

/**
 * Renders evidence reference IDs.
 *
 * The investigation result carries IDs, not resolved evidence bodies. The
 * workbench shows exactly those IDs — it does not fetch, summarize, or
 * paraphrase the evidence behind them.
 *
 * CHAOS-4690/CHAOS-4691: the lead surface renders each id's ENGINE-PROVIDED
 * label (`evidenceRefLabels[refId]`, e.g. `acr:v1:team:CHAOS` -> "Team:
 * CHAOS") — the raw `acr:v1:*` identifier itself moves behind a collapsed
 * ▸Details, never on the lead surface (acceptance: "no acr:v1:* strings
 * outside collapsed Details"). This module used to derive that label itself
 * from a consumer-side prefix/entity-type table (CHAOS-4673); that table is
 * deleted (chris's strike-three ruling on consumer phrasing tables) — the
 * label is now the engine's own, not reconstructed here. Fail-readable: an
 * id absent from the map (never on the wire, or a pre-4690 stored result
 * that carries no map at all) still gets the generic "Evidence" floor
 * rather than leaking its raw form.
 */
export function EvidenceReferences({
    evidenceRefIds,
    evidenceRefLabels,
    label,
}: EvidenceReferencesProps) {
    if (evidenceRefIds === undefined || evidenceRefIds.length === 0) return null;
    const mapped = evidenceRefIds.map((refId) => ({
        refId,
        display: nonBlank(evidenceRefLabels?.[refId]) ?? GENERIC_EVIDENCE_LABEL,
    }));
    return (
        <>
            {label !== undefined ? <p className="record__meta">{label}</p> : null}
            <ul className="evidence-list">
                {mapped.map((entry) => (
                    <li className="evidence-ref" key={entry.refId}>
                        {entry.display}
                    </li>
                ))}
            </ul>
            <Details data-testid="evidence-ref-raw-ids" summary="Raw evidence ids">
                <ul className="evidence-list">
                    {mapped.map((entry) => (
                        <li className="evidence-ref" key={entry.refId}>
                            <code>{entry.refId}</code>
                        </li>
                    ))}
                </ul>
            </Details>
        </>
    );
}
