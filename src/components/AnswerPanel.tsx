import { EvidenceReferences } from "@/components/EvidenceReferences";
import { Badge } from "@/components/Badge";
import type { DriverJudgment, InvestigationResult } from "@/lib/contracts";
import { formatConfidence, humanizeTerm } from "@/lib/presentation";

export type AnswerPanelProps = {
    readonly result: InvestigationResult;
};

function DriverRecord({ driver }: { readonly driver: DriverJudgment }) {
    return (
        <li className="record">
            <div className="record__head">
                <span className="record__title">{driver.title}</span>
                <Badge
                    tone={driver.standing === "principal" ? "warn" : "neutral"}
                    title={driver.standing}
                >
                    {humanizeTerm(driver.standing)}
                </Badge>
                <span className="record__meta">
                    {humanizeTerm(driver.category)} · {humanizeTerm(driver.epistemic_status)} ·{" "}
                    {humanizeTerm(driver.derivation)} · confidence{" "}
                    {formatConfidence(driver.confidence)}
                </span>
            </div>
            <p className="record__body">{driver.summary}</p>
            {driver.qualification !== undefined ? (
                <p className="record__meta">{driver.qualification}</p>
            ) : null}
            <EvidenceReferences evidenceRefIds={driver.evidence_ref_ids} label="Evidence" />
        </li>
    );
}

/**
 * The answer as the service stated it.
 *
 * `deterministic_answer` is shown first and verbatim — it is the service's own
 * non-model wording. `direct_judgment` and `current_state` follow. The
 * workbench does not summarize, reorder by importance, or fill a gap with its
 * own prose: an empty judgment renders as an explicit absence.
 */
export function AnswerPanel({ result }: AnswerPanelProps) {
    const hasJudgment = result.direct_judgment.trim() !== "";
    return (
        <section className="panel" aria-labelledby="answer-title">
            <h2 className="panel__title" id="answer-title">
                Answer
            </h2>
            <p className="answer__judgment">{result.deterministic_answer}</p>
            {hasJudgment ? (
                <p className="answer__body">{result.direct_judgment}</p>
            ) : (
                <p className="panel__empty">The service returned no direct judgment.</p>
            )}
            {result.current_state.trim() !== "" ? (
                <p className="answer__body">{result.current_state}</p>
            ) : null}

            {result.strongest_pressures.length > 0 ? (
                <>
                    <h3 className="panel__title">Strongest pressures</h3>
                    <ul className="stack stack--tight">
                        {result.strongest_pressures.map((pressure) => (
                            <li className="record" key={pressure}>
                                {pressure}
                            </li>
                        ))}
                    </ul>
                </>
            ) : null}

            <h3 className="panel__title" style={{ marginTop: 14 }}>
                Drivers
            </h3>
            {result.drivers.length === 0 ? (
                <p className="panel__empty">No drivers were reported.</p>
            ) : (
                <ul className="stack">
                    {result.drivers.map((driver) => (
                        <DriverRecord driver={driver} key={driver.driver_id} />
                    ))}
                </ul>
            )}
        </section>
    );
}
