import { useId } from "react";

import { Badge } from "@/components/Badge";
import { EvidenceReferences } from "@/components/EvidenceReferences";
import { SafeAnswerText } from "@/components/SafeAnswerText";
import type { DriverJudgment, InvestigationResult } from "@/lib/contracts";
import { formatConfidence, humanizeTerm } from "@/lib/presentation";

export type DriversPanelProps = {
    readonly result: InvestigationResult;
};

/**
 * One driver, as a pop-up-style card: a title row with a standing badge, a
 * one-line summary, and everything else (category/derivation/confidence,
 * qualification, affected subjects, evidence) behind an expand — matching
 * CHAOS-4581's "elevated cards ... details behind expand/click, not every
 * field inline" pop-up reference. `principal` drivers get the elevated
 * `record--principal` treatment so the strongest judgment reads first even
 * within this one panel.
 */
function DriverCard({ driver }: { readonly driver: DriverJudgment }) {
    const isPrincipal = driver.standing === "principal";
    return (
        <li className={`record record--card${isPrincipal ? " record--principal" : ""}`}>
            <div className="record__head">
                <span className="record__title">{driver.title}</span>
                <Badge tone={isPrincipal ? "warn" : "neutral"} title={driver.standing}>
                    {humanizeTerm(driver.standing)}
                </Badge>
            </div>
            <p className="record__body">
                <SafeAnswerText text={driver.summary} />
            </p>
            <details className="disclosure">
                <summary>Details</summary>
                <p className="record__meta">
                    {humanizeTerm(driver.category)} · {humanizeTerm(driver.epistemic_status)} ·{" "}
                    {humanizeTerm(driver.derivation)} · confidence{" "}
                    {formatConfidence(driver.confidence)}
                </p>
                {driver.qualification !== undefined ? (
                    <p className="record__meta">
                        <SafeAnswerText text={driver.qualification} />
                    </p>
                ) : null}
                <p className="record__meta" data-testid="driver-affected-subjects">
                    Affected:{" "}
                    {driver.affected_subjects
                        .map((subject) => `${subject.label} (${subject.kind})`)
                        .join(", ")}
                </p>
                <EvidenceReferences evidenceRefIds={driver.evidence_ref_ids} label="Evidence" />
                <EvidenceReferences
                    evidenceRefIds={driver.claimed_fact_ids}
                    label="Claimed facts"
                />
            </details>
        </li>
    );
}

/**
 * The principal driver cards (CHAOS-4581).
 *
 * Extracted from `AnswerPanel`, which used to bundle `strongest_pressures`
 * and `drivers` under the "Answer" heading as more prose. They are judgments
 * about WHY, not narration, so they get their own panel and — per the
 * ticket's reordering — lead ahead of the prose rather than trailing under
 * it. Same honesty rule the old inline version held: an empty `drivers` list
 * still renders the heading and says so explicitly, it is never hidden.
 */
export function DriversPanel({ result }: DriversPanelProps) {
    const idPrefix = useId();
    return (
        <section
            className="panel panel--card"
            aria-labelledby={`${idPrefix}-drivers-title`}
            data-testid="drivers-panel"
        >
            <h2 className="panel__title" id={`${idPrefix}-drivers-title`}>
                Drivers
            </h2>
            {result.strongest_pressures.length > 0 ? (
                <>
                    <h3 className="panel__title">Strongest pressures</h3>
                    <ul className="stack stack--tight" style={{ marginBottom: 14 }}>
                        {result.strongest_pressures.map((pressure) => (
                            <li className="record" key={pressure}>
                                {pressure}
                            </li>
                        ))}
                    </ul>
                </>
            ) : null}
            {result.drivers.length === 0 ? (
                <p className="panel__empty">No drivers were reported.</p>
            ) : (
                <ul className="stack">
                    {result.drivers.map((driver) => (
                        <DriverCard driver={driver} key={driver.driver_id} />
                    ))}
                </ul>
            )}
        </section>
    );
}
