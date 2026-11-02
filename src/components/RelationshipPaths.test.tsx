import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { EvidenceOpenContext } from "@/components/EvidenceOpenContext";
import type { InvestigationResult, RelationshipPath } from "@/lib/contracts";
import { withholdUnrankableRankings } from "@/lib/ranking-withheld";
import { cohortMemberScenarios } from "@/test/fixtures/cohort-members";
import { servedShapeScenarios } from "@/test/fixtures/served-shapes";
import { visibleText } from "@/test/visible-text";

afterEach(cleanup);

const answer = cohortMemberScenarios["served-shape-open"];
const citedId = "path_12345678";
const cited = answer.paths.find((path) => path.path_id === citedId)!;
const driver = answer.drivers.find((candidate) => candidate.path_ids?.includes(citedId))!;
const others = answer.paths.filter((path) => path.path_id !== citedId);

const NOT_CAUSE = "A path shows how these are linked. It does not show cause.";

const draw = (result: InvestigationResult) =>
    render(<DeterministicAnswerView offersPresentation="popup" result={result} />);

function driverFold(): HTMLDetailsElement {
    const card = screen.getByText(driver.title).closest("li")!;
    return within(card).getByText("Details").closest("details")!;
}

const otherPanel = () => screen.queryByTestId("relationship-paths-panel");

function changed(change: (result: InvestigationResult) => void): InvestigationResult {
    const result = structuredClone(answer);
    change(result);
    return result;
}

describe("a driver shows the paths it cites (CHAOS-12479)", () => {
    it("the fixture is the case: real paths, one of them cited", () => {
        expect(answer.paths).toHaveLength(10);
        expect(others).toHaveLength(9);
        expect(driver).toBeDefined();
    });

    it("shows each hop and the served reason, inside the closed fold", () => {
        draw(answer);
        const fold = driverFold();
        expect(fold.open).toBe(false);
        expect(within(fold).getByTestId("path-hop")).toHaveTextContent(
            "Ask Dev — blocks → Release acceptance · observed · canonical structured",
        );
        expect(within(fold).getByTestId("relationship-path")).toHaveTextContent(cited.why_relevant);
        expect(visibleText(screen.getByTestId("drivers-panel"))).not.toContain(cited.why_relevant);
    });

    it("keeps the labels of a longer path in order, with each edge between them", () => {
        draw(
            changed((result) => {
                const path = result.paths.find((candidate) => candidate.path_id === citedId)!;
                const [first] = path.edges;
                const next = { kind: "work_item", canonical_id: "work_next", label: "Next item" };
                path.nodes = [...path.nodes, next] as RelationshipPath["nodes"];
                path.edges = [
                    first,
                    { ...first, type: "PART_OF", from: path.nodes[1], to: next },
                ] as RelationshipPath["edges"];
            }),
        );
        const hops = within(driverFold()).getAllByTestId("path-hop");
        expect(hops.map((hop) => hop.textContent?.split(" · ")[0])).toEqual([
            "Ask Dev — blocks → Release acceptance",
            "Release acceptance — part of → Next item",
        ]);
    });

    it("says a path is cut", () => {
        draw(
            changed((result) => {
                result.paths.find((path) => path.path_id === citedId)!.truncated = true;
            }),
        );
        expect(within(driverFold()).getByTestId("relationship-path")).toHaveTextContent(
            "This path is cut: the service sent only part of it.",
        );
    });

    it("says nothing of cut on a whole path", () => {
        draw(answer);
        expect(within(driverFold()).getByTestId("relationship-path")).not.toHaveTextContent(
            "This path is cut",
        );
    });

    it("draws nothing for an id that names no path", () => {
        draw(
            changed((result) => {
                result.drivers.find((d) => d.driver_id === driver.driver_id)!.path_ids = [
                    "path_not_here",
                ];
            }),
        );
        expect(within(driverFold()).queryByTestId("relationship-path")).toBeNull();
        expect(within(driverFold()).queryByText(NOT_CAUSE)).toBeNull();
        expect(within(driverFold()).queryByText("Why this is relevant")).toBeNull();
    });
});

describe("paths no driver cites sit in one collapsed panel (CHAOS-12479)", () => {
    it("lists them all, closed, and not the cited one", () => {
        draw(answer);
        const panel = otherPanel()!;
        const fold = panel.querySelector("details")!;
        expect(fold.open).toBe(false);
        expect(within(panel).getByText("Other related paths")).toBeVisible();
        const rows = within(panel).getAllByTestId("relationship-path");
        expect(rows).toHaveLength(others.length);
        expect(panel).not.toHaveTextContent(cited.why_relevant);
        for (const [index, path] of others.entries()) {
            expect(rows[index]).toHaveTextContent(path.why_relevant);
        }
        expect(visibleText(panel)).toBe("Other related paths");
    });

    it("draws no panel when a driver cites every path", () => {
        draw(
            changed((result) => {
                result.paths = result.paths.filter((path) => path.path_id === citedId);
            }),
        );
        expect(otherPanel()).toBeNull();
    });

    it("draws nothing at all with no paths", () => {
        draw(
            changed((result) => {
                result.paths = [];
            }),
        );
        expect(otherPanel()).toBeNull();
        expect(screen.queryByTestId("relationship-path")).toBeNull();
    });
});

describe("an edge reads ACR's word (CHAOS-12499)", () => {
    const served = servedShapeScenarios["edge-words"];
    const words = served.vocabulary_labels!;
    const hops = () => screen.getAllByTestId("path-hop").map((hop) => hop.textContent);

    it("the fixture is the case: a served word that is not the generic form", () => {
        expect(words["relationship_type:RELATED_TO"]).toBe("associated with");
    });

    it("draws the served word of every edge, between the edge's two ends", () => {
        draw(served);
        const expected = served.paths.flatMap((path) =>
            path.edges.map((edge) => {
                const word = words[`relationship_type:${edge.type}`]!;
                return `${edge.from.label} — ${word} → ${edge.to.label}`;
            }),
        );
        const shown = hops().map((hop) => hop?.split(" · ")[0]);
        expect(shown.toSorted()).toEqual(expected.toSorted());
    });

    it("takes the generic path for a type with no word", () => {
        const { "relationship_type:RELATED_TO": _gone, ...left } = words;
        draw({ ...served, vocabulary_labels: left });
        expect(hops().join()).toContain("CHAOS-2001 — related to → CHAOS-2002");
    });

    it("takes the generic path with no map, as a status-only tier serves", () => {
        const { vocabulary_labels: _gone, ...result } = structuredClone(served);
        draw(result);
        expect(hops().join()).toContain("CHAOS-2001 — related to → CHAOS-2002");
    });
});

describe("the words (CHAOS-12479)", () => {
    it("shows no raw id or edge token outside a fold", () => {
        draw(answer);
        const visible = visibleText(document.body);
        for (const path of answer.paths) {
            expect(visible).not.toContain(path.path_id);
            for (const edge of path.edges) expect(visible).not.toContain(edge.type);
        }
    });

    it("keeps raw ids and tokens out of the paths' own words, fold or no fold", () => {
        draw(answer);
        for (const row of screen.getAllByTestId("relationship-path")) {
            const copy = row.cloneNode(true) as HTMLElement;
            copy.querySelector('[data-testid="evidence-ref-raw-ids"]')?.remove();
            const text = copy.textContent;
            for (const path of answer.paths) {
                expect(text).not.toContain(path.path_id);
                for (const node of path.nodes) expect(text).not.toContain(node.canonical_id);
                for (const edge of path.edges) expect(text).not.toContain(edge.type);
            }
        }
    });

    it("says relevance, not cause, in each fold, and nothing here says cause", () => {
        draw(answer);
        expect(within(driverFold()).getByText(NOT_CAUSE)).toBeInTheDocument();
        expect(within(otherPanel()!).getByText(NOT_CAUSE)).toBeInTheDocument();
        const ownWords = [...screen.getAllByTestId("relationship-path"), otherPanel()!]
            .map((node) => node.textContent)
            .join(" ")
            .replaceAll(NOT_CAUSE, "");
        const served = answer.paths.reduce(
            (text, path) => text.replaceAll(path.why_relevant, ""),
            ownWords,
        );
        expect(served).not.toMatch(/\b(cause[sd]?|because|due to|led to|leads to|resulted in)\b/iu);
    });
});

describe("evidence and the guardrails (CHAOS-12479)", () => {
    it("opens each of a path's evidence refs", () => {
        const open = vi.fn();
        render(
            <EvidenceOpenContext.Provider value={{ open }}>
                <DeterministicAnswerView offersPresentation="popup" result={answer} />
            </EvidenceOpenContext.Provider>,
        );
        const row = within(driverFold()).getByTestId("relationship-path");
        const buttons = within(row).getAllByRole("button", { hidden: true });
        expect(buttons).toHaveLength(cited.evidence_ref_ids.length);
        for (const button of buttons) button.click();
        expect(open.mock.calls.map(([refId]) => refId as string)).toEqual(cited.evidence_ref_ids);
    });

    it("draws no path on a withheld result", () => {
        const withheld = withholdUnrankableRankings(
            changed((result) => {
                result.cohort!.kind = "person";
                for (const member of result.cohort!.members) member.subject.kind = "person";
            }),
        );
        expect(withheld.rankingWithheld).toBeDefined();
        render(
            <DeterministicAnswerView
                offersPresentation="popup"
                rankingWithheld={withheld.rankingWithheld}
                result={withheld.result}
            />,
        );
        expect(screen.queryByTestId("relationship-path")).toBeNull();
        expect(otherPanel()).toBeNull();
    });

    const LEFT_OUT = "A path is not shown: it names a subject this view does not list.";

    it.each<[string, (path: RelationshipPath) => void]>([
        ["a node", (path) => void (path.nodes[1].kind = "person")],
        ["an edge's from", (path) => void (path.edges[0].from.kind = "person")],
        ["an edge's to", (path) => void (path.edges[0].to.kind = "person")],
        ["a kind no pin documents", (path) => void (path.edges[0].to.kind = "robot")],
    ])("leaves out a path whose subject the view does not list: %s", (_, change) => {
        draw(
            changed((result) => {
                change(result.paths.find((path) => path.path_id === citedId)!);
            }),
        );
        const fold = driverFold();
        expect(within(fold).queryByTestId("relationship-path")).toBeNull();
        expect(fold).not.toHaveTextContent(cited.why_relevant);
        expect(fold).not.toHaveTextContent("Release acceptance —");
        expect(within(fold).getByTestId("paths-left-out")).toHaveTextContent(LEFT_OUT);
        expect(within(fold).queryByText(NOT_CAUSE)).toBeNull();
    });

    it("leaves such a path out of the other panel too, and says how many", () => {
        draw(
            changed((result) => {
                const [first, second] = result.paths.filter((path) => path.path_id !== citedId);
                first!.edges[0].from.kind = "person";
                second!.edges[0].to.kind = "person";
            }),
        );
        const panel = otherPanel()!;
        expect(within(panel).getAllByTestId("relationship-path")).toHaveLength(others.length - 2);
        expect(within(panel).getByTestId("paths-left-out")).toHaveTextContent(
            "2 paths are not shown: they name subjects this view does not list.",
        );
    });

    it("says nothing of it when every path can show", () => {
        draw(answer);
        expect(screen.queryByTestId("paths-left-out")).toBeNull();
    });

    it("draws no path when the drivers are withheld for the cohort's kind", () => {
        draw(
            changed((result) => {
                result.cohort!.kind = "pull_request";
                for (const member of result.cohort!.members) member.subject.kind = "pull_request";
            }),
        );
        expect(screen.getByTestId("cohort-ranking-withheld")).toBeVisible();
        expect(screen.queryByTestId("relationship-path")).toBeNull();
        expect(otherPanel()).toBeNull();
    });
});
