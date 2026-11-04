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
 * A window boundary for a reader: the UTC day the service served. A boundary is a UTC instant at
 * midnight, so the reader's own zone would move it to the day before (CHAOS-13005).
 */
export function formatWindowDay(timestamp: string): string {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime())
        ? timestamp
        : date.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
              timeZone: "UTC",
          });
}

/**
 * The last day a window covers. The served end is an end-exclusive instant: at UTC midnight it
 * is the first day NOT covered, so the reader gets the day before; any other instant is its own
 * day (CHAOS-13005, lead ruling).
 */
function formatWindowEndDay(timestamp: string): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return timestamp;
    const atMidnight = date.getTime() % 86_400_000 === 0;
    return formatWindowDay(
        atMidnight ? new Date(date.getTime() - 86_400_000).toISOString() : timestamp,
    );
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
        return `${formatWindowDay(window.start)} – ${formatWindowEndDay(window.end)}`;
    }
    if (window?.relative_id !== undefined) {
        return vocabularyWord(labels, "window_relative_id", window.relative_id);
    }
    // A current-state snapshot window (acr #1791) carries only `as_of`.
    return window?.as_of === undefined ? undefined : `As of ${formatWindowDay(window.as_of)}`;
}
