import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DriversPanel } from "./DriversPanel";
import { ScalarFactsPanel } from "./ScalarFactsPanel";
import { VocabularyLabelsContext } from "./VocabularyWordContext";
import plainExample from "../contracts/examples/context_fabric_investigation_result.v1.json";
import type { ClaimedFact, InvestigationResult } from "../lib/contracts";

afterEach(cleanup);

/** CHAOS-12516: the shape ACR's real `Validate` accepts for a derived claim. */
const plain = plainExample as unknown as InvestigationResult;
const WORDS = { "fact_field:commits_count": "Commits" };
const derived = {
    claim_id: "claim_derived",
    kind: "metrics",
    subject: { kind: "project", canonical_id: "project:1", label: "Ask Dev" },
    field: "total_activity",
    value: { integer: 43 },
    operation: "sum",
    derived_from: [
        { fact_id: "fact_a", field: "commits_count" },
        { fact_id: "fact_b", field: "backlog_size" },
    ],
} as unknown as ClaimedFact;
const { derived_from: _inputs, operation: _operation, ...observed } = derived;

function scalar(fact: ClaimedFact) {
    render(
        <VocabularyLabelsContext.Provider value={WORDS}>
            <ScalarFactsPanel facts={[fact]} result={undefined} />
        </VocabularyLabelsContext.Provider>,
    );
    return screen.getByTestId("scalar-fact-raw");
}

function driver(fact: ClaimedFact) {
    const result = {
        ...plain,
        claimed_facts: [fact],
        drivers: [{ ...plain.drivers[0], claimed_fact_ids: [fact.claim_id] }],
    } as unknown as InvestigationResult;
    render(
        <VocabularyLabelsContext.Provider value={WORDS}>
            <DriversPanel result={result} />
        </VocabularyLabelsContext.Provider>,
    );
    return screen.getByTestId("driver-claimed-fact");
}

describe("a derived number equal to a table's cell", () => {
    const table = {
        ...observed,
        claim_id: "claim_table",
        field: "rollup",
        value: { string: "x" },
        rows: [{ fields: { total_activity: { integer: 43 } } }],
    } as unknown as ClaimedFact;

    it("keeps its own line: the cell does not say how it was made", () => {
        render(
            <VocabularyLabelsContext.Provider value={WORDS}>
                <ScalarFactsPanel facts={[table, derived]} result={undefined} />
            </VocabularyLabelsContext.Provider>,
        );
        expect(screen.getByTestId("claim-derivation")).toHaveTextContent("operation: sum");
    });
});

describe.each([
    ["the scalar panel's fold", scalar],
    ["a driver's claimed facts", driver],
])("%s", (_name, draw) => {
    it("states the operation and every input", () => {
        const line = within(draw(derived)).getByTestId("claim-derivation");
        expect(line).toHaveTextContent("operation: sum");
        expect(line).toHaveTextContent("derived_from: Commits, backlog size");
    });

    it("is in a fold", () => {
        expect(draw(derived).closest("details")).not.toBeNull();
    });

    it("draws nothing for a claim that is not derived", () => {
        expect(within(draw(observed as ClaimedFact)).queryByTestId("claim-derivation")).toBeNull();
    });

    it("draws nothing for odd restored inputs, and does not throw", () => {
        const odd = { ...derived, derived_from: { unexpected: 1 } } as unknown as ClaimedFact;
        expect(within(draw(odd)).queryByTestId("claim-derivation")).toBeNull();
    });

    it("shows an odd operation as it came, and does not throw", () => {
        const odd = { ...derived, operation: { unexpected: 1 } } as unknown as ClaimedFact;
        expect(within(draw(odd)).getByTestId("claim-derivation")).toHaveTextContent(
            'operation: {"unexpected":1}',
        );
    });

    it("names no operation when the claim has none", () => {
        const { operation: _gone, ...noOperation } = derived;
        const line = within(draw(noOperation)).getByTestId("claim-derivation");
        expect(line).not.toHaveTextContent("operation");
        expect(line).toHaveTextContent("derived_from: Commits, backlog size");
    });

    it("draws nothing when no input names a field", () => {
        const odd = { ...derived, derived_from: [{}, null] } as unknown as ClaimedFact;
        expect(within(draw(odd)).queryByTestId("claim-derivation")).toBeNull();
    });

    it("skips an input that names no field", () => {
        const odd = {
            ...derived,
            derived_from: [{ fact_id: "fact_a", field: "commits_count" }, null, {}],
        } as unknown as ClaimedFact;
        expect(within(draw(odd)).getByTestId("claim-derivation")).toHaveTextContent(
            "derived_from: Commits",
        );
    });
});
