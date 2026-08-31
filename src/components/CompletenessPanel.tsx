import { useId } from "react";

import { Badge } from "@/components/Badge";
import type { AnswerCompleteness } from "@/lib/contracts";
import { humanizeTerm, statusTone } from "@/lib/presentation";

export type CompletenessPanelProps = {
    readonly completeness: AnswerCompleteness;
};

/**
 * CHAOS-4413/CHAOS-4642: shows how much of an answer is here and why it
 * stopped where it did.
 *
 * `terminal_status` reuses the exact same closed vocabulary as the result's
 * own `status` (`statusTone` is exhaustive over both), so its badge always
 * reads consistently with the rest of the page. `claimed_facts_count` and
 * `rows_count` are the engine's own UN-CLAMPED totals — independent of this
 * Workbench's own request-time budget (`options.max_*` in
 * `buildInvestigationRequest`) — so they can legitimately exceed what any
 * single panel actually renders; that is the point, not a bug (AGENTS.md
 * check 11: completeness is a public contract field, richer than the prose).
 * `terminal_reason` is a closed vocabulary naming WHY, never the engine's or
 * a model's own raw text (CHAOS-4413's own schema doc comment) — shown
 * verbatim, exactly like `CoveragePanel`'s degraded reasons.
 */
export function CompletenessPanel({ completeness }: CompletenessPanelProps) {
    const idPrefix = useId();
    return (
        <section
            className="panel panel--card panel--compact"
            aria-labelledby={`${idPrefix}-completeness-title`}
            data-testid="completeness-panel"
        >
            <h2 className="panel__title" id={`${idPrefix}-completeness-title`}>
                Completeness
            </h2>
            <div className="chip-row" data-testid="completeness-chip-row">
                <Badge
                    tone={statusTone(completeness.terminal_status)}
                    title={`terminal_status: ${completeness.terminal_status}`}
                >
                    {humanizeTerm(completeness.terminal_status)}
                </Badge>
            </div>
            <p className="record__meta">
                {`${String(completeness.claimed_facts_count)} claimed fact${completeness.claimed_facts_count === 1 ? "" : "s"} · ${String(completeness.rows_count)} row${completeness.rows_count === 1 ? "" : "s"}`}
            </p>
            {completeness.terminal_reason !== undefined ? (
                <p className="coverage__reason" data-testid="completeness-terminal-reason">
                    {humanizeTerm(completeness.terminal_reason)}
                </p>
            ) : null}
        </section>
    );
}
