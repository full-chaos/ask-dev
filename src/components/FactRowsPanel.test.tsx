import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FactRowsPanels } from "@/components/FactRowsPanel";
import renderShapesExample from "@/contracts/examples/context_fabric_investigation_result_render_shapes.v1.json";
import type { ClaimedFact, InvestigationResult } from "@/lib/contracts";
import { mockScenarios } from "@/test/fixtures/investigations";

/** A claimed fact carrying no `rows` at all — the "nothing to render" case. */
const NO_ROWS_FACT: ClaimedFact = {
    claim_id: "claim_no_rows",
    kind: "status",
    subject: { kind: "project", canonical_id: "project_ask_dev", label: "Ask Dev" },
    field: "current_phase",
    value: { string: "steady" },
};

const rowsResult = mockScenarios().find((scenario) => scenario.id === "rows")!.result;
const completeResult = mockScenarios().find((scenario) => scenario.id === "complete")!.result;
// CHAOS-4364 (acr #307, 56316ebe): the `flow`/`landscape` FactKinds. No
// kind-specific rendering exists in FactRowsPanel — `humanizeTerm(fact.kind)`
// is generic over every kind — so these prove that generic path actually
// covers the two new kinds, not just the pre-existing ones.
const flowLandscapeResult = mockScenarios().find(
    (scenario) => scenario.id === "flow-landscape",
)!.result;

describe("FactRowsPanels", () => {
    it("renders nothing when no claimed fact carries rows (empty state = no data, not a missing feature)", () => {
        const { container } = render(<FactRowsPanels facts={[NO_ROWS_FACT]} result={undefined} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("renders the complete scenario's own rows-bearing fact (readiness/release_ready, acr #303)", () => {
        // CHAOS-4364 pin bump: the pinned canonical example itself now
        // carries a rows-bearing claimed fact — this is that fact, not a
        // fixture invention (see `investigations.ts`'s CHAOS-2225 house rule).
        expect(completeResult.claimed_facts.some((fact) => fact.rows !== undefined)).toBe(true);
        render(<FactRowsPanels facts={completeResult.claimed_facts} result={undefined} />);
        expect(
            screen.getByRole("heading", { name: /readiness.*release ready/i }),
        ).toBeInTheDocument();
    });

    it("renders one panel per claimed fact carrying rows", () => {
        render(<FactRowsPanels facts={rowsResult.claimed_facts} result={undefined} />);
        // Three facts in the fixture carry rows: the CI daily rollup, the
        // project's team_count claim (team_breakdown rows attached), and
        // the latency-percentiles table.
        expect(
            screen.getByRole("heading", { name: /continuous integration.*pipelines count/i }),
        ).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: /metrics.*team count/i })).toBeInTheDocument();
        expect(
            screen.getByRole("heading", { name: /metrics.*latency percentiles/i }),
        ).toBeInTheDocument();
    });

    it("renders a LINE chart for the time-axis CI rollup, plus a screen-reader-only data table", () => {
        render(<FactRowsPanels facts={rowsResult.claimed_facts} result={undefined} />);
        const heading = screen.getByRole("heading", {
            name: /continuous integration.*pipelines count/i,
        });
        const panel = heading.closest("section")!;
        expect(panel.querySelector("svg")).not.toBeNull();
        expect(panel.querySelector("polyline")).not.toBeNull();
        // The chart is not the only way to reach this data: a full table is
        // always present too (visually hidden here since nothing was
        // truncated from the chart) — codex round 1, CHAOS-4355.
        const table = panel.querySelector("table");
        expect(table).not.toBeNull();
        expect(table!.closest(".sr-only")).not.toBeNull();
    });

    it("renders a BAR chart for the ordinal team_name breakdown (never the opaque team_id), with the rollup_basis caption", () => {
        render(<FactRowsPanels facts={rowsResult.claimed_facts} result={undefined} />);
        const heading = screen.getByRole("heading", { name: /metrics.*team count/i });
        const panel = heading.closest("section")!;
        expect(panel.querySelector("svg")).not.toBeNull();
        expect(panel.querySelector("polyline")).toBeNull();
        expect(panel.textContent).toContain("team project ownership sum");
        // The fixture row carries BOTH team_id and team_name (real producer
        // shape, codex round 1). The CHART's own axis labels must be the
        // readable name, never the opaque id — the id can still legitimately
        // appear in the accompanying accessible data table (checked below),
        // just not as the chart's chosen axis.
        const svg = panel.querySelector("svg")!;
        expect(svg.textContent).toContain("Platform");
        expect(svg.textContent).toContain("Growth");
        expect(svg.textContent).not.toContain("team_platform_9f2a");
        expect(svg.textContent).not.toContain("team_growth_c410");
        const table = panel.querySelector("table")!;
        expect(table.textContent).toContain("team_platform_9f2a");
    });

    it("gives every chart mark an accessible label, not just a hover/mouse tooltip", () => {
        render(<FactRowsPanels facts={rowsResult.claimed_facts} result={undefined} />);
        const heading = screen.getByRole("heading", { name: /metrics.*team count/i });
        const panel = heading.closest("section")!;
        const marks = panel.querySelectorAll(".fact-chart__mark-group");
        expect(marks.length).toBeGreaterThan(0);
        for (const mark of Array.from(marks)) {
            expect(mark.getAttribute("aria-label")).toBeTruthy();
            expect(mark.getAttribute("tabindex")).toBe("0");
        }
    });

    it("falls back to a TABLE when every row column is numeric", () => {
        render(<FactRowsPanels facts={rowsResult.claimed_facts} result={undefined} />);
        const heading = screen.getByRole("heading", { name: /metrics.*latency percentiles/i });
        const panel = heading.closest("section")!;
        expect(panel.querySelector("table")).not.toBeNull();
        expect(panel.querySelector("svg")).toBeNull();
        expect(panel.textContent).toContain("55.6");
    });

    it("always shows the subject and row count in the caption, even with no rollup_basis sibling", () => {
        render(<FactRowsPanels facts={rowsResult.claimed_facts} result={undefined} />);
        const heading = screen.getByRole("heading", {
            name: /continuous integration.*pipelines count/i,
        });
        const panel = heading.closest("section")!;
        expect(panel.textContent).toContain("full-chaos/ask-dev");
        expect(panel.textContent).toContain("3 rows");
    });

    it("shows a visible table and a note when the row set has more numeric columns than the chart can plot", () => {
        const manyColumnsFact: ClaimedFact = {
            claim_id: "claim_many_columns",
            kind: "metrics",
            subject: { kind: "project", canonical_id: "project_wide", label: "Wide" },
            field: "wide_breakdown",
            value: { integer: 1 },
            rows: [
                {
                    fields: {
                        team_name: { string: "Platform" },
                        c1: { integer: 1 },
                        c2: { integer: 2 },
                        c3: { integer: 3 },
                        c4: { integer: 4 },
                        c5: { integer: 5 },
                        c6: { integer: 6 },
                        c7: { integer: 7 },
                        c8: { integer: 8 },
                        c9: { integer: 9 },
                    },
                },
                {
                    fields: {
                        team_name: { string: "Growth" },
                        c1: { integer: 1 },
                        c2: { integer: 2 },
                        c3: { integer: 3 },
                        c4: { integer: 4 },
                        c5: { integer: 5 },
                        c6: { integer: 6 },
                        c7: { integer: 7 },
                        c8: { integer: 8 },
                        c9: { integer: 9 },
                    },
                },
            ],
        };
        render(<FactRowsPanels facts={[manyColumnsFact]} result={undefined} />);
        const heading = screen.getByRole("heading", { name: /metrics.*wide breakdown/i });
        const panel = heading.closest("section")!;
        expect(panel.textContent).toContain("1 more numeric column");
        const table = panel.querySelector("table");
        expect(table).not.toBeNull();
        // Unlike the untruncated case above, this table is genuinely
        // visible — it is the only place the 9th column ("c9") appears.
        expect(table!.closest(".sr-only")).toBeNull();
    });

    it("renders a panel for the flow FactKind's team_count claim (team_id axis, since flow.go emits no team_name)", () => {
        render(<FactRowsPanels facts={flowLandscapeResult.claimed_facts} result={undefined} />);
        // The claim cites `team_count` (a real scalar sibling field) per
        // acr's own claim-grounding rule — `team_breakdown` itself carries
        // only Rows, no scalar (codex round 1, CHAOS-4364) — but the rows
        // still attach to it, by (kind, subject), same as production.
        const heading = screen.getByRole("heading", { name: /^flow · team count$/i });
        const panel = heading.closest("section")!;
        // Every row column here is numeric except team_id, so team_id is the
        // only axis candidate and IS charted despite being id-shaped —
        // devhealthfacts/flow.go's real project rollup carries no
        // human-readable team_name alongside it (unlike metrics.go's).
        expect(panel.querySelector("svg")).not.toBeNull();
        const svg = panel.querySelector("svg")!;
        expect(svg.textContent).toContain("team_platform_9f2a");
        expect(panel.textContent).toContain("team project ownership sum");
        expect(panel.textContent).toContain("2 rows");
    });

    it("renders a panel for the landscape FactKind's team_count claim", () => {
        render(<FactRowsPanels facts={flowLandscapeResult.claimed_facts} result={undefined} />);
        const heading = screen.getByRole("heading", { name: /^landscape · team count$/i });
        const panel = heading.closest("section")!;
        expect(panel.querySelector("svg")).not.toBeNull();
        expect(panel.textContent).toContain("team project ownership landscape");
        expect(panel.textContent).toContain("2 rows");
        const table = panel.querySelector("table")!;
        // Column headers are humanized ("_" -> " "), never the raw wire name.
        expect(table.textContent).toContain("churn loc 30d");
        expect(table.textContent).toContain("18420");
    });

    /**
     * CHAOS-4581 codex review round 1: `titleId` used to be bare
     * `fact-rows-${claim_id}` — not instance-scoped like every other panel
     * touched by this ticket, so the SAME claim_id repeated across two
     * stacked chat turns collided, the CHAOS-4510 failure class.
     */
    it("gives two panels citing the same claim_id different heading ids (CHAOS-4510)", () => {
        const fact: ClaimedFact = {
            claim_id: "claim_dup",
            kind: "status",
            subject: { kind: "project", canonical_id: "project_ask_dev", label: "Ask Dev" },
            field: "current_phase",
            value: { string: "steady" },
            rows: [{ fields: { count: { integer: 3 } } }],
        };
        render(
            <>
                <FactRowsPanels facts={[fact]} result={undefined} />
                <FactRowsPanels facts={[fact]} result={undefined} />
            </>,
        );
        const sections = Array.from(
            document.querySelectorAll('section[aria-labelledby^="fact-rows-"]'),
        );
        expect(sections).toHaveLength(2);
        const ids = sections.map((s) => s.getAttribute("aria-labelledby"));
        expect(ids[0]).not.toBe(ids[1]);
        for (const section of sections) {
            const labelledBy = section.getAttribute("aria-labelledby")!;
            expect(section.querySelector(`#${CSS.escape(labelledBy)}`)).not.toBeNull();
        }
    });

    /** "Key numbers as tiles" (CHAOS-4581): a single-row fact's numeric columns. */
    it("renders a tile per numeric column for a single-row fact", () => {
        const fact: ClaimedFact = {
            claim_id: "claim_tiles",
            kind: "health",
            subject: { kind: "project", canonical_id: "project_ask_dev", label: "Ask Dev" },
            field: "summary",
            value: { integer: 1 },
            rows: [{ fields: { open_incidents: { integer: 2 }, mttr_hours: { number: 4.5 } } }],
        };
        render(<FactRowsPanels facts={[fact]} result={undefined} />);
        const tiles = screen.getByTestId("fact-tiles");
        expect(tiles.textContent).toContain("2");
        expect(tiles.textContent).toContain("open incidents");
        expect(tiles.textContent).toContain("4.5");
        expect(tiles.textContent).toContain("mttr hours");
    });

    it("renders no tiles for a multi-row fact (a real series, not a single summary)", () => {
        render(<FactRowsPanels facts={rowsResult.claimed_facts} result={undefined} />);
        // The CI daily rollup is a real multi-day time series (3 rows) —
        // scoped to its own panel, since `rowsResult` also carries the
        // single-row latency-percentiles fact, which legitimately DOES
        // render tiles (covered above).
        const heading = screen.getByRole("heading", {
            name: /continuous integration.*pipelines count/i,
        });
        const panel = heading.closest("section")!;
        expect(panel.querySelector('[data-testid="fact-tiles"]')).toBeNull();
    });
});

describe("FactRowsPanels — a trend shape, which no acr build currently emits", () => {
    // acr WITHDREW `dated_fact_trend` (CHAOS-4616): a row table cannot say
    // which of its columns are measures, so any trend it drew was a claim
    // resting on a guess. The capability returns through CHAOS-4627, when a
    // row table declares its own shape.
    //
    // These tests therefore use a SYNTHETIC shape, and say so rather than
    // pretending otherwise. That is a deliberate, named weakness: they prove
    // this panel routes and checks a trend correctly, and they cannot prove
    // it does so for real server output, because there is no real server
    // output to test against. The golden-example test directly below pins
    // the fact that acr sends none.
    //
    // The rendering path is kept rather than deleted because it is
    // REACHABLE, not dead: it is driven by whatever `render_shapes` the
    // server sends, so an acr that starts emitting trends again is rendered
    // correctly with no consumer change. That is the opposite of acr's own
    // dead helpers, which nothing could call.
    const factWithTrendRows = {
        claim_id: "claim_trend",
        kind: "flow",
        subject: { kind: "team", canonical_id: "team:t", label: "t" },
        field: "items_completed",
        value: { number: 3 },
        rows: [
            { fields: { day: { string: "2026-07-20" }, items_completed: { number: 0 } } },
            { fields: { day: { string: "2026-08-30" }, items_completed: { number: 3 } } },
        ],
    } as unknown as ClaimedFact;

    function answerWithTrend(value = 0): InvestigationResult {
        return {
            claimed_facts: [factWithTrendRows],
            render_shapes: [
                {
                    shape_id: "rs_t",
                    kind: "series",
                    presentation: "line",
                    selected_by: "dated_fact_trend",
                    title: "Items completed over time — t",
                    axis_kind: "time",
                    axis_label: "day",
                    value_label: "Items completed",
                    series: [
                        {
                            key: "items_completed",
                            label: "Items completed",
                            points: [
                                {
                                    label: "2026-07-20",
                                    value,
                                    source: {
                                        kind: "claimed_fact_row",
                                        claim_id: "claim_trend",
                                        row_index: 0,
                                        field: "items_completed",
                                    },
                                },
                                {
                                    label: "2026-08-30",
                                    value: 3,
                                    source: {
                                        kind: "claimed_fact_row",
                                        claim_id: "claim_trend",
                                        row_index: 1,
                                        field: "items_completed",
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        } as unknown as InvestigationResult;
    }

    it("the shipped golden example carries NO trend, because acr emits none", () => {
        // The live-facing pin: whatever the synthetic tests below prove, the
        // real contract example must show the withdrawal.
        const shipped = renderShapesExample as unknown as InvestigationResult;
        expect(shipped.render_shapes?.some((s) => s.selected_by === "dated_fact_trend")).toBe(
            false,
        );
    });

    it("draws a trend beside the table it was derived from", () => {
        render(<FactRowsPanels facts={[factWithTrendRows]} result={answerWithTrend()} />);
        expect(screen.getByRole("table", { name: /over time/i })).toBeInTheDocument();
    });

    it("REPLACES the client-side heuristic chart rather than drawing beside it", () => {
        // One fact's numbers are never shown twice under two different
        // selection rules.
        const { container } = render(
            <FactRowsPanels facts={[factWithTrendRows]} result={answerWithTrend()} />,
        );
        expect(container.querySelectorAll(".fact-chart")).toHaveLength(0);
    });

    it("WITHHOLDS a trend whose numbers disagree with the fact's own rows", () => {
        render(<FactRowsPanels facts={[factWithTrendRows]} result={answerWithTrend(99)} />);
        expect(screen.getByTestId("trend-shape-withheld")).toHaveTextContent(
            /could not be checked against this fact/i,
        );
    });

    it("shows the table, not a client-side chart, when a trend was refused", () => {
        const { container } = render(
            <FactRowsPanels facts={[factWithTrendRows]} result={answerWithTrend(99)} />,
        );
        expect(screen.getByTestId("trend-shape-withheld")).toBeInTheDocument();
        expect(container.querySelectorAll(".fact-chart")).toHaveLength(0);
    });
});
describe("chris's ruling: nothing disappears from the UI", () => {
    // chris, 2026-08-30 14:24 PT: "I object to losing the charts and the data
    // in front of people."
    //
    // acr withdrew its server-asserted `dated_fact_trend` (CHAOS-4616: a row
    // table cannot say which of its columns are measures, so the trend was a
    // claim resting on a guess). That removes a SERVER assertion. It must not
    // remove a CHART: this panel's own CHAOS-4355 visualization keeps
    // rendering the rows, presented as a view of them rather than as a trend
    // the service vouches for.
    //
    // The distinction is the whole ruling, so it is pinned rather than
    // assumed.
    const rows = [
        { fields: { day: { string: "2026-07-20" }, items_completed: { number: 0 } } },
        { fields: { day: { string: "2026-08-30" }, items_completed: { number: 3 } } },
    ];
    const factWithRows = {
        claim_id: "claim_flow",
        kind: "flow",
        subject: { kind: "team", canonical_id: "team:fullchaos", label: "fullchaos" },
        field: "items_completed",
        value: { number: 3 },
        rows,
    } as unknown as ClaimedFact;

    it("still draws the heuristic chart when acr selects no trend", () => {
        const answer = {
            claimed_facts: [factWithRows],
            // Post-withdrawal shape of a real answer: cohort shapes only,
            // never a trend.
            render_shapes: [],
        } as unknown as InvestigationResult;
        const { container } = render(<FactRowsPanels facts={[factWithRows]} result={answer} />);
        expect(container.querySelectorAll(".fact-chart").length).toBeGreaterThan(0);
        expect(screen.queryByTestId("trend-shape-withheld")).not.toBeInTheDocument();
    });

    it("draws it identically whether or not the answer carries a render_shapes field at all", () => {
        // A pre-4415 answer and a post-withdrawal answer must look the same
        // here — the field's absence and its emptiness are the same story for
        // this panel.
        const withField = {
            claimed_facts: [factWithRows],
            render_shapes: [],
        } as unknown as InvestigationResult;
        const withoutField = { claimed_facts: [factWithRows] } as unknown as InvestigationResult;
        const a = render(<FactRowsPanels facts={[factWithRows]} result={withField} />);
        const withCount = a.container.querySelectorAll(".fact-chart").length;
        a.unmount();
        const b = render(<FactRowsPanels facts={[factWithRows]} result={withoutField} />);
        expect(b.container.querySelectorAll(".fact-chart").length).toBe(withCount);
    });
});
