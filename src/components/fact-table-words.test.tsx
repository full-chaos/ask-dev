import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FactTable } from "@/components/FactTable";
import { VocabularyLabelsContext } from "@/components/VocabularyWordContext";
import type { ClaimedFact, InvestigationResult } from "@/lib/contracts";
import { humanizeTerm } from "@/lib/presentation";
import { servedShapeScenarios } from "@/test/fixtures/served-shapes";

afterEach(cleanup);

/**
 * A declared table's rows in served words (CHAOS-12635). ACR declares, per table, the vocabulary of
 * a column's values (`column_vocabularies`) and the column that carries an id column's word
 * (`word_columns`). The table shows those words, and the exact values (ids and tokens) stay in one
 * collapsed fold under it. ask-dev holds no word table (CHAOS-4690): every word here is served.
 */

function renderClaim(answer: InvestigationResult, claim: ClaimedFact) {
    return render(
        <VocabularyLabelsContext.Provider value={answer.vocabulary_labels}>
            <FactTable rows={claim.rows ?? []} table={claim.table} />
        </VocabularyLabelsContext.Provider>,
    );
}

/** The visible table: the first one, outside the fold. */
function visibleTable(): HTMLElement {
    const tables = screen.getAllByRole("table");
    const visible = tables.find((table) => table.closest("details") === null);
    if (visible === undefined) throw new Error("no table outside the fold");
    return visible;
}

const headers = (table: HTMLElement) =>
    within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent);

const column = (table: HTMLElement, index: number) =>
    within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("cell")[index]?.textContent);

describe("a declared table shows served words, and keeps the exact values in a fold", () => {
    const sankey = servedShapeScenarios["repository-flow-sankey"];
    const flow = sankey.claimed_facts[0]!;

    it("the fixture is the case: ACR declares the theme's vocabulary and the repository's word column", () => {
        expect(flow.table?.column_vocabularies).toEqual({ theme: "investment_theme" });
        expect(flow.table?.word_columns).toEqual({ repository: "repository_label" });
    });

    it("a repository shows its served word in place of its id, once", () => {
        renderClaim(sankey, flow);
        const table = visibleTable();
        // One column for the pair, under the word column's served header.
        expect(headers(table)).toEqual([
            "Repository",
            "Theme",
            "Team weighted effort in the theme",
            "Weighted effort",
        ]);
        expect(column(table, 0)).toEqual(
            flow.rows!.map((row) => row.fields.repository_label?.string),
        );
        expect(table.textContent).not.toContain("repository:");
    });

    it("a theme shows its served word, never its token", () => {
        renderClaim(sankey, flow);
        const themes = column(visibleTable(), 1);
        expect(themes).toContain("Feature Delivery");
        expect(themes).toContain("Maintenance / Tech Debt");
        expect(themes.join(" ")).not.toMatch(/feature_delivery|maintenance|operational|quality/u);
    });

    it("the exact values stay in one collapsed fold: every id and every token", () => {
        renderClaim(sankey, flow);
        const fold = screen.getByTestId("fact-table-exact");
        expect(fold.tagName).toBe("DETAILS");
        expect(fold).not.toHaveAttribute("open");
        expect(within(fold).getByText("Exact values")).toBeInTheDocument();
        const exact = within(fold).getByRole("table");
        for (const row of flow.rows!) {
            expect(exact.textContent).toContain(row.fields.repository!.string!);
            expect(exact.textContent).toContain(row.fields.theme!.string!);
        }
    });

    it("the treemap's theme_breakdown shows its themes in served words too", () => {
        const treemap = servedShapeScenarios["investment-treemap"];
        const breakdown = treemap.claimed_facts[0]!;
        expect(breakdown.table?.column_vocabularies).toEqual({ theme: "investment_theme" });
        renderClaim(treemap, breakdown);
        const themes = column(visibleTable(), headers(visibleTable()).indexOf("Theme"));
        expect(themes).toEqual([
            "Feature Delivery",
            "Operational / Support",
            "Maintenance / Tech Debt",
            "Quality / Reliability",
            "Risk / Security",
        ]);
        expect(screen.getByTestId("fact-table-exact")).toBeInTheDocument();
    });

    it("a table ACR declares no words for is drawn as served, with no fold", () => {
        const plain = structuredClone(flow);
        delete plain.table!.column_vocabularies;
        delete plain.table!.word_columns;
        renderClaim(sankey, plain);
        const table = visibleTable();
        expect(headers(table)).toEqual([
            "Repository id",
            "Repository",
            "Theme",
            "Team weighted effort in the theme",
            "Weighted effort",
        ]);
        expect(column(table, 0)[0]).toBe(plain.rows![0]!.fields.repository!.string);
        expect(screen.queryByTestId("fact-table-exact")).toBeNull();
    });

    it("a word column alone, with no vocabulary, still keeps the ids in the fold", () => {
        const wordsOnly = structuredClone(flow);
        delete wordsOnly.table!.column_vocabularies;
        renderClaim(sankey, wordsOnly);
        expect(visibleTable().textContent).not.toContain("repository:");
        const fold = screen.getByTestId("fact-table-exact");
        expect(within(fold).getByRole("table").textContent).toContain(
            wordsOnly.rows![0]!.fields.repository!.string!,
        );
    });

    it("with no served word a token takes the generic path, and the fold keeps it exact", () => {
        const unworded = structuredClone(sankey);
        delete unworded.vocabulary_labels!["investment_theme:feature_delivery"];
        renderClaim(unworded, unworded.claimed_facts[0]!);
        const themes = column(visibleTable(), 1);
        // The generic path every unworded vocabulary value takes, never the raw token.
        expect(themes).toContain(humanizeTerm("feature_delivery"));
        expect(themes).not.toContain("feature_delivery");
        const fold = screen.getByTestId("fact-table-exact");
        expect(within(fold).getByRole("table").textContent).toContain("feature_delivery");
    });

    it("a row with no word for its id shows a dash, never the id, and the fold keeps the id", () => {
        const missing = structuredClone(flow);
        delete missing.rows![0]!.fields.repository_label;
        renderClaim(sankey, missing);
        const repositories = column(visibleTable(), 0);
        expect(repositories[0]).toBe("—");
        expect(visibleTable().textContent).not.toContain("repository:");
        const fold = screen.getByTestId("fact-table-exact");
        expect(within(fold).getByRole("table").textContent).toContain(
            missing.rows![0]!.fields.repository!.string!,
        );
    });

    it("a declared word column the rows never carry gives dashes, never the ids", () => {
        const absent = structuredClone(flow);
        absent.table!.word_columns = { repository: "repository_handle" };
        renderClaim(sankey, absent);
        const repositories = column(visibleTable(), 0);
        expect(new Set(repositories)).toEqual(new Set(["—"]));
        expect(visibleTable().textContent).not.toContain("repository:");
    });
});
