import { useId } from "react";

import { Badge } from "@/components/Badge";
import { EvidenceReferences } from "@/components/EvidenceReferences";
import { SafeAnswerText } from "@/components/SafeAnswerText";
import { isCohortIntent, rankingTable } from "@/lib/cohort-ranking";
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
 *
 * `standing: "withheld"` (team-lead, 2026-08-30, folding in a lane-4580
 * close-out finding): acr composes this judgment's `summary` to explain WHY
 * a cohort member's score was withheld, which restates the SAME
 * `missing_signals` list `CohortRankingPanel`'s own table footnote already
 * states once for that member — visible twice in the same answer otherwise.
 * Missing signals stay stated once (the table footnote); a withheld card
 * shows a short reference instead of the full restatement, with the
 * server's own summary still reachable, unmodified, inside Details — this
 * repositions it, it never rewrites or drops it (AGENTS.md: UX renders only
 * persisted values).
 *
 * codex review round 2 (CHAOS-4581): the reference is only safe to show when
 * `CohortRankingPanel` is ACTUALLY rendering a table for this same result —
 * that panel self-gates (non-cohort intent, no cohort, or nothing ranked),
 * and a withheld driver is not contractually guaranteed to appear only
 * alongside one. `rankedTeamsVisible` (computed by the caller with the same
 * gate `CohortRankingPanel` itself uses) decides which treatment applies —
 * pointing at a table that is not there would be a worse gap than the
 * duplication this was built to close.
 */
function DriverCard({
    driver,
    rankedTeamsVisible,
}: {
    readonly driver: DriverJudgment;
    readonly rankedTeamsVisible: boolean;
}) {
    const isPrincipal = driver.standing === "principal";
    const isWithheld = driver.standing === "withheld" && rankedTeamsVisible;
    const affected = driver.affected_subjects.map((subject) => subject.label).join(", ");
    return (
        <li className={`record record--card${isPrincipal ? " record--principal" : ""}`}>
            <div className="record__head">
                <span className="record__title">{driver.title}</span>
                <Badge tone={isPrincipal ? "warn" : "neutral"} title={driver.standing}>
                    {humanizeTerm(driver.standing)}
                </Badge>
            </div>
            {isWithheld ? (
                <p className="record__body">
                    Score withheld for {affected} — missing signals are listed once, in Ranked teams
                    above.
                </p>
            ) : (
                <p className="record__body">
                    <SafeAnswerText text={driver.summary} />
                </p>
            )}
            <details className="disclosure">
                <summary>Details</summary>
                {isWithheld ? (
                    <p className="record__meta">
                        <SafeAnswerText text={driver.summary} />
                    </p>
                ) : null}
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
    // Mirrors CohortRankingPanel's own gate exactly (rule 0 there): a
    // withheld driver's reference is only safe when that panel is actually
    // rendering a table for THIS result.
    const rankedTeamsVisible =
        isCohortIntent(result.interpretation.shape) &&
        result.cohort !== undefined &&
        rankingTable(result.cohort.members) !== null;
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
                        <DriverCard
                            driver={driver}
                            key={driver.driver_id}
                            rankedTeamsVisible={rankedTeamsVisible}
                        />
                    ))}
                </ul>
            )}
        </section>
    );
}
