import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DriversPanel } from "./DriversPanel";
import { FactChart } from "./FactChart";
import { FactRowsPanels } from "./FactRowsPanel";
import { VocabularyLabelsContext } from "./VocabularyWordContext";
import plainExample from "../contracts/examples/context_fabric_investigation_result.v1.json";
import type { ClaimedFact, ClaimedFactRow, InvestigationResult } from "../lib/contracts";

afterEach(cleanup);

const plain = plainExample as unknown as InvestigationResult;

/**
 * CHAOS-12510. The shape of the real served answer the ticket's repro read: one claim with a row
 * table, and ACR's words for its field and columns.
 */
const WORDS = {
    "fact_field:id": "ID",
    "fact_field:team_id": "Team ID",
    "fact_field:team_name": "Team name",
    "fact_field:mttr_hours": "MTTR (hours)",
};
const subject = { kind: "repository", canonical_id: "repository:1", label: "full-chaos/web" };
const rows: ClaimedFactRow[] = [
    { fields: { team_id: { string: "linear:CHAOS" }, team_name: { string: "Fullchaos" } } },
];
const claim = (extra: Partial<ClaimedFact> = {}) =>
    ({
        claim_id: "claim_1",
        kind: "identity",
        subject,
        field: "id",
        value: { string: "d29d160a" },
        rows,
        ...extra,
    }) as ClaimedFact;

function draw(facts: readonly ClaimedFact[], words: Record<string, string> = WORDS) {
    return render(
        <VocabularyLabelsContext.Provider value={words}>
            <FactRowsPanels facts={facts} result={undefined} />
        </VocabularyLabelsContext.Provider>,
    );
}

const headers = () => screen.getAllByRole("columnheader").map((node) => node.textContent);

describe("the fact table's columns", () => {
    it("read ACR's words", () => {
        draw([claim()]);
        expect(headers()).toEqual(["Team ID", "Team name"]);
    });

    it("take the generic path with no word", () => {
        draw([claim()], {});
        expect(headers()).toEqual(["team id", "team name"]);
    });

    it("read one word and leave the other generic", () => {
        draw([claim()], { "fact_field:team_id": "Team ID" });
        expect(headers()).toEqual(["Team ID", "team name"]);
    });
});

describe("the fact panel's title", () => {
    it("reads ACR's word for the field", () => {
        draw([claim()]);
        expect(screen.getByRole("heading", { level: 2, name: /·/u })).toHaveTextContent(/· ID$/u);
    });

    it("takes the generic path with no word", () => {
        draw([claim()], {});
        expect(screen.getByRole("heading", { level: 2, name: /·/u })).toHaveTextContent(/· id$/u);
    });

    it("a derived claim's field is free text, even with a word for that name", () => {
        const derived = claim({
            derived_from: [
                { fact_id: "a", field: "x" },
                { fact_id: "b", field: "y" },
            ],
        });
        draw([derived]);
        expect(screen.getByRole("heading", { level: 2, name: /·/u })).toHaveTextContent(/· id$/u);
    });
});

describe("the claims that cite one table", () => {
    const also = (extra: Partial<ClaimedFact> = {}) =>
        claim({ claim_id: "claim_2", field: "team_id", ...extra });

    it("name the others in ACR's words", () => {
        draw([claim(), also()]);
        expect(screen.getByTestId("fact-also-referenced")).toHaveTextContent("Team ID");
    });

    it("name a derived claim in its own words", () => {
        const derived = also({
            derived_from: [
                { fact_id: "a", field: "x" },
                { fact_id: "b", field: "y" },
            ],
        });
        draw([claim(), derived]);
        expect(screen.getByTestId("fact-also-referenced")).toHaveTextContent("team id");
    });
});

describe("a driver's claimed facts", () => {
    const shown = (claimed: ClaimedFact) => {
        const result = {
            ...plain,
            claimed_facts: [claimed],
            drivers: [{ ...plain.drivers[0], claimed_fact_ids: [claimed.claim_id] }],
            vocabulary_labels: WORDS,
        } as unknown as InvestigationResult;
        render(
            <VocabularyLabelsContext.Provider value={WORDS}>
                <DriversPanel result={result} />
            </VocabularyLabelsContext.Provider>,
        );
        return screen.getByTestId("driver-claimed-fact");
    };

    it("name a field in ACR's word", () => {
        expect(shown(claim())).toHaveTextContent("ID: d29d160a");
    });

    it("name a derived claim's field in its own words", () => {
        const derived = claim({
            derived_from: [
                { fact_id: "a", field: "x" },
                { fact_id: "b", field: "y" },
            ],
        });
        expect(shown(derived)).toHaveTextContent("id: d29d160a");
    });
});

describe("a tile", () => {
    it("reads ACR's word, with its unit", () => {
        draw([claim({ rows: [{ fields: { mttr_hours: { number: 4.5 } } }] })]);
        expect(within(screen.getByTestId("fact-tiles")).getByText("MTTR (hours)")).toBeVisible();
    });

    it("takes the generic path with no word", () => {
        draw([claim({ rows: [{ fields: { mttr_hours: { number: 4.5 } } }] })], {});
        expect(within(screen.getByTestId("fact-tiles")).getByText("mttr hours")).toBeVisible();
    });
});

describe("a chart", () => {
    const series: ClaimedFactRow[] = [1, 2, 3].map((n) => ({
        fields: {
            day: { string: `2026-10-0${n}` },
            mttr_hours: { number: n },
            team_id: { number: n },
        },
    }));
    const chart = (words: Record<string, string>) =>
        render(
            <VocabularyLabelsContext.Provider value={{ ...words, "fact_field:day": "Day" }}>
                <FactChart
                    axis={{ column: "day", kind: "time" }}
                    chartKind="line"
                    rows={series}
                    seriesColumns={["mttr_hours", "team_id"]}
                />
            </VocabularyLabelsContext.Provider>,
        );

    it("says its column and axis in ACR's words", () => {
        chart(WORDS);
        expect(screen.getByRole("img", { name: "MTTR (hours) by Day" })).toBeInTheDocument();
        expect(screen.getAllByText("MTTR (hours)").length).toBeGreaterThan(0);
    });

    it("takes the generic path with no word", () => {
        chart({});
        expect(screen.getByRole("img", { name: "mttr hours by Day" })).toBeInTheDocument();
    });
});
