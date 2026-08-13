import { describe, expect, it } from "vitest";

import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import type { InvestigationResult } from "@/lib/contracts";
import { PRESENTATION_MANIFEST_V1 } from "@/lib/enrichment/manifest";
import {
    validateEnrichment,
    type EnrichmentPredicate,
    type EnrichmentValidation,
} from "@/lib/enrichment/validate";

const result = canonicalResult as unknown as InvestigationResult;

/**
 * A composition that passes every predicate. Every hostile case below is this
 * one with a single thing broken, so a failure isolates the predicate under
 * test rather than a general mess.
 */
const VALID = `root = Answer("@result.deterministic_answer", [prose, cov, lim])
prose = Prose("@result.direct_judgment", [ev])
ev = EvidenceRef("@result.evidence_ref_ids.0")
cov = Coverage("@result.coverage.partial", [src])
src = CoverageSource("@result.coverage.sources.0.source", "@result.coverage.sources.0.state")
lim = Limitations([limItem])
limItem = LimitationItem("@result.limitations.0")`;

function validate(composition: string): EnrichmentValidation {
    return validateEnrichment(composition, result, PRESENTATION_MANIFEST_V1);
}

function violated(validation: EnrichmentValidation): readonly EnrichmentPredicate[] {
    return validation.ok ? [] : validation.violations.map((violation) => violation.predicate);
}

describe("enrichment validator — the passing control", () => {
    /**
     * Without this, every hostile test below could pass for the wrong reason:
     * a validator that rejected everything would look perfect.
     */
    it("accepts a well-formed, reference-only composition", () => {
        const validation = validate(VALID);
        expect(validation.ok, validation.ok ? "" : JSON.stringify(violated(validation))).toBe(true);
    });
});

describe("enrichment validator — one hostile payload per predicate", () => {
    it("rejects a component outside the closed library", () => {
        const validation = validate(`root = Answer("@result.deterministic_answer", [bad])
bad = MarkdownHtml("<img src=x onerror=alert(1)>")`);
        expect(violated(validation)).toContain("parse_errors");
    });

    /**
     * OpenUI's own standard-library components must be as unavailable as any
     * other unknown component. Proven empirically in the M1 probe: against a
     * custom library, `Stack` parses as `unknown-component`.
     */
    it("rejects OpenUI's own standard-library components", () => {
        const validation = validate(`root = Stack([t])
t = TextContent("hello", "large-heavy")`);
        expect(violated(validation)).toContain("parse_errors");
    });

    /**
     * The empirically discovered gap: a dangling reference populates
     * `meta.unresolved` while `meta.errors` stays EMPTY. A validator that
     * checked only `errors` would let this through.
     */
    it("rejects a dangling reference that raises no parser error", () => {
        const validation =
            validate(`root = Answer("@result.deterministic_answer", [missingProse, cov, lim])
cov = Coverage("@result.coverage.partial", [])
lim = Limitations([])`);
        expect(violated(validation)).toContain("unresolved_references");
    });

    it("rejects a Query() data fetch", () => {
        const validation = validate(`${VALID}
data = Query("get_metrics", {project: "ask_dev"})`);
        expect(violated(validation)).toContain("query_statements");
    });

    it("rejects a Mutation() write", () => {
        const validation = validate(`${VALID}
m = Mutation("delete_project", {id: "p1"})`);
        expect(violated(validation)).toContain("mutation_statements");
    });

    /**
     * The other empirically discovered gap: built-in functions raise no error
     * and surface only as `hasDynamicProps`. A model computing a number is
     * authoring a fact, which the spec forbids outright.
     */
    it("rejects a built-in function computing a value", () => {
        const validation = validate(`root = Answer("" + @Count(nums), [cov, lim])
nums = [1, 2, 3]
cov = Coverage("@result.coverage.partial", [])
lim = Limitations([])`);
        expect(violated(validation)).toContain("dynamic_props");
    });

    it("rejects reactive state declarations", () => {
        const validation = validate(`$mode = "summary"
root = Answer($mode, [cov, lim])
cov = Coverage("@result.coverage.partial", [])
lim = Limitations([])`);
        expect(violated(validation)).toContain("state_declarations");
    });

    it("rejects a composition rooted at the wrong component", () => {
        const validation = validate(`root = Prose("@result.direct_judgment")`);
        expect(violated(validation)).toContain("root_component");
    });

    /**
     * The rule that makes model-authored prose impossible rather than merely
     * discouraged: a material prop may never be a literal, however plausible
     * the literal looks.
     */
    it("rejects a literal in a material prop", () => {
        const validation = validate(`root = Answer("Ask Dev is ready to ship.", [cov, lim])
cov = Coverage("@result.coverage.partial", [])
lim = Limitations([])`);
        expect(violated(validation)).toContain("material_prop_not_a_reference");
    });

    it("rejects a reference that does not resolve against this result", () => {
        const validation = validate(`root = Answer("@result.no_such_field", [cov, lim])
cov = Coverage("@result.coverage.partial", [])
lim = Limitations([])`);
        expect(violated(validation)).toContain("unresolvable_reference");
    });

    /**
     * Prototype-chain escapes. `@result.constructor` and `__proto__` walk out
     * of the data and into JavaScript internals if own-property checking is
     * missing.
     */
    it("rejects a reference that walks the prototype chain", () => {
        for (const escape of ["@result.constructor", "@result.__proto__.x", "@result.toString"]) {
            const validation = validate(`root = Answer("${escape}", [cov, lim])
cov = Coverage("@result.coverage.partial", [])
lim = Limitations([])`);
            expect(violated(validation), escape).toContain("unresolvable_reference");
        }
    });

    it("rejects an array index that is not an integer", () => {
        const validation = validate(`root = Answer("@result.limitations.length", [cov, lim])
cov = Coverage("@result.coverage.partial", [])
lim = Limitations([])`);
        expect(violated(validation)).toContain("unresolvable_reference");
    });

    it("rejects a reference pointing at an object rather than a scalar", () => {
        const validation = validate(`root = Answer("@result.coverage", [cov, lim])
cov = Coverage("@result.coverage.partial", [])
lim = Limitations([])`);
        expect(violated(validation)).toContain("unresolvable_reference");
    });

    it("rejects a value outside a closed enum vocabulary", () => {
        const validation = validate(`${VALID.replace("[prose, cov, lim]", "[prose, cmp, cov, lim]")}
cmp = Comparison("sideways", [cmpRow])
cmpRow = ComparisonRow("@result.status", "@result.result_id")`);
        expect(violated(validation)).toContain("unknown_enum_value");
    });

    /**
     * The predicate that stops an enriched view reading as more confident than
     * the result supports.
     */
    it("rejects a composition that omits a mandatory section", () => {
        const noCoverage = `root = Answer("@result.deterministic_answer", [lim])
lim = Limitations([limItem])
limItem = LimitationItem("@result.limitations.0")`;
        expect(violated(validate(noCoverage))).toContain("missing_mandatory_section");

        const noLimitations = `root = Answer("@result.deterministic_answer", [cov])
cov = Coverage("@result.coverage.partial", [])`;
        expect(violated(validate(noLimitations))).toContain("missing_mandatory_section");
    });

    it("rejects a missing required prop", () => {
        const validation =
            validate(`root = Answer("@result.deterministic_answer", [prose, cov, lim])
prose = Prose()
cov = Coverage("@result.coverage.partial", [])
lim = Limitations([])`);
        expect(violated(validation)).toContain("parse_errors");
    });

    /**
     * OpenUI treats excess positional args as a warning and renders anyway,
     * dropping the extras. "Silently dropped part of what was asked for" is not
     * a state worth rendering, so the validator treats it as fatal.
     */
    it("rejects excess arguments that OpenUI would silently drop", () => {
        const validation =
            validate(`root = Answer("@result.deterministic_answer", [cov, lim], "EXTRA")
cov = Coverage("@result.coverage.partial", [])
lim = Limitations([])`);
        expect(violated(validation)).toContain("parse_errors");
    });
});

describe("enrichment validator — reporting", () => {
    it("reports every violation, not just the first", () => {
        const validation = validate(`root = Answer("a literal headline", [cov])
cov = Coverage("@result.coverage.partial", [])
q = Query("get", {})`);
        expect(validation.ok).toBe(false);
        expect(new Set(violated(validation))).toEqual(
            new Set([
                "material_prop_not_a_reference",
                "query_statements",
                "missing_mandatory_section",
            ]),
        );
    });
});
