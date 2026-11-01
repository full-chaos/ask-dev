import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import type { InvestigationResult, RenderShape } from "@/lib/contracts";
import { cohortRanking } from "@/lib/cohort-ranking";
import { servesCohortShape } from "@/lib/render-shapes";
import { cohortMemberScenarios as cohorts } from "@/test/fixtures/cohort-members";

afterEach(cleanup);

const open = cohorts["served-shape-open"];
const draw = (result: InvestigationResult) =>
    render(<DeterministicAnswerView offersPresentation="popup" result={result} />);

const shapes = open.render_shapes!;
const cohortShapes = shapes.filter((shape) => shape.selected_by.startsWith("cohort_"));
const trendShapes = shapes.filter((shape) => !shape.selected_by.startsWith("cohort_"));

function withShapes(render_shapes: readonly RenderShape[]): InvestigationResult {
    return { ...open, render_shapes: [...render_shapes] } as InvestigationResult;
}

describe("a served cohort shape draws, whatever interpretation.shape says (gap 2)", () => {
    it("the fixture is the case: `open`, with cohort shapes from the real selection", () => {
        expect(open.interpretation.shape).toBe("open");
        expect(cohortShapes.map((shape) => shape.selected_by)).toEqual([
            "cohort_attention_score",
            "cohort_driver_contribution",
        ]);
    });

    it("draws the ranking and both charts", () => {
        draw(open);
        const ranking = screen.getByTestId("cohort-ranking-panel");
        expect(within(ranking).getByRole("heading", { name: "Ranked teams" })).toBeVisible();
        for (const shape of cohortShapes) {
            expect(within(ranking).getAllByText(shape.title)[0]).toBeVisible();
        }
        expect(within(ranking).getAllByTestId("ranking-row").length).toBeGreaterThan(0);
    });

    it("orders the panels as a ranking: drivers follow it, before the fact tables", () => {
        draw(open);
        const drivers = screen.getByTestId("drivers-panel");
        const ranking = screen.getByTestId("cohort-ranking-panel");
        const fact = screen.getAllByRole("heading", { level: 2 }).find((heading) => {
            return heading.textContent?.includes("·");
        });
        expect(
            ranking.compareDocumentPosition(drivers) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(
            drivers.compareDocumentPosition(fact!) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it("gives the drivers their footnote target: the ranking is on screen", () => {
        expect(cohortRanking("open", open.cohort, servesCohortShape(open)).state).toBe("rows");
    });

    it("a shape that fails its check is said, never a silent absence", () => {
        const [attention, ...others] = cohortShapes;
        const broken = {
            ...attention!,
            series: attention!.series.map((series) => ({
                ...series,
                points: series.points.map((point) => ({ ...point, value: point.value + 1 })),
            })),
        } as unknown as RenderShape;
        draw(withShapes([broken, ...others, ...trendShapes]));
        expect(screen.getByTestId("cohort-ranking-panel")).toBeVisible();
        expect(screen.getByTestId("render-shapes-withheld")).toBeVisible();
    });
});

describe("the gate keeps what it must keep", () => {
    it("no cohort shape and an `open` question: no ranking, as before (check 10)", () => {
        expect(servesCohortShape(withShapes([]))).toBe(false);
        draw(withShapes([]));
        expect(screen.queryByTestId("cohort-ranking-panel")).toBeNull();
    });

    it("a trend chart is not cohort intent", () => {
        expect(trendShapes.length).toBeGreaterThan(0);
        expect(servesCohortShape(withShapes(trendShapes))).toBe(false);
        draw(withShapes(trendShapes));
        expect(screen.queryByTestId("cohort-ranking-panel")).toBeNull();
    });

    it("each cohort rule counts by itself", () => {
        for (const shape of cohortShapes) {
            expect(servesCohortShape(withShapes([shape]))).toBe(true);
        }
    });

    it("no result reads as no shape", () => {
        expect(servesCohortShape(undefined)).toBe(false);
    });

    it("a ranking of a kind this view does not rank is withheld, and so are its drivers", () => {
        const cohort = {
            ...open.cohort!,
            kind: "pull_request",
            members: open.cohort!.members.map((member) => ({
                ...member,
                subject: { ...member.subject, kind: "pull_request" },
            })),
        };
        draw({ ...open, cohort });
        expect(screen.getByTestId("cohort-ranking-withheld")).toBeVisible();
        expect(
            within(screen.getByTestId("drivers-panel")).getByTestId("withheld-part"),
        ).toBeVisible();
    });

    it("a served shape over a cohort with nothing ranked draws the members", () => {
        const members = open.cohort!.members.map((member) => {
            const { score: _score, drivers: _drivers, ...rest } = member;
            return rest;
        });
        draw({ ...open, cohort: { ...open.cohort!, members } });
        expect(screen.getByTestId("cohort-members-panel")).toBeVisible();
    });

    it("a served shape does not open the guardrail: a person cohort is still withheld", () => {
        const cohort = {
            ...open.cohort!,
            kind: "person",
            members: open.cohort!.members.map((member) => ({
                ...member,
                subject: { ...member.subject, kind: "person" },
            })),
        };
        const result = { ...open, cohort } as InvestigationResult;
        draw(result);
        expect(screen.getByTestId("cohort-ranking-withheld")).toBeVisible();
        expect(screen.queryByTestId("cohort-ranking-panel")).toBeNull();
    });
});
