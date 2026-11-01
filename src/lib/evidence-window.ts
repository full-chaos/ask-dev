import type { InvestigationResult } from "./contracts";
import { type VocabularyLabels, vocabularyWord } from "./vocabulary-labels";

/** The window an answer speaks for; a result may report none. */
export type EvidenceWindow = InvestigationResult["effective_evidence_window"];

/** A date for a reader. An unreadable value shows as it came, never as a guess. */
export function formatDay(timestamp: string): string {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime())
        ? timestamp
        : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The one reading of a window, for the rail and for the answer's Coverage panel (CHAOS-12421).
 * `undefined` means nothing was reported: the caller says so, and never shows it as complete.
 */
export function evidenceWindowRange(
    window: EvidenceWindow,
    labels: VocabularyLabels,
): string | undefined {
    if (window?.start !== undefined && window.end !== undefined) {
        return `${formatDay(window.start)} – ${formatDay(window.end)}`;
    }
    if (window?.relative_id !== undefined) {
        return vocabularyWord(labels, "window_relative_id", window.relative_id);
    }
    // A current-state snapshot window (acr #1791) carries only `as_of`.
    return window?.as_of === undefined ? undefined : `As of ${formatDay(window.as_of)}`;
}
