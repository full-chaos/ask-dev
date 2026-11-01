import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DeterministicAnswerView } from "./DeterministicAnswerView";
import { ScalarFactsPanel } from "./ScalarFactsPanel";
import { VocabularyLabelsContext } from "./VocabularyWordContext";
import originState from "../contracts/examples/context_fabric_investigation_result_origin_state.v1.json";
import renderShapes from "../contracts/examples/context_fabric_investigation_result_render_shapes.v1.json";
import plain from "../contracts/examples/context_fabric_investigation_result.v1.json";
import type { ClaimedFact, InvestigationResult } from "../lib/contracts";
import { cellText } from "../lib/fact-rows";
import { humanizeTerm } from "../lib/presentation";
import { cohortMemberScenarios as cohorts } from "../test/fixtures/cohort-members";
import { mockScenarios } from "../test/fixtures/investigations";

afterEach(cleanup);

const s2 = renderShapes as unknown as InvestigationResult;
const LABELS = {
    "fact_field:severity": "Severity",
    "fact_field:estimate_coverage_ratio": "Estimate coverage ratio",
};
const served = (result: InvestigationResult): InvestigationResult => ({
    ...result,
    vocabulary_labels: { ...result.vocabulary_labels, ...LABELS },
});

function draw(result: InvestigationResult) {
    return render(<DeterministicAnswerView offersPresentation="popup" result={result} />).container;
}

const panel = () => screen.getByTestId("scalar-facts-panel");
const row = (label: string) => within(panel()).getByRole("row", { name: new RegExp(label, "u") });
const fold = () => screen.getByTestId("scalar-facts-details");

const base = s2.claimed_facts.find((fact) => fact.field === "severity" && fact.rows === undefined)!;
/** One scalar claim on the answer's own subject, with its value and its field set. */
function claim(field: string, value: ClaimedFact["value"], extra: Partial<ClaimedFact> = {}) {
    const { rows: _rows, ...rest } = base;
    return { ...rest, claim_id: `claim_${field}`, field, value, ...extra } as ClaimedFact;
}
const withClaims = (claims: readonly ClaimedFact[], labels: Record<string, string> = {}) =>
    ({
        ...s2,
        claimed_facts: claims,
        vocabulary_labels: { ...s2.vocabulary_labels, ...labels },
    }) as InvestigationResult;

describe("a scalar fact reaches the screen with no help from the prose", () => {
    it("s2: severity critical and the coverage ratio, each with its subject", () => {
        draw(served(s2));
        expect(row("Severity")).toHaveTextContent("critical");
        expect(row("Severity")).toHaveTextContent("CHAOS");
        expect(row("Estimate coverage ratio")).toHaveTextContent("0.6");
    });

    it("draws one table, and no row for a fact that has rows", () => {
        draw(served(s2));
        expect(within(panel()).getAllByRole("table")).toHaveLength(1);
        expect(panel()).not.toHaveTextContent("elevated");
        expect(within(panel()).getAllByRole("row")).toHaveLength(3);
    });

    it("draws nothing when every fact has rows", () => {
        draw(withClaims(s2.claimed_facts.filter((fact) => (fact.rows?.length ?? 0) > 0)));
        expect(screen.queryByTestId("scalar-facts-panel")).toBeNull();
    });

    it("draws one fact claimed twice once", () => {
        const twice = [
            claim("severity", { string: "critical" }),
            claim("severity", { string: "critical" }),
        ];
        draw(withClaims(twice, LABELS));
        expect(within(panel()).getAllByRole("row")).toHaveLength(2);
    });

    it("takes a fact with an empty rows list: it has no table", () => {
        draw(withClaims([claim("severity", { string: "critical" }, { rows: [] })], LABELS));
        expect(row("Severity")).toHaveTextContent("critical");
    });

    it("keeps one value on two subjects, two kinds or two fields: they are separate facts", () => {
        const value = { string: "critical" };
        const other = { ...base.subject, canonical_id: "team:other", label: "Other Team" };
        const claims = [
            claim("severity", value),
            claim("severity", value, { claim_id: "claim_subject", subject: other }),
            claim("severity", value, { claim_id: "claim_kind", kind: "health" }),
            claim("estimate_coverage_ratio", value),
        ];
        draw(withClaims(claims, LABELS));
        expect(within(panel()).getAllByRole("row")).toHaveLength(5);
    });

    it("keeps two values of one field: they are two facts", () => {
        const claims = [
            claim("severity", { string: "critical" }),
            claim("severity", { string: "high" }, { claim_id: "claim_other" }),
        ];
        draw(withClaims(claims, LABELS));
        expect(within(panel()).getAllByRole("row")).toHaveLength(3);
    });
});

describe("a fact with a place already is not shown twice", () => {
    const rows = [{ fields: { severity: { string: "critical" } } }];
    const table = (extra: Partial<ClaimedFact> = {}) =>
        claim("incident_rollup", { string: "x" }, { rows, ...extra });

    it("a cell of a table on the same subject and kind", () => {
        draw(withClaims([table(), claim("severity", { string: "critical" })], LABELS));
        expect(screen.queryByTestId("scalar-facts-panel")).toBeNull();
    });

    it("a field named like an object's own method is not a cell of every table", () => {
        const labels = { "fact_field:toString": "To string" };
        draw(withClaims([table(), claim("toString", { null: true })], labels));
        expect(row("To string")).toBeInTheDocument();
    });

    it("the same field with another value is a fact of its own", () => {
        draw(withClaims([table(), claim("severity", { string: "low" })], LABELS));
        expect(row("Severity")).toHaveTextContent("low");
    });

    it("the same field and value of another kind is a fact of its own", () => {
        draw(
            withClaims(
                [table({ kind: "health" }), claim("severity", { string: "critical" })],
                LABELS,
            ),
        );
        expect(row("Severity")).toHaveTextContent("critical");
    });

    it("the same field and value of another subject is a fact of its own", () => {
        const other = { ...base.subject, canonical_id: "team:other", label: "Other Team" };
        draw(
            withClaims(
                [table({ subject: other }), claim("severity", { string: "critical" })],
                LABELS,
            ),
        );
        expect(row("Severity")).toHaveTextContent("critical");
    });

    it("a rollup basis the table's caption reads", () => {
        const labels = { "fact_field:rollup_basis": "Basis" };
        const basis = claim("rollup_basis", { string: "owning_team" });
        draw(withClaims([table(), basis], labels));
        expect(screen.queryByTestId("scalar-facts-panel")).toBeNull();
    });

    it("two rollup bases: the caption reads neither, so each is shown", () => {
        const labels = { "fact_field:rollup_basis": "Basis" };
        const claims = [
            table(),
            claim("rollup_basis", { string: "owning_team" }),
            claim("rollup_basis", { string: "contributors" }, { claim_id: "claim_other" }),
        ];
        draw(withClaims(claims, labels));
        expect(within(panel()).getAllByRole("row")).toHaveLength(3);
    });

    it("a basis of another subject or kind is not the caption's", () => {
        const labels = { "fact_field:rollup_basis": "Basis" };
        const value = { string: "owning_team" };
        const other = { ...base.subject, canonical_id: "team:other", label: "Other Team" };
        const claims = [
            table(),
            claim("rollup_basis", value),
            claim("rollup_basis", value, { claim_id: "claim_subject", subject: other }),
            claim("rollup_basis", value, { claim_id: "claim_kind", kind: "health" }),
        ];
        draw(withClaims(claims, labels));
        expect(within(panel()).getAllByRole("row")).toHaveLength(3);
    });

    it("the basis's value under another field is a fact of its own", () => {
        const labels = { "fact_field:rollup_basis": "Basis", "fact_field:method": "Method" };
        const value = { string: "owning_team" };
        draw(withClaims([table(), claim("rollup_basis", value), claim("method", value)], labels));
        expect(row("Method")).toHaveTextContent("owning_team");
    });

    it("a dated fact with no rows: no panel draws its chart, so its value is here", () => {
        const dated = s2.claimed_facts.find((fact) => fact.time_series_rows !== undefined)!;
        const { rows: _rows, ...noRows } = dated;
        const key = `fact_field:${dated.field}`;
        const result = withClaims(
            s2.claimed_facts.map((fact) => (fact === dated ? (noRows as ClaimedFact) : fact)),
            { ...LABELS, [key]: "Dated" },
        );
        draw(result);
        expect(row("Dated")).toBeInTheDocument();
    });
});

describe("the status table", () => {
    const items = cohorts["work-items"];
    const words = { "fact_field:status": "Status", "fact_field:title": "Title" };
    const worded: InvestigationResult = {
        ...items,
        vocabulary_labels: { ...items.vocabulary_labels, ...words },
    };
    const status = items.claimed_facts.find((fact) => fact.kind === "status")!;

    it("draws a listed work item's status, so this panel does not", () => {
        draw(worded);
        expect(within(panel()).queryByRole("row", { name: /Status/u })).toBeNull();
        expect(screen.getByTestId("work-item-status-panel")).toHaveTextContent("open");
    });

    it("draws no other claim of that work item, so this panel does", () => {
        draw(worded);
        expect(row("Title")).toBeInTheDocument();
    });

    it("does not list another work item, so its status is here", () => {
        const subject = { ...status.subject, canonical_id: "work_item.v2:repo-1:work-2" };
        const other = { ...status, claim_id: "claim_other", subject };
        draw({ ...worded, claimed_facts: [...worded.claimed_facts, other] });
        expect(row("Status")).toHaveTextContent("open");
    });

    it("is not drawn for an answer that did not ask for the cohort, so the status is here", () => {
        const { answer_plan: _plan, ...noPlan } = worded;
        const notAsked = {
            ...noPlan,
            interpretation: { ...worded.interpretation, shape: "single_subject" },
        } as InvestigationResult;
        draw(notAsked);
        expect(screen.queryByTestId("work-item-status-panel")).toBeNull();
        expect(row("Status")).toHaveTextContent("open");
    });
});

describe("null, blank, zero and false stay distinct (check 12)", () => {
    const labels = {
        "fact_field:a": "Null field",
        "fact_field:b": "Blank field",
        "fact_field:c": "Zero field",
        "fact_field:d": "False field",
    };

    it("each reads as what it is", () => {
        draw(
            withClaims(
                [
                    claim("a", { null: true }),
                    claim("b", { string: "" }),
                    claim("c", { integer: 0 }),
                    claim("d", { boolean: false }),
                ],
                labels,
            ),
        );
        const value = (label: string) => within(row(label)).getAllByRole("cell").at(-1);
        expect(value("Null field")).toHaveTextContent(/^—$/u);
        expect(value("Blank field")).toHaveTextContent(/^\(blank\)$/u);
        expect(value("Zero field")).toHaveTextContent(/^0$/u);
        expect(value("False field")).toHaveTextContent(/^false$/u);
    });
});

describe("a person subject", () => {
    const person = { kind: "person", canonical_id: "person:1", label: "A Person" };

    it("shows no name and no value, and says so", () => {
        const { container } = render(
            <DeterministicAnswerView
                offersPresentation="popup"
                result={withClaims(
                    [claim("severity", { string: "critical" }, { subject: person })],
                    LABELS,
                )}
            />,
        );
        expect(container).not.toHaveTextContent("A Person");
        expect(screen.getByTestId("scalar-facts-person")).toBeInTheDocument();
        expect(within(panel()).queryByRole("table")).toBeNull();
    });

    it("a person's table shows no name and no value either", () => {
        const rows = [{ fields: { severity: { string: "critical" } } }];
        const { container } = render(
            <DeterministicAnswerView
                offersPresentation="popup"
                result={withClaims(
                    [
                        claim("incident_rollup", { string: "x" }, { rows, subject: person }),
                        claim("severity", { string: "critical" }, { subject: person }),
                    ],
                    LABELS,
                )}
            />,
        );
        expect(container).not.toHaveTextContent("A Person");
        expect(container).not.toHaveTextContent("critical");
        expect(screen.getByTestId("scalar-facts-person")).toBeInTheDocument();
    });

    it("keeps the facts of the other subjects", () => {
        const claims = [
            claim("severity", { string: "critical" }, { subject: person }),
            claim("estimate_coverage_ratio", { number: 0.6 }),
        ];
        draw(withClaims(claims, LABELS));
        expect(row("Estimate coverage ratio")).toHaveTextContent("0.6");
        expect(panel()).not.toHaveTextContent("A Person");
    });
});

describe("a field with no served label", () => {
    it("has its raw key in the closed fold only, with its value and subject", () => {
        const { container } = render(
            <DeterministicAnswerView offersPresentation="popup" result={s2} />,
        );
        expect(fold()).not.toHaveAttribute("open");
        expect(within(fold()).getAllByTestId("scalar-fact-raw")[0]).toHaveTextContent(
            "CHAOS: severity: critical",
        );
        const outside = container.cloneNode(true) as HTMLElement;
        outside.querySelectorAll("details").forEach((node) => node.remove());
        expect(outside.textContent).not.toContain("estimate_coverage_ratio");
    });

    it("draws no table when no field has a label", () => {
        draw(s2);
        expect(within(panel()).queryByRole("table")).toBeNull();
    });

    it("draws no fold when every field has a label", () => {
        draw(served(s2));
        expect(screen.queryByTestId("scalar-facts-details")).toBeNull();
    });

    it("a derived claim's field is free text: it takes the fold even with a word for that name", () => {
        const derived = claim(
            "severity",
            { string: "critical" },
            {
                derived_from: [
                    { fact_id: "a", field: "x" },
                    { fact_id: "b", field: "y" },
                ],
            },
        );
        draw(withClaims([derived], LABELS));
        expect(within(panel()).queryByRole("table")).toBeNull();
        expect(within(fold()).getByTestId("scalar-fact-raw")).toHaveTextContent(
            "severity: critical",
        );
    });
});

describe("a restored answer is not validated", () => {
    it("a status claim on a result with no interpretation draws", () => {
        const { interpretation: _interpretation, ...rest } = cohorts["work-items"];
        const status = rest.claimed_facts.find((fact) => fact.kind === "status")!;
        render(
            <VocabularyLabelsContext.Provider value={{ "fact_field:status": "Status" }}>
                <ScalarFactsPanel facts={[status]} result={rest as InvestigationResult} />
            </VocabularyLabelsContext.Provider>,
        );
        expect(row("Status")).toHaveTextContent("open");
    });

    it.each([
        ["no subject", { subject: undefined }],
        ["no field", { field: undefined }],
        ["a null value", { value: null }],
    ])("a claim with %s draws no row, and the others stay", (_name, odd) => {
        const claims = [
            { ...claim("severity", { string: "critical" }), ...odd } as unknown as ClaimedFact,
            claim("estimate_coverage_ratio", { number: 0.6 }),
        ];
        render(
            <VocabularyLabelsContext.Provider value={LABELS}>
                <ScalarFactsPanel facts={claims} result={undefined} />
            </VocabularyLabelsContext.Provider>,
        );
        expect(within(panel()).getAllByRole("row")).toHaveLength(2);
        expect(row("Estimate coverage ratio")).toBeInTheDocument();
        expect(screen.queryByTestId("scalar-fact-raw")).toBeNull();
    });
});

/**
 * Acceptance 7: with no prose and no other section to lean on, every scalar claim of every served
 * shape has a place: a table of its own, or this panel.
 */
describe("every scalar fact has a place on screen", () => {
    const quiet = ({
        cohort: _cohort,
        render_shapes: _shapes,
        ...result
    }: InvestigationResult): InvestigationResult => ({
        ...result,
        deterministic_answer: "Answer.",
        direct_judgment: "Answer.",
        current_state: "",
        strongest_pressures: [],
        drivers: [],
        remaining_work: [],
        readiness_gaps: [],
        paths: [],
        conflicts: [],
    });
    const results: readonly (readonly [string, InvestigationResult])[] = [
        ["the plain example", plain as unknown as InvestigationResult],
        ["the origin state example", originState as unknown as InvestigationResult],
        ["the render shapes example", s2],
        ...mockScenarios().map((scenario) => [scenario.id, scenario.result] as const),
    ];
    const scalars = (result: InvestigationResult) =>
        result.claimed_facts.filter(
            (fact) => (fact.rows?.length ?? 0) === 0 && fact.subject.kind !== "person",
        );

    it("the corpus holds a scalar fact, so this cannot pass on nothing", () => {
        expect(results.flatMap(([, result]) => scalars(result)).length).toBeGreaterThan(1);
    });

    it.each(results)("%s", (_name, result) => {
        const container = draw(quiet(result));
        for (const fact of scalars(result)) {
            // A table's caption words its rollup basis, so that value is drawn in the generic path.
            const text = cellText(fact.value);
            expect(
                [text, humanizeTerm(text)].some((value) => container.textContent.includes(value)),
            ).toBe(true);
        }
    });
});
