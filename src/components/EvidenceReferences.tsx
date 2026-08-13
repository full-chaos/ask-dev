export type EvidenceReferencesProps = {
    readonly evidenceRefIds: readonly string[] | undefined;
    readonly label?: string;
};

/**
 * Renders evidence reference IDs verbatim.
 *
 * The investigation result carries IDs, not resolved evidence bodies. The
 * workbench shows exactly those IDs — it does not fetch, summarize, or
 * paraphrase the evidence behind them.
 */
export function EvidenceReferences({ evidenceRefIds, label }: EvidenceReferencesProps) {
    if (evidenceRefIds === undefined || evidenceRefIds.length === 0) return null;
    return (
        <>
            {label !== undefined ? <p className="record__meta">{label}</p> : null}
            <ul className="evidence-list">
                {evidenceRefIds.map((refId) => (
                    <li className="evidence-ref" key={refId}>
                        {refId}
                    </li>
                ))}
            </ul>
        </>
    );
}
