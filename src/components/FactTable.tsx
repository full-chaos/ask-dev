import { ScrollRegion } from "./ScrollRegion";
import { useVocabularyWord } from "./VocabularyWordContext";
import type { ClaimedFactRow } from "../lib/contracts";
import { cellText, columnOrder } from "../lib/fact-rows";

export type FactTableProps = {
    readonly rows: readonly ClaimedFactRow[];
    /** False for the table a chart keeps for screen readers: see `ScrollRegion`. */
    readonly focusable?: boolean;
};

/**
 * The default rendering for a claimed fact's `rows` (CHAOS-4347): a plain
 * scrollable table, one `<tr>` per `ClaimedFactRow`, columns in first-seen
 * order. A row missing a column another row has renders an em dash for that
 * cell — the workbench never fills a gap with an inferred value.
 */
export function FactTable({ rows, focusable }: FactTableProps) {
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
