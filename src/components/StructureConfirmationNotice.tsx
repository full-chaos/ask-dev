import { Badge } from "@/components/Badge";
import type { ConfirmedStructureEntry } from "@/lib/contracts";
import { structureDispositionTone } from "@/lib/presentation";
import {
    hasVetoedStructureConfirmation,
    summarizeConfirmedStructure,
} from "@/lib/structure-disposition";

export type StructureConfirmationNoticeProps = {
    readonly entries: readonly ConfirmedStructureEntry[] | undefined;
};

/**
 * The full per-entry record list, shared by both branches below.
 *
 * Exported (CHAOS-4671 codex round 2 finding 2) so `ChosenAnswersSummaryCard`
 * — the chat surface's popup-mode replacement for this component's own
 * "everything applied cleanly" chip-row case — can reuse the SAME
 * "Selection details" record list (receipt id / source / provenance) rather
 * than dropping that detail entirely. `/workbench` is unaffected: this
 * component's own rendering (below) is unchanged.
 */
export function StructureConfirmationRecords({
    summaries,
}: {
    readonly summaries: readonly ReturnType<typeof summarizeConfirmedStructure>[number][];
}) {
    return (
        <ul className="stack stack--tight" style={{ marginTop: 10 }}>
            {summaries.map((summary) => (
                <li className="record" key={summary.entry.member}>
                    <div className="record__head">
                        <span className="record__title">{summary.label}</span>
                        <Badge
                            title={summary.entry.disposition}
                            tone={structureDispositionTone(summary.entry.disposition)}
                        >
                            {summary.entry.disposition.replaceAll("_", " ")}
                        </Badge>
                    </div>
                    <p className="answer__body">{summary.sentence}</p>
                    <p className="record__meta">
                        applied value <code>{summary.entry.applied_value}</code> · source{" "}
                        {summary.entry.source} · provenance {summary.entry.provenance}
                    </p>
                </li>
            ))}
        </ul>
    );
}

/**
 * Renders the `confirmed_structure` echo (CHAOS-3927 P2, design brief §2.1's
 * silent-drop closure).
 *
 * Present whenever the request carried ANY structure receipt or explicit
 * structure field — one entry PER carried member, vetoed ones included.
 * Unlike the subject-receipt path (`ChoiceNotice`/`choiceDisposition`,
 * CHAOS-3813, still unclosed acr-side), this block is wire-visible by
 * construction, so there is nothing to DETECT: every carried member's
 * disposition is right there. This component's whole job is making that
 * visible rather than easy to miss — "a veto the caller cannot see is the
 * silent drop reborn" (§2.1).
 *
 * Rendered even when every entry applied cleanly: an all-applied echo is
 * still the confirmation that the picks were used, not silently discarded.
 *
 * CHAOS-4581: once every carried member applied cleanly, the picks are old
 * news by the time a reader reaches the answer — they collapse to a single
 * compact chip row (member + applied value), with the full per-entry record
 * list still present but behind a closed `<details>`, not gone. A veto is
 * the opposite: it needs attention, so it stays fully expanded and alerted,
 * exactly as before.
 */
export function StructureConfirmationNotice({ entries }: StructureConfirmationNoticeProps) {
    const summaries = summarizeConfirmedStructure(entries);
    if (summaries.length === 0) return null;

    const anyVetoed = hasVetoedStructureConfirmation(entries);

    return (
        <section
            aria-label="Structure confirmation"
            className={anyVetoed ? "panel panel--failure" : "panel panel--compact"}
            role={anyVetoed ? "alert" : "status"}
        >
            <h2 className="panel__title">
                {anyVetoed ? "Some selections were not applied" : "Your selections were applied"}
            </h2>
            <div className="chip-row" data-testid="structure-confirmation-chips">
                {summaries.map((summary) => (
                    <span className="chip" key={summary.entry.member} title={summary.sentence}>
                        {summary.label}: <code>{summary.entry.applied_value}</code>
                    </span>
                ))}
            </div>
            {anyVetoed ? (
                <StructureConfirmationRecords summaries={summaries} />
            ) : (
                <details className="disclosure">
                    <summary>Selection details</summary>
                    <StructureConfirmationRecords summaries={summaries} />
                </details>
            )}
        </section>
    );
}
