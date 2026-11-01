import type { AnswerCompleteness, PlanRequirementOutcomeRow } from "./contracts";
import { humanizeTerm } from "./presentation";

/**
 * The one "Missing data" sentence a `partial` or `degraded` answer adds (CHAOS-12429; the rule of
 * the old web panel's `missingDataSentence`, CHAOS-12245).
 *
 * CHAOS-12245, chris's ruling: the raw completeness state is a machine field, never display text.
 * `complete` and `not_derived` add nothing. `partial` and `degraded` add at most this one plain
 * sentence, built from the requirement rows, and it carries no state word.
 *
 * CHAOS-4690: no table over an ACR vocabulary. The requirement is named by `humanizeTerm` of the
 * served obligation, and what became of it by `humanizeTerm` of the served `outcome` (the rows
 * carry no label of their own). Whether a row is a gap is read from the served `impact`, which the
 * contract sets to `none` exactly when the outcome is `satisfied` or `not_applicable`, so no outcome
 * value is named here either.
 */
export const MISSING_DATA_LEAD = "Missing data";

/** The state words are never said, not even as an obligation's name (codex r3 on web #1650). */
const STATE_WORDS = new Set(["complete", "partial", "degraded", "not_derived"]);

/** Each requirement's last row: a later stage supersedes an earlier one. Rows naming no requirement are skipped. */
function lastRows(
    outcomes: readonly PlanRequirementOutcomeRow[],
): ReadonlyArray<readonly [string, PlanRequirementOutcomeRow]> {
    const last = new Map<string, PlanRequirementOutcomeRow>();
    for (const row of outcomes) {
        if (row.requirement === undefined || row.requirement === "") continue;
        last.set(row.requirement, row);
    }
    return [...last.entries()];
}

/** What a row needed: its obligation, else its requirement's first segment. `""` when it names nothing. */
function neededOf(row: PlanRequirementOutcomeRow, requirement: string): string {
    return row.obligation?.trim() || requirement.split("/")[0]?.trim() || "";
}

function gapOf(row: PlanRequirementOutcomeRow, requirement: string): string | null {
    if (row.impact === "none") return null;
    const needed = neededOf(row, requirement);
    if (needed === "" || STATE_WORDS.has(needed.toLowerCase())) return null;
    const what = humanizeTerm(needed).toLowerCase();
    const how = humanizeTerm(row.outcome);
    return row.declared > 0 && row.served < row.declared
        ? `${what} ${how} (${String(row.served)} of ${String(row.declared)})`
        : `${what} ${how}`;
}

/** The sentence, or `null` for every other state and when no row names a gap. */
export function missingDataSentence(completeness: AnswerCompleteness): string | null {
    if (completeness.state !== "partial" && completeness.state !== "degraded") return null;
    const gaps = lastRows(completeness.outcomes ?? [])
        .map(([requirement, row]) => gapOf(row, requirement))
        .filter((gap): gap is string => gap !== null);
    return gaps.length === 0 ? null : `${MISSING_DATA_LEAD}: ${gaps.join("; ")}.`;
}
