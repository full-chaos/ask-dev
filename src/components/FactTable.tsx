import { Details } from "./Details";
import { MeasureUnitWord } from "./MeasureUnitWord";
import { ScrollRegion } from "./ScrollRegion";
import { useVocabularyWord } from "./VocabularyWordContext";
import type { ClaimedFactRow, ClaimedFactTable, ScalarValue } from "../lib/contracts";
import { cellText, columnOrder, type ShownColumn, shownColumns } from "../lib/fact-rows";
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
 *
 * Where ACR declares a column's words (CHAOS-12635), the table shows them: an id column shows its
 * declared word column in its place, and a vocabulary column shows each value's served word (else
 * the generic path). The exact values, ids and tokens included, are then one collapsed "Exact
 * values" fold under the table, as the comparison table keeps its exact numbers. ask-dev holds no
 * word table (CHAOS-4690).
 */
export function FactTable({ rows, table, focusable }: FactTableProps) {
    const columns = columnOrder(rows);
    const { shown, exact } = shownColumns(columns, table);
    return (
        <>
            <RowsTable
                columns={shown}
                focusable={focusable}
                label="Facts"
                rows={rows}
                table={table}
            />
            {exact ? (
                <Details data-testid="fact-table-exact" summary="Exact values">
                    <RowsTable
                        columns={columns.map((column) => ({ header: column, source: column }))}
                        focusable={focusable}
                        label="Exact values"
                        rows={rows}
                        table={table}
                    />
                </Details>
            ) : null}
        </>
    );
}

function RowsTable({
    columns,
    rows,
    table,
    focusable,
    label,
}: {
    readonly columns: readonly ShownColumn[];
    readonly rows: readonly ClaimedFactRow[];
    readonly table: ClaimedFactTable | undefined;
    readonly focusable: boolean | undefined;
    readonly label: string;
}) {
    const word = useVocabularyWord();
    const cell = (column: ShownColumn, value: ScalarValue | undefined) =>
        column.vocabulary !== undefined && value?.string !== undefined
            ? word(column.vocabulary, value.string)
            : cellText(value);
    return (
        <ScrollRegion focusable={focusable} label={label}>
            <table className="fact-table">
                <thead>
                    <tr>
                        {columns.map((column) => (
                            <th key={column.header} scope="col">
                                {word("fact_field", column.header)}
                                <MeasureUnitWord
                                    className="fact-table__unit"
                                    unit={declaredUnit(table, column.source)}
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
                                <td key={column.header}>
                                    {cell(column, row.fields[column.source])}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </ScrollRegion>
    );
}
