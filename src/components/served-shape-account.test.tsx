import { cleanup, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { FactRowsPanels } from "@/components/FactRowsPanel";
import { RenderShapeChart } from "@/components/RenderShapeChart";
import type { CohortMember, InvestigationResult, RenderShape } from "@/lib/contracts";
import { parseIsoDate } from "@/lib/fact-rows";
import { axisLabels } from "@/lib/render-shapes";
import { cohortMemberScenarios } from "@/test/fixtures/cohort-members";
import { servedShapeScenarios as scenarios, dateOracle } from "@/test/fixtures/served-shapes";
import { servedWordScenarios } from "@/test/fixtures/served-words";

afterEach(cleanup);

const draw = (result: InvestigationResult) =>
    render(<DeterministicAnswerView offersPresentation="popup" result={result} />);

const pair = scenarios["category-order"];
const attention = pair.render_shapes!.find((s) => s.selected_by === "cohort_attention_score")!;
const contribution = pair.render_shapes!.find(
    (s) => s.selected_by === "cohort_driver_contribution",
)!;
const trend = pair.render_shapes!.find((s) => s.selected_by === "dated_fact_trend")!;

/** A real shape under a rule no panel reads yet: the case the account exists for. */
function unread(shape: RenderShape, title: string, id: string): RenderShape {
    return {
        ...shape,
        kind: "sunburst",
        presentation: undefined,
        selected_by: "a_rule_no_panel_reads",
        shape_id: id,
        title,
    } as unknown as RenderShape;
}

function withShapes(
    base: InvestigationResult,
    render_shapes: readonly RenderShape[],
): InvestigationResult {
    return { ...structuredClone(base), render_shapes: [...render_shapes] } as InvestigationResult;
}

/** The figure of a chart by its served title, or null. */
function chart(title: string): HTMLElement | null {
    const caption = screen
        .queryAllByText(title)
        .find((node) => node.tagName.toLowerCase() === "figcaption");
    return caption?.closest("figure") ?? null;
}

const notDrawn = () => screen.queryByTestId("render-shapes-not-drawn");

describe("a bare score draws no bar (CHAOS-11986 problem 2)", () => {
    /** The second member changed; the contribution chart no longer cites it, as ACR would select. */
    function changed(change: (member: CohortMember) => void): InvestigationResult {
        const result = structuredClone(pair);
        change(result.cohort!.members[1]!);
        const stack = result.render_shapes!.find((s) => s.shape_id === contribution.shape_id)!;
        for (const series of stack.series) {
            const points = series.points.filter(
                (point) =>
                    point.source.subject_canonical_id !==
                    result.cohort!.members[1]!.subject.canonical_id,
            );
            series.points = points as typeof series.points;
        }
        const left = stack.series.filter((series) => series.points.length > 0);
        stack.series = left as typeof stack.series;
        return result;
    }

    it("draws the score chart when every plotted member stands on a ranking row (control)", () => {
        draw(pair);
        expect(chart(attention.title)).not.toBeNull();
        expect(screen.queryByTestId("render-shapes-withheld")).toBeNull();
    });

    it.each<[string, (member: CohortMember) => void]>([
        ["has no driver", (member) => void (member.drivers = [])],
        ["has no outcome", (member) => void delete member.outcome],
        ["is not ranked", (member) => void (member.ranking_computed = false)],
    ])("withholds the whole shape when a plotted member %s", (_, change) => {
        draw(changed(change));
        expect(chart(attention.title)).toBeNull();
        const panel = screen.getByTestId("cohort-ranking-panel");
        expect(within(panel).getByTestId("render-shapes-withheld")).toHaveTextContent(
            "A chart was withheld",
        );
        expect(chart(contribution.title)).not.toBeNull();
    });
});

describe.each([
    ["America/Los_Angeles", 480],
    ["Asia/Kolkata", -330],
    ["UTC", 0],
])("a zone-less date-time reads as UTC, in %s (CHAOS-11986 problem 3)", (zone, januaryOffset) => {
    const before = process.env.TZ;
    beforeAll(() => {
        process.env.TZ = zone;
        // A zone that did not take is a measurement that did not happen.
        expect(new Date(Date.UTC(2026, 0, 15)).getTimezoneOffset()).toBe(januaryOffset);
    });
    afterAll(() => {
        if (before === undefined) delete process.env.TZ;
        else process.env.TZ = before;
    });

    it("reads every value ACR's own parser accepts as the same instant", () => {
        const accepted = dateOracle.filter((row) => row.millis !== null);
        expect(accepted.length).toBeGreaterThan(10);
        for (const { value, millis } of accepted) {
            expect([value, parseIsoDate(value)]).toEqual([value, millis]);
        }
    });

    it("hands Date.parse only the ECMAScript format, so no engine's fallback decides", () => {
        const parse = vi.spyOn(Date, "parse");
        for (const { value, millis } of dateOracle) {
            if (millis !== null) parseIsoDate(value);
        }
        const strict = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;
        expect(parse.mock.calls.length).toBeGreaterThan(10);
        for (const [text] of parse.mock.calls) expect(text).toMatch(strict);
        parse.mockRestore();
    });

    it("still refuses the calendar dates ACR refuses", () => {
        const refused = dateOracle.filter((row) => row.millis === null);
        expect(refused.length).toBeGreaterThan(3);
        for (const { value } of refused)
            expect([value, parseIsoDate(value)]).toEqual([value, null]);
    });

    const served = scenarios["zone-less-trend"];
    const zoneLess = served.render_shapes!.find((shape) =>
        shape.series[0]?.points[0]?.label.includes("T"),
    )!;

    it("draws the trend ACR verified, with no withheld notice", () => {
        draw(served);
        expect(chart(zoneLess.title)).not.toBeNull();
        expect(screen.queryByTestId("trend-shape-withheld")).toBeNull();
    });

    /** Three points one hour apart must sit one step apart. */
    function expectEvenSteps(container: HTMLElement) {
        const xs = [...container.querySelectorAll("circle")].map((mark) =>
            Number(mark.getAttribute("cx")),
        );
        expect(xs).toHaveLength(3);
        expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!, 6);
        expect(xs[2]!).toBeGreaterThan(xs[1]!);
    }

    it("places a served trend's points by elapsed UTC time", () => {
        expectEvenSteps(render(<RenderShapeChart shape={zoneLess} />).container);
    });

    it("places the fallback chart's points by elapsed UTC time", () => {
        const fact = served.claimed_facts.find((candidate) => {
            return candidate.claim_id === "claim_metrics_ask_dev_commits";
        })!;
        const { container } = render(<FactRowsPanels facts={[fact]} result={undefined} />);
        expectEvenSteps(container);
    });
    it("orders the fallback chart by UTC, where the viewer's clock would swap two rows", () => {
        const fact = structuredClone(
            served.claimed_facts.find((candidate) => {
                return candidate.claim_id === "claim_metrics_ask_dev_commits";
            })!,
        );
        // In Los Angeles 02:30 does not exist and reads as 03:30, after 03:10.
        const days = ["2026-03-08T03:10:00", "2026-03-08T02:30:00", "2026-03-08T04:00:00"];
        fact.rows!.forEach((row, index) => {
            row.fields.day = { string: days[index]! };
        });
        render(<FactRowsPanels facts={[fact]} result={undefined} />);
        const marks = screen.getAllByRole("img").map((mark) => mark.getAttribute("aria-label"));
        expect(
            marks.filter((mark) => mark?.startsWith("2026")).map((m) => m?.slice(11, 16)),
        ).toEqual(["02:30", "03:10", "04:00"]);
    });
});

describe("a cohort axis follows the served rank (CHAOS-11986 problem 4)", () => {
    const rows = (figure: HTMLElement) =>
        within(figure)
            .getAllByRole("row", { hidden: true })
            .slice(1)
            .map((row) => within(row).getByRole("rowheader", { hidden: true }).textContent);

    it("the fixture is the case: the first driver family omits the top-ranked member", () => {
        expect(pair.cohort!.members[0]!.attention_rank).toBe(1);
        expect(contribution.series[0].points.map((point) => point.label)).toEqual(["Platform"]);
    });

    it("keeps the top-ranked member first in the contribution stack", () => {
        draw(pair);
        expect(rows(chart(contribution.title)!)).toEqual(["CHAOS", "Platform"]);
        expect(rows(chart(attention.title)!)).toEqual(["CHAOS", "Platform"]);
    });

    it("puts a plotted member with no served rank after the ranked ones, in served order", () => {
        const cohort = structuredClone(pair.cohort!);
        delete cohort.members[0]!.attention_rank;
        expect(axisLabels(contribution, cohort)).toEqual(["Platform", "CHAOS"]);
    });

    it("leaves a time axis in the order ACR proved", () => {
        const labels = trend.series[0].points.map((point) => point.label);
        expect(axisLabels(trend, pair.cohort)).toEqual(labels);
    });

    it("keeps the served order with no cohort to read", () => {
        expect(axisLabels(contribution, undefined)).toEqual(["Platform", "CHAOS"]);
    });
});

describe("every served shape is accounted for (rich views plan, section 4)", () => {
    const fixtures: readonly (readonly [string, InvestigationResult])[] = [
        ...Object.entries(scenarios),
        ...Object.entries(cohortMemberScenarios),
        ...Object.entries(servedWordScenarios),
    ];

    it.each(fixtures)("says nothing extra on the real fixture %s", (_, result) => {
        draw(result);
        expect(notDrawn()).toBeNull();
    });

    it("draws every shape of a real answer", () => {
        draw(pair);
        expect(pair.render_shapes!.length).toBeGreaterThan(3);
        for (const shape of pair.render_shapes!) expect(chart(shape.title)).not.toBeNull();
    });

    it("names a shape under a rule no panel reads", () => {
        const title = "Effort by theme";
        draw(withShapes(pair, [...pair.render_shapes!, unread(attention, title, "rs_new")]));
        expect(notDrawn()).toHaveTextContent(
            `A chart this view cannot draw is not shown: ${title}.`,
        );
        expect(notDrawn()).toBeVisible();
        expect(chart(title)).toBeNull();
    });

    it("counts two of them", () => {
        draw(
            withShapes(pair, [
                unread(attention, "One", "rs_one"),
                unread(attention, "Two", "rs_two"),
            ]),
        );
        expect(notDrawn()).toHaveTextContent(
            "2 charts this view cannot draw are not shown: One; Two.",
        );
    });

    it("says it with no title to name", () => {
        draw(withShapes(pair, [unread(attention, "   ", "rs_blank")]));
        expect(notDrawn()!.textContent).toBe("A chart this view cannot draw is not shown.");
    });

    it("names a shape under a new rule even when it cites a fact with a panel", () => {
        draw(withShapes(pair, [unread(trend, "Effort over time", "rs_new")]));
        expect(notDrawn()).toHaveTextContent("Effort over time");
    });

    it("says a trend whose claim has no table to sit on", () => {
        const result = structuredClone(pair);
        const cited = trend.series[0].points[0].source.claim_id;
        for (const fact of result.claimed_facts) {
            if (fact.claim_id === cited) delete fact.rows;
        }
        draw(result);
        expect(notDrawn()).toHaveTextContent(trend.title);
    });

    it("says a verified cohort chart over a list, and does not call it unchecked", () => {
        const result = structuredClone(pair);
        for (const member of result.cohort!.members) member.ranking_computed = false;
        draw(result);
        expect(screen.getByTestId("cohort-members-panel")).toBeVisible();
        expect(notDrawn()).toHaveTextContent(contribution.title);
        expect(notDrawn()).not.toHaveTextContent(attention.title);
        expect(screen.getByTestId("render-shapes-withheld")).toHaveTextContent("A chart was");
    });

    it("does not say a withheld trend twice", () => {
        const result = structuredClone(pair);
        const tampered = result.render_shapes!.find((s) => s.shape_id === trend.shape_id)!;
        tampered.series[0].points[0].value += 1;
        draw(result);
        expect(screen.getByTestId("trend-shape-withheld")).toBeVisible();
        expect(notDrawn()).toBeNull();
    });

    it("does not say a cohort chart with no cohort twice", () => {
        const { cohort: _cohort, ...result } = structuredClone(pair);
        draw(result);
        expect(screen.getByTestId("render-shapes-withheld")).toBeVisible();
        expect(notDrawn()).toBeNull();
    });

    it("leaves a ranking this view does not show to its own notice", () => {
        const result = structuredClone(pair);
        result.cohort!.kind = "pull_request";
        for (const member of result.cohort!.members) member.subject.kind = "pull_request";
        draw(result);
        expect(screen.getByTestId("cohort-ranking-withheld")).toBeVisible();
        expect(notDrawn()).toBeNull();
    });

    it("withholds a shape with no point, because no chart can draw it", () => {
        const result = structuredClone(pair);
        const hollow = result.render_shapes!.find((s) => s.shape_id === attention.shape_id)!;
        hollow.series = [] as unknown as RenderShape["series"];
        draw(result);
        expect(screen.getByTestId("render-shapes-withheld")).toBeVisible();
    });
});
