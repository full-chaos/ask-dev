import type { ClaimedFactTable, InvestigationResult, RenderShape } from "./contracts";
import { citedTable } from "./measure-units";

/** ACR's closed cadence vocabulary (CHAOS-11985): `day`, on a daily `time_series` table only. */
export type Cadence = NonNullable<ClaimedFactTable["cadence"]>;

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DAY_MS = 86_400_000;

/**
 * The UTC day number of a `YYYY-MM-DD` key, or `undefined` for any other value, a date-time
 * included, and for a day the calendar does not have. A daily table keys its rows this way
 * (CHAOS-11985), so this is the only key a day cadence is read from.
 */
export function utcDayNumber(key: string): number | undefined {
    const match = DAY_KEY.exec(key);
    if (match === null) return undefined;
    const millis = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    // A day the calendar does not have rolls over to another day, and a year below 100 reads as
    // 19xx: either way the day no longer writes back as the same key.
    return new Date(millis).toISOString().slice(0, 10) === key ? millis / DAY_MS : undefined;
}

/**
 * Where a line over a daily table breaks (CHAOS-12571). With `cadence: "day"`, a day with no row is
 * a missing day: two served points more than one UTC day apart are not joined, so the line never
 * draws through a day nobody measured (North Star check 12). The result says, for two consecutive
 * served keys, whether the line breaks between them.
 *
 * `undefined` means the line joins as it always has: no cadence, or keys that do not keep the
 * cadence ACR states (a key not written `YYYY-MM-DD`, or a repeated day). Only what this render reads
 * is mirrored: such keys are logged, never refused, because ACR serves a cadence only on rows that
 * keep it and a mismatch here is a defect to see, not an answer to hide.
 */
export function missingDayBreaks(
    cadence: Cadence | undefined,
    keys: readonly string[],
    context: string,
): ((before: string, after: string) => boolean) | undefined {
    if (cadence !== "day") return undefined;
    const days = keys.map(utcDayNumber);
    if (days.some((day) => day === undefined) || new Set(days).size !== days.length) {
        console.warn(
            "A daily table's keys do not keep its day cadence: the line is joined across every gap.",
            { context },
        );
        return undefined;
    }
    return (before, after) =>
        Math.abs((utcDayNumber(after) ?? Number.NaN) - (utcDayNumber(before) ?? Number.NaN)) > 1;
}

/**
 * The cadence of the tables a shape's points cite (CHAOS-12571): `day` when every point cites a
 * claimed-fact row of a table that states it, else `undefined`.
 */
export function shapeCadence(shape: RenderShape, result: InvestigationResult): Cadence | undefined {
    let cadence: Cadence | undefined;
    for (const series of shape.series) {
        for (const { source } of series.points) {
            const pointCadence = citedTable(source, result)?.cadence;
            if (pointCadence === undefined) return undefined;
            cadence = pointCadence;
        }
    }
    return cadence;
}
