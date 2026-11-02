import { useId } from "react";

import { DerivationInputs } from "./DerivationInputs";
import { ScrollRegion } from "./ScrollRegion";
import { useServedWord } from "./VocabularyWordContext";
import { unrankedWorkItemMembers } from "./WorkItemStatusPanel";
import { askedForCohort } from "../lib/cohort-ranking";
import type { ClaimedFact, InvestigationResult } from "../lib/contracts";
import { cellText, cellValue, factsWithRows, findRollupBasis, sameSubject } from "../lib/fact-rows";
import { nonBlank } from "../lib/presentation";

/** No table draws a fact on a person, and `ScalarFactsPanel` says one is held. */
export const aboutNoPerson = (fact: ClaimedFact): boolean => fact.subject.kind !== "person";

/** A restored answer is not validated, so a claim that lacks a part draws no row. */
function readable(fact: ClaimedFact): boolean {
    const { subject, field, value } = fact as Partial<ClaimedFact> & { value?: unknown };
    return (
        typeof subject?.label === "string" &&
        typeof field === "string" &&
        typeof value === "object" &&
        value !== null
    );
}

/** A claim of the same subject and kind draws this field and value as a table cell or a tile. */
function isCell(fact: ClaimedFact, tables: readonly ClaimedFact[]): boolean {
    // A cell does not say how a derived number was made, so that claim keeps its own line.
    if ((fact.derived_from?.length ?? 0) > 0) return false;
    const value = cellValue(fact.value);
    return tables.some(
        (table) =>
            table.kind === fact.kind &&
            sameSubject(table.subject, fact.subject) &&
            table.rows?.some(
                (row) =>
                    Object.hasOwn(row.fields, fact.field) &&
                    cellValue(row.fields[fact.field]!) === value,
            ),
    );
}

/** The caption of a table on the same subject and kind reads this basis. */
function isRollupBasis(
    fact: ClaimedFact,
    tables: readonly ClaimedFact[],
    facts: readonly ClaimedFact[],
): boolean {
    return (
        fact.field === "rollup_basis" &&
        tables.some(
            (table) =>
                table.kind === fact.kind &&
                sameSubject(table.subject, fact.subject) &&
                findRollupBasis(facts, table) === cellValue(fact.value),
        )
    );
}

/** `WorkItemStatusPanel` draws every status claim of the work items it lists. */
function isInStatusTable(fact: ClaimedFact, result: InvestigationResult | undefined): boolean {
    const shape = result?.interpretation?.shape;
    if (shape === undefined || fact.kind !== "status") return false;
    if (!askedForCohort(shape, result)) return false;
    return unrankedWorkItemMembers(result?.cohort).some((member) =>
        sameSubject(member.subject, fact.subject),
    );
}

/** The same subject, kind, field and value is one fact, however many claims cite it. */
const factIdentity = (fact: ClaimedFact): string =>
    JSON.stringify([
        fact.subject.kind,
        fact.subject.canonical_id,
        fact.kind,
        fact.field,
        cellValue(fact.value),
    ]);

export type ScalarFacts = {
    /** The facts with no place on screen, in the service's order, each once. */
    readonly facts: readonly ClaimedFact[];
    /** A fact on a person was left out, so the panel says so. Never a name or a value. */
    readonly personHeld: boolean;
};

/**
 * CHAOS-12478: a claimed fact with a value and no `rows` had no render, so it reached the screen
 * only if the prose repeated it. These are the facts this panel draws: not one that a table, a tile,
 * a caption or the status table draws already. A chart is drawn only by a panel with `rows`, so a
 * fact with no `rows` has no chart to count on.
 */
export function scalarFacts(
    claimed: readonly ClaimedFact[],
    result: InvestigationResult | undefined,
): ScalarFacts {
    const facts = claimed.filter(readable);
    const tables = factsWithRows(facts);
    const seen = new Set<string>();
    let personHeld = false;
    const shown = facts.filter((fact) => {
        // The platform's boundary: no view lists people beside each other (AGENTS.md).
        if (!aboutNoPerson(fact)) {
            personHeld = true;
            return false;
        }
        if ((fact.rows?.length ?? 0) > 0) return false;
        if (isCell(fact, tables) || isRollupBasis(fact, tables, facts)) return false;
        if (isInStatusTable(fact, result)) return false;
        const identity = factIdentity(fact);
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
    });
    return { facts: shown, personHeld };
}

/** Each of null, blank, zero and false reads as what it is (check 12). */
function valueText(fact: ClaimedFact): string {
    const text = cellText(fact.value);
    return nonBlank(text) === undefined ? "(blank)" : text;
}

export type ScalarFactsPanelProps = {
    readonly facts: readonly ClaimedFact[];
    readonly result: InvestigationResult | undefined;
};

/**
 * One table for the facts that no other panel draws. A field reads ACR's served word, whose unit
 * stands in the label. A derived claim's field is free text, and a field with no word has no place
 * in the table: its raw name stays in the closed fold (CHAOS-4690).
 */
export function ScalarFactsPanel({ facts, result }: ScalarFactsPanelProps) {
    const idPrefix = useId();
    const served = useServedWord();
    const { facts: shown, personHeld } = scalarFacts(facts, result);
    if (shown.length === 0 && !personHeld) return null;

    const label = (fact: ClaimedFact): string | undefined =>
        (fact.derived_from?.length ?? 0) === 0 ? served("fact_field", fact.field) : undefined;
    const worded = shown.filter((fact) => label(fact) !== undefined);
    const raw = shown.filter((fact) => label(fact) === undefined);
    const titleId = `${idPrefix}-scalar-facts-title`;
    return (
        <section
            role="group"
            className="panel"
            aria-labelledby={titleId}
            data-testid="scalar-facts-panel"
        >
            <h2 className="panel__title" id={titleId}>
                Facts in this answer
            </h2>
            {worded.length === 0 ? null : (
                <ScrollRegion label="Facts">
                    <table className="fact-table">
                        <thead>
                            <tr>
                                <th scope="col">Subject</th>
                                <th scope="col">Fact</th>
                                <th scope="col">Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            {worded.map((fact) => (
                                <tr key={factIdentity(fact)}>
                                    <td>{fact.subject.label}</td>
                                    <td>{label(fact)}</td>
                                    <td>{valueText(fact)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </ScrollRegion>
            )}
            {raw.length === 0 ? null : (
                <details className="disclosure" data-testid="scalar-facts-details">
                    <summary>Details</summary>
                    {raw.map((fact) => (
                        <p
                            className="record__meta"
                            data-testid="scalar-fact-raw"
                            key={factIdentity(fact)}
                        >
                            {fact.subject.label}:{" "}
                            <code>
                                {fact.field}: {valueText(fact)}
                            </code>
                            <DerivationInputs claim={fact} />
                        </p>
                    ))}
                </details>
            )}
            {personHeld ? (
                <p className="record__meta" data-testid="scalar-facts-person">
                    A fact about a person is not shown in this view.
                </p>
            ) : null}
        </section>
    );
}
