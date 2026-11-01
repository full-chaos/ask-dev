import { describe, expect, it } from "vitest";

import commonSchema from "@/contracts/schemas/context_fabric_common.v1.schema.json";
import { memberDriversText } from "@/lib/cohort-ranking";

import * as entry from "./index";
import {
    ANSWER_STATUS_LABEL,
    CANDIDATE_STATE_WORDS,
    cohortKindPlural,
    COHORT_OUTCOME_WORDS,
    COMPLETENESS_STATE_WORDS,
    COVERAGE_COPY,
    COVERAGE_STATE_WORDS,
    coverageStateText,
    DERIVATION_LABEL,
    EPISTEMIC_LABEL,
    factCountText,
    FACT_KIND_LABEL,
    humanize,
    IMPACT_WORDS,
    labelFor,
    NARROWING_BASIS_WORDS,
    NARROWING_STAGE_WORDS,
    OBLIGATION_LABEL,
    OVERRUN_WORDS,
    QUESTION_FAMILY_WORDS,
    QUICK_STATUS_COPY,
    RECEIPT_DISPOSITION_WORDS,
    REFINEMENT_STAGE_WORDS,
    RELATIVE_WINDOW_WORDS,
    REQUIREMENT_OUTCOME_WORDS,
    requirementLabel,
    STANDING_LABEL,
    statusLabel,
    STRUCTURE_DISPOSITION_WORDS,
    STRUCTURE_PROVENANCE_WORDS,
    STRUCTURE_SOURCE_WORDS,
    subjectKindNoun,
    SUBJECT_KIND_NOUN,
    TERMINAL_REASON_WORDS,
    WINDOW_PROVENANCE_WORDS,
} from "./answer-copy";

/**
 * CHAOS-12406: the words of an answer's states. Every value the pinned schema names has a word, so
 * a pin bump that adds one fails here even where the type is an open `string`. Web's words are
 * written out: web's tests pin them, so a change to a table must fail here.
 */

type Schema = {
    readonly enum?: readonly string[];
    readonly "x-documented-values"?: readonly string[];
    readonly $ref?: string;
    readonly properties?: Readonly<Record<string, Schema>>;
};

const defs = commonSchema.$defs as unknown as Readonly<Record<string, Schema>>;

function values(def: string, property?: string): readonly string[] {
    const owner = defs[def];
    if (owner === undefined) throw new Error(`no $def ${def}`);
    let node = property === undefined ? owner : owner.properties?.[property];
    if (node?.$ref !== undefined) node = defs[node.$ref.split("/").at(-1) ?? ""];
    const found = node?.enum ?? node?.["x-documented-values"];
    if (found === undefined) throw new Error(`no vocabulary at ${def}.${property ?? ""}`);
    return found;
}

const sorted = (list: Iterable<string>): string[] => [...list].sort();

describe("every value the schema names has a word", () => {
    type Row = [string, Readonly<Record<string, string>>, string, string?];
    const TABLES: readonly Row[] = [
        ["ANSWER_STATUS_LABEL", ANSWER_STATUS_LABEL, "AnswerCompleteness", "terminal_status"],
        ["COMPLETENESS_STATE_WORDS", COMPLETENESS_STATE_WORDS, "AnswerCompleteness", "state"],
        ["TERMINAL_REASON_WORDS", TERMINAL_REASON_WORDS, "AnswerCompleteness", "terminal_reason"],
        [
            "REQUIREMENT_OUTCOME_WORDS",
            REQUIREMENT_OUTCOME_WORDS,
            "PlanRequirementOutcomeRow",
            "outcome",
        ],
        ["IMPACT_WORDS", IMPACT_WORDS, "PlanRequirementOutcomeRow", "impact"],
        ["OVERRUN_WORDS", OVERRUN_WORDS, "BudgetOverrun"],
        ["NARROWING_BASIS_WORDS", NARROWING_BASIS_WORDS, "NarrowingBasis"],
        ["NARROWING_STAGE_WORDS", NARROWING_STAGE_WORDS, "PlanNarrowingStage"],
        ["REFINEMENT_STAGE_WORDS", REFINEMENT_STAGE_WORDS, "RequirementRefinement", "stage"],
        ["QUESTION_FAMILY_WORDS", QUESTION_FAMILY_WORDS, "QuestionFamily"],
        ["COVERAGE_STATE_WORDS", COVERAGE_STATE_WORDS, "SourceObservation", "state"],
        ["CANDIDATE_STATE_WORDS", CANDIDATE_STATE_WORDS, "SubjectCandidate", "state"],
        ["STRUCTURE_DISPOSITION_WORDS", STRUCTURE_DISPOSITION_WORDS, "StructureDisposition"],
        ["STRUCTURE_SOURCE_WORDS", STRUCTURE_SOURCE_WORDS, "StructureSource"],
        ["STRUCTURE_PROVENANCE_WORDS", STRUCTURE_PROVENANCE_WORDS, "StructureProvenance"],
        [
            "WINDOW_PROVENANCE_WORDS",
            WINDOW_PROVENANCE_WORDS,
            "EffectiveEvidenceWindow",
            "provenance",
        ],
        ["RECEIPT_DISPOSITION_WORDS", RECEIPT_DISPOSITION_WORDS, "PriorSubjectReceiptDisposition"],
        ["COHORT_OUTCOME_WORDS", COHORT_OUTCOME_WORDS, "CohortMember", "outcome"],
        ["RELATIVE_WINDOW_WORDS", RELATIVE_WINDOW_WORDS, "RelativeWindowID"],
        ["STANDING_LABEL", STANDING_LABEL, "DriverJudgment", "standing"],
        ["DERIVATION_LABEL", DERIVATION_LABEL, "DriverJudgment", "derivation"],
        ["EPISTEMIC_LABEL", EPISTEMIC_LABEL, "DriverJudgment", "epistemic_status"],
        ["FACT_KIND_LABEL", FACT_KIND_LABEL, "DriverJudgment", "category"],
        ["SUBJECT_KIND_NOUN", SUBJECT_KIND_NOUN, "SubjectRef", "kind"],
    ];

    it.each(TABLES)("%s", (_name, table, def, property) => {
        expect(sorted(Object.keys(table))).toEqual(sorted(values(def, property)));
        for (const [key, word] of Object.entries(table)) {
            expect(word.trim(), key).not.toBe("");
            // A word that is its own raw value says nothing.
            expect(word.includes("_"), key).toBe(false);
        }
    });

    it("OBLIGATION_LABEL holds web's words and every documented obligation", () => {
        for (const obligation of values("PlanRequirement", "obligation")) {
            expect(Object.keys(OBLIGATION_LABEL)).toContain(obligation);
        }
    });

    it("FACT_KIND_LABEL covers a finding's kinds too", () => {
        for (const kind of values("Finding", "kind")) {
            expect(Object.keys(FACT_KIND_LABEL)).toContain(kind);
        }
    });
});

describe("web's words", () => {
    it("ANSWER_STATUS_LABEL", () => {
        expect(ANSWER_STATUS_LABEL).toEqual({
            complete: "Full answer",
            partial: "Partial answer",
            degraded: "Degraded answer",
            clarification_required: "Answer needs your confirmation",
            no_match: "No answer: no matching subject",
        });
        expect(QUICK_STATUS_COPY).toEqual({
            notFullyCovered: "Answer, not fully covered",
            answer: "Answer",
        });
    });

    it("the source states, and the requirement outcomes", () => {
        expect(COVERAGE_STATE_WORDS).toEqual({
            available: "read",
            truncated: "partly included",
            pruned: "not needed for this question",
            stale: "stale",
            no_data: "read: no data (zero rows)",
            not_applicable: "does not apply",
            unavailable: "not available: not known",
            unconfigured: "not set up: not known",
            unauthorized: "not readable with your access: not known",
            conflicted: "sources disagree",
        });
        expect(REQUIREMENT_OUTCOME_WORDS).toEqual({
            satisfied: "read in full",
            narrowed: "read in part",
            not_applicable: "does not apply",
            not_attempted: "not read: not known",
            unavailable: "not available: not known",
        });
    });

    it("a cohort member's outcome and the window", () => {
        expect(COHORT_OUTCOME_WORDS).toEqual({
            qualified: "Qualified",
            provisional: "Provisional",
            insufficient_evidence: "Insufficient evidence",
            not_applicable: "Not applicable",
        });
        expect(RELATIVE_WINDOW_WORDS).toEqual({
            trailing_30d: "Last 30 days",
            trailing_90d: "Last 90 days",
            trailing_365d: "Last 365 days",
            all_time: "All time",
        });
    });

    it("the coverage headings", () => {
        expect(COVERAGE_COPY.limitsTitle).toBe("What limits this answer");
    });
});

describe("statusLabel: the one labelling function (web's rule, CHAOS-12245)", () => {
    it.each([
        ["complete", "complete", "Full answer"],
        ["complete", "partial", "Answer, not fully covered"],
        ["complete", "degraded", "Answer, not fully covered"],
        ["complete", "not_derived", "Answer"],
        ["partial", "complete", "Partial answer"],
        ["degraded", "partial", "Degraded answer"],
        ["no_match", "not_derived", "No answer: no matching subject"],
        ["clarification_required", "not_derived", "Answer needs your confirmation"],
    ] as const)("status %s beside completeness %s reads %s", (status, state, words) => {
        expect(statusLabel(status, { state })).toBe(words);
    });

    it("a complete status with no completeness claims neither a full answer nor a gap", () => {
        expect(statusLabel("complete", undefined)).toBe("Answer");
    });
});

describe("the helpers", () => {
    it("humanize and labelFor read a value no table knows, and never a prototype key", () => {
        expect(humanize("brand_new_value")).toBe("Brand new value");
        expect(humanize("_")).toBe("_");
        expect(labelFor({ a: "Word" }, "a")).toBe("Word");
        expect(labelFor({ a: "Word" }, "brand_new")).toBe("Brand new");
        expect(labelFor({}, "constructor")).toBe("Constructor");
    });

    it("coverageStateText uses web's word, then a served label, then says it is not known", () => {
        expect(coverageStateText({ state: "available", state_label: "available" })).toBe("read");
        expect(coverageStateText({ state: "brand_new", state_label: "Served words" })).toBe(
            "Served words",
        );
        expect(coverageStateText({ state: "brand_new", state_label: "  " })).toBe(
            "brand new: not known",
        );
        expect(coverageStateText({ state: "brand_new" })).toBe("brand new: not known");
    });

    it("factCountText says zero as zero", () => {
        const counts = (claimed_facts_count: number, rows_count: number) =>
            factCountText({ claimed_facts_count, rows_count });
        expect(counts(0, 5)).toBe("No facts stand behind this answer.");
        expect(counts(1, 0)).toBe("1 fact, with no source rows.");
        expect(counts(1, 1)).toBe("1 fact from 1 source row.");
        expect(counts(1200, 3400)).toBe("1,200 facts from 3,400 source rows.");
    });

    it("requirementLabel names what the row needed, in web's words", () => {
        expect(requirementLabel({ obligation: "state", requirement: "state/a/b" })).toBe("Status");
        expect(requirementLabel({ requirement: "health/a/b" })).toBe("Health");
        expect(requirementLabel({ obligation: "  ", requirement: "ranking/a" })).toBe("Ranking");
        expect(requirementLabel({ obligation: "brand_new" })).toBe("Brand new");
        expect(requirementLabel({})).toBeUndefined();
    });

    it("memberDriversText says the served driver rows, never the completeness word", () => {
        expect(memberDriversText({ drivers: [{}, {}, {}] })).toBe("3 of 5 drivers");
        expect(memberDriversText({ drivers: [] })).toBeNull();
        expect(memberDriversText({})).toBeNull();
    });

    it("subjectKindNoun and cohortKindPlural read a kind no table knows", () => {
        expect(subjectKindNoun("work_item")).toBe("work item");
        expect(subjectKindNoun("ci_pipeline_run")).toBe("CI run");
        expect(subjectKindNoun("brand_new")).toBe("brand new");
        expect(cohortKindPlural("team")).toBe("teams");
        expect(cohortKindPlural("repository")).toBe("repositories");
        expect(cohortKindPlural("brand_new")).toBe("brand new");
    });
});

describe("the render entry exports the tables", () => {
    it("names each one", () => {
        expect(entry.ANSWER_STATUS_LABEL).toBe(ANSWER_STATUS_LABEL);
        expect(entry.COVERAGE_STATE_WORDS).toBe(COVERAGE_STATE_WORDS);
        expect(entry.REFUSAL_COPY.status).toBe("No answer: too large to send");
        expect(entry.statusLabel).toBe(statusLabel);
    });
});
