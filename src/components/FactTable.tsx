import type { ClaimedFactRow } from "@/lib/contracts";
import { cellText, columnOrder } from "@/lib/fact-rows";
import { humanizeTerm } from "@/lib/presentation";

export type FactTableProps = {
    readonly rows: readonly ClaimedFactRow[];
};

/**
 * The default rendering for a claimed fact's `rows` (CHAOS-4347): a plain
 * scrollable table, one `<tr>` per `ClaimedFactRow`, columns in first-seen
 * order. A row missing a column another row has renders an em dash for that
 * cell — the workbench never fills a gap with an inferred value.
 */
export function FactTable({ rows }: FactTableProps) {
    const columns = columnOrder(rows);
    return (
        <div className="fact-table-wrap">
            <table className="fact-table">
                <thead>
                    <tr>
                        {columns.map((column) => (
                            <th key={column} scope="col">
                                {humanizeTerm(column)}
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
        </div>
    );
}
