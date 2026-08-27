import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FactRowsPanels } from "@/components/FactRowsPanel";
import { mockScenarios } from "@/test/fixtures/investigations";

const rowsResult = mockScenarios().find((scenario) => scenario.id === "rows")!.result;
const completeResult = mockScenarios().find((scenario) => scenario.id === "complete")!.result;

describe("FactRowsPanels", () => {
    it("renders nothing when no claimed fact carries rows (empty state = no data, not a missing feature)", () => {
        expect(completeResult.claimed_facts.every((fact) => fact.rows === undefined)).toBe(true);
        const { container } = render(<FactRowsPanels facts={completeResult.claimed_facts} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("renders one panel per claimed fact carrying rows", () => {
        render(<FactRowsPanels facts={rowsResult.claimed_facts} />);
        // Three facts in the fixture carry rows: the CI daily rollup, the
        // project's team breakdown, and the latency-percentiles table.
        expect(
            screen.getByRole("heading", { name: /continuous integration.*pipelines count/i }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("heading", { name: /metrics.*team breakdown/i }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("heading", { name: /metrics.*latency percentiles/i }),
        ).toBeInTheDocument();
    });

    it("renders a LINE chart for the time-axis CI rollup", () => {
        render(<FactRowsPanels facts={rowsResult.claimed_facts} />);
        const heading = screen.getByRole("heading", {
            name: /continuous integration.*pipelines count/i,
        });
        const panel = heading.closest("section")!;
        expect(panel.querySelector("svg")).not.toBeNull();
        expect(panel.querySelector("polyline")).not.toBeNull();
        expect(panel.querySelector("table")).toBeNull();
    });

    it("renders a BAR chart for the ordinal team_name breakdown, with the rollup_basis caption", () => {
        render(<FactRowsPanels facts={rowsResult.claimed_facts} />);
        const heading = screen.getByRole("heading", { name: /metrics.*team breakdown/i });
        const panel = heading.closest("section")!;
        expect(panel.querySelector("svg")).not.toBeNull();
        expect(panel.querySelector("polyline")).toBeNull();
        expect(panel.textContent).toContain("team project ownership sum");
    });

    it("falls back to a TABLE when every row column is numeric", () => {
        render(<FactRowsPanels facts={rowsResult.claimed_facts} />);
        const heading = screen.getByRole("heading", { name: /metrics.*latency percentiles/i });
        const panel = heading.closest("section")!;
        expect(panel.querySelector("table")).not.toBeNull();
        expect(panel.querySelector("svg")).toBeNull();
        expect(panel.textContent).toContain("55.6");
    });

    it("always shows the subject and row count in the caption, even with no rollup_basis sibling", () => {
        render(<FactRowsPanels facts={rowsResult.claimed_facts} />);
        const heading = screen.getByRole("heading", {
            name: /continuous integration.*pipelines count/i,
        });
        const panel = heading.closest("section")!;
        expect(panel.textContent).toContain("full-chaos/ask-dev");
        expect(panel.textContent).toContain("3 rows");
    });
});
