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
 */
export function StructureConfirmationNotice({ entries }: StructureConfirmationNoticeProps) {
    const summaries = summarizeConfirmedStructure(entries);
    if (summaries.length === 0) return null;

    const anyVetoed = hasVetoedStructureConfirmation(entries);

    return (
        <section
            aria-label="Structure confirmation"
            className={anyVetoed ? "panel panel--failure" : "panel"}
            role={anyVetoed ? "alert" : "status"}
        >
            <h2 className="panel__title">
                {anyVetoed ? "Some selections were not applied" : "Your selections were applied"}
            </h2>
            <ul className="stack stack--tight">
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
        </section>
    );
}
