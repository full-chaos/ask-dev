import { useServedWord } from "./VocabularyWordContext";
import type { MeasureUnit } from "../lib/measure-units";

/**
 * ACR's word for a measure's declared unit (CHAOS-12570): its `measure_unit:<unit>` label and
 * nothing else. No unit, or no word in this answer's map (the labels flag is off), draws nothing:
 * never the raw token and never a table of our own (CHAOS-4690).
 */
export function MeasureUnitWord({
    unit,
    className,
    testId = "measure-unit",
}: {
    readonly unit: MeasureUnit | undefined;
    readonly className: string;
    readonly testId?: string;
}) {
    const served = useServedWord();
    const word = unit === undefined ? undefined : served("measure_unit", unit);
    if (word === undefined) return null;
    return (
        <span className={className} data-testid={testId}>
            {word}
        </span>
    );
}

/** The same word as text, for a label that is a string (`aria-label`), or `undefined`. */
export function useMeasureUnitWord(): (unit: MeasureUnit | undefined) => string | undefined {
    const served = useServedWord();
    return (unit) => (unit === undefined ? undefined : served("measure_unit", unit));
}
