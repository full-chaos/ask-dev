import { MeasureUnitWord } from "./MeasureUnitWord";
import { ScrollRegion } from "./ScrollRegion";
import { useVocabularyWord } from "./VocabularyWordContext";
import type { ClaimedFactRow, ClaimedFactTable } from "../lib/contracts";
import { cellText, columnOrder } from "../lib/fact-rows";
import { declaredUnit } from "../lib/measure-units";

export type FactTableProps = {
    readonly rows: readonly ClaimedFactRow[];
    /** What `rows` is, as ACR declares it: a declared measure's unit goes under its column word. */
    readonly table?: ClaimedFactTable | undefined;
    /** False for the table a chart keeps for screen readers: see `ScrollRegion`. */
    readonly focusable?: boolean;
};

/**
 * The default rendering for a claimed fact's `rows` (CHAOS-4347): a plain
 * scrollable table, one `<tr>` per `ClaimedFactRow`, columns in first-seen
 * order. A row missing a column another row has renders an em dash for that
 * cell — the workbench never fills a gap with an inferred value.
 *
 * A declared measure's served unit word is a muted second line under its column word
 * (CHAOS-12570). The cells stay exactly as served: a ratio is not turned into a percent.
 */
export function FactTable({ rows, table, focusable }: FactTableProps) {
    const word = useVocabularyWord();
    const columns = columnOrder(rows);
    return (
        <ScrollRegion focusable={focusable} label="Facts">
            <table className="fact-table">
                <thead>
                    <tr>
                        {columns.map((column) => (
                            <th key={column} scope="col">
                                {word("fact_field", column)}
                                <MeasureUnitWord
                                    className="fact-table__unit"
                                    unit={declaredUnit(table, column)}
                                />
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, index) => (
                        // Rows carry no id of their own (ClaimedFactRow is a
                        // plain fields map) — index is stable because this
                        // list is never reordered or filtered client-side.
                        <tr key={index}>
                            {columns.map((column) => (
                                <td key={column}>{cellText(row.fields[column])}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </ScrollRegion>
    );
}
