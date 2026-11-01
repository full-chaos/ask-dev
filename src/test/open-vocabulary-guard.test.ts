import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { render } from "@testing-library/react";
import { createElement } from "react";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { SemanticReadingNotice } from "@/components/SemanticReadingNotice";
import commonSchema from "@/contracts/schemas/context_fabric_common.v1.schema.json";
import requestSchema from "@/contracts/schemas/context_fabric_investigation_request.v1.schema.json";
import resultSchema from "@/contracts/schemas/context_fabric_investigation_result.v1.schema.json";
import errorSchema from "@/contracts/schemas/error.v1.schema.json";
import { RANKABLE_SUBJECT_KINDS, RANKED_COHORT_KINDS } from "@/lib/cohort-ranking";
import { SUBJECT_KIND_VOCABULARY } from "@/lib/contracts";
import { candidateStateTone, coverageStateTone, type Tone } from "@/lib/presentation";
import { TELEMETRY_VOCABULARIES } from "@/lib/telemetry/outcome";
import { DECIDED_OPEN_VOCABULARIES } from "@/test/open-vocabulary-decisions";
import { findRankReadsInFiles, findRankReadsTyped } from "@/test/rank-read-scan";

/**
 * The guard for the open-vocabulary class: the pinned acr schemas declare many
 * vocabularies open (`x-documented-values`, "a client must tolerate values it
 * does not know"). Every documented value must have had a consumer decision.
 * Adding a member, or a whole new open vocabulary, to a vendored schema fails
 * here until the consumer is decided and `open-vocabulary-decisions.ts` says so.
 */

const SCHEMAS: Readonly<Record<string, unknown>> = {
    "context_fabric_common.v1.schema.json": commonSchema,
    "context_fabric_investigation_request.v1.schema.json": requestSchema,
    "context_fabric_investigation_result.v1.schema.json": resultSchema,
    "error.v1.schema.json": errorSchema,
};

function collect(schemas: Readonly<Record<string, unknown>>): Map<string, readonly string[]> {
    const found = new Map<string, readonly string[]>();
    const walk = (node: unknown, path: string, file: string): void => {
        if (Array.isArray(node)) {
            node.forEach((child, index) => walk(child, `${path}/${String(index)}`, file));
            return;
        }
        if (node === null || typeof node !== "object") return;
        const record = node as Record<string, unknown>;
        const documented = record["x-documented-values"];
        if (Array.isArray(documented)) found.set(`${file}#${path}`, documented as string[]);
        for (const [key, child] of Object.entries(record)) walk(child, `${path}/${key}`, file);
    };
    for (const [file, schema] of Object.entries(schemas)) walk(schema, "", file);
    return found;
}

/** Everything the schemas document that no consumer decision covers. */
function undecided(
    schemas: Readonly<Record<string, unknown>>,
    decided: Readonly<Record<string, readonly string[]>>,
): string[] {
    const gaps: string[] = [];
    const found = collect(schemas);
    for (const [path, values] of found) {
        const known = decided[path];
        if (known === undefined) {
            gaps.push(`${path}: open vocabulary with no decision`);
            continue;
        }
        for (const value of values) {
            if (!known.includes(value)) gaps.push(`${path}: undecided value ${value}`);
        }
    }
    for (const path of Object.keys(decided)) {
        if (!found.has(path)) gaps.push(`${path}: decided but no longer in the schema`);
    }
    return gaps;
}

const decidedAt = (suffix: string): readonly string[] => {
    const hit = Object.entries(DECIDED_OPEN_VOCABULARIES).find(([key]) => key.endsWith(suffix));
    if (hit === undefined) throw new Error(`no decision recorded for ${suffix}`);
    return hit[1];
};

const sorted = (values: Iterable<string>): string[] => [...values].sort();

describe("open vocabulary guard: every documented value has a decision", () => {
    it("the pinned schemas hold no undecided open-vocabulary value", () => {
        expect(undecided(SCHEMAS, DECIDED_OPEN_VOCABULARIES)).toEqual([]);
    });

    it("FAILS when a documented value is added (guard proven by injection into a copy)", () => {
        const copy = structuredClone(commonSchema) as unknown as {
            $defs: { SubjectRef: { properties: { kind: { "x-documented-values": string[] } } } };
        };
        copy.$defs.SubjectRef.properties.kind["x-documented-values"].push("brand_new_kind");
        const gaps = undecided(
            { ...SCHEMAS, "context_fabric_common.v1.schema.json": copy },
            DECIDED_OPEN_VOCABULARIES,
        );
        expect(gaps).toEqual([
            "context_fabric_common.v1.schema.json#/$defs/SubjectRef/properties/kind: undecided value brand_new_kind",
        ]);
    });

    it("FAILS when a whole new open vocabulary appears (injected into a copy)", () => {
        const copy = structuredClone(resultSchema) as unknown as {
            properties: Record<string, unknown>;
        };
        copy.properties["brand_new_field"] = { type: "string", "x-documented-values": ["a"] };
        const gaps = undecided(
            { ...SCHEMAS, "context_fabric_investigation_result.v1.schema.json": copy },
            DECIDED_OPEN_VOCABULARIES,
        );
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toContain("open vocabulary with no decision");
    });
});

describe("open vocabulary guard: subject kinds (rank allowlist)", () => {
    const documented = decidedAt("/$defs/SubjectRef/properties/kind");

    it("the rank allowlist equals the documented SubjectRef and Cohort kinds", () => {
        expect(sorted(RANKABLE_SUBJECT_KINDS)).toEqual(sorted(documented));
        expect(sorted(RANKABLE_SUBJECT_KINDS)).toEqual(
            sorted(decidedAt("/$defs/Cohort/properties/kind")),
        );
    });

    it("the ranked kinds (G1, CHAOS-12429) are exactly team, project and repository, all documented", () => {
        expect(sorted(RANKED_COHORT_KINDS)).toEqual(["project", "repository", "team"]);
        for (const kind of RANKED_COHORT_KINDS) {
            expect(documented).toContain(kind);
            expect(RANKABLE_SUBJECT_KINDS).toContain(kind);
        }
        expect(RANKED_COHORT_KINDS.some((kind) => /person|user|people|human/i.test(kind))).toBe(
            false,
        );
    });

    it("never allows person, by name or by prefix", () => {
        expect(RANKABLE_SUBJECT_KINDS.some((kind) => /person|user|people|human/i.test(kind))).toBe(
            false,
        );
    });

    it("every documented kind is either sendable as a request hint or decided as unsendable", () => {
        const decidedUnsendable: readonly string[] = [];
        for (const kind of documented) {
            expect(
                (SUBJECT_KIND_VOCABULARY as readonly string[]).includes(kind) ||
                    decidedUnsendable.includes(kind),
            ).toBe(true);
        }
    });
});

describe("open vocabulary guard: telemetry bounds", () => {
    it("each telemetry allowlist equals the documented vocabulary", () => {
        expect(sorted(TELEMETRY_VOCABULARIES.questionShape)).toEqual(
            sorted(decidedAt("/$defs/InterpretedQuestion/properties/shape")),
        );
        expect(sorted(TELEMETRY_VOCABULARIES.candidateState)).toEqual(
            sorted(decidedAt("/$defs/SubjectCandidate/properties/state")),
        );
        expect(sorted(TELEMETRY_VOCABULARIES.subjectKind)).toEqual(
            sorted(decidedAt("/$defs/SubjectRef/properties/kind")),
        );
        expect(sorted(TELEMETRY_VOCABULARIES.coverageState)).toEqual(
            sorted(decidedAt("/$defs/SourceObservation/properties/state")),
        );
    });
});

describe("open vocabulary guard: tone maps", () => {
    const COVERAGE: Record<string, Tone> = {
        available: "ok",
        stale: "warn",
        truncated: "warn",
        conflicted: "warn",
        pruned: "warn",
        unavailable: "bad",
        unauthorized: "bad",
        unconfigured: "neutral",
        no_data: "neutral",
        not_applicable: "neutral",
    };
    const CANDIDATE: Record<string, Tone> = {
        committed: "ok",
        proposed: "neutral",
        ambiguous: "warn",
        unresolved: "bad",
    };

    it("every documented coverage state has an explicit tone decision", () => {
        const documented = decidedAt("/$defs/SourceObservation/properties/state");
        expect(sorted(Object.keys(COVERAGE))).toEqual(sorted(documented));
        for (const state of documented) {
            expect(coverageStateTone(state as never)).toBe(COVERAGE[state]);
        }
        expect(coverageStateTone("a_state_nobody_decided")).toBe("neutral");
    });

    it("every documented candidate state has an explicit tone decision", () => {
        const documented = decidedAt("/$defs/SubjectCandidate/properties/state");
        expect(sorted(Object.keys(CANDIDATE))).toEqual(sorted(documented));
        for (const state of documented) {
            expect(candidateStateTone(state as never)).toBe(CANDIDATE[state]);
        }
    });
});

describe("open vocabulary guard: semantic_reading.reason notice", () => {
    const REASON_TEXT: Record<string, RegExp> = {
        semantic_state_absent: /no stored reading of the question is available/,
        semantic_state_unreadable: /could not be read/,
    };

    it("every documented reason has its own decided sentence; unknown claims no cause", () => {
        const documented = decidedAt("/properties/semantic_reading/properties/reason");
        expect(sorted(Object.keys(REASON_TEXT))).toEqual(sorted(documented));
        for (const reason of documented) {
            const { container, unmount } = render(
                createElement(SemanticReadingNotice, {
                    semanticReading: { status: "unavailable", reason } as never,
                }),
            );
            expect(container.textContent).toMatch(REASON_TEXT[reason]!);
            unmount();
        }
    });
});

/**
 * Round 2 (P1): every consumer reads the WITHHELD form. Rank/score/driver
 * fields of a cohort member may be read only by the files that implement the
 * gated ranking (and the withholding boundary itself); a new reader fails here
 * until it is decided. The result boundary must be applied on the route and at
 * the client's entry point, and the route may never return a raw result.
 */
describe("ranking withheld boundary guard", () => {
    const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
    const TEST_FILE = /\.test\.(?:[cm]?[jt]s|[jt]sx)$/;
    const root = path.resolve(__dirname, "..");
    const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
            const full = path.join(dir, name);
            if (statSync(full).isDirectory()) {
                return name === "contracts" || name === "test" ? [] : walk(full);
            }
            return SOURCE_FILE.test(name) && !TEST_FILE.test(name) ? [full] : [];
        });
    const ALLOWED_READERS = [
        "lib/cohort-ranking.ts",
        // CHAOS-12429 E: the no-score caption counts the verified cohort's ranked members.
        "lib/coverage-caption.ts",
        "lib/ranking-withheld.ts",
        "lib/render-shapes.ts",
        "components/CohortRankingPanel.tsx",
        "components/WorkItemStatusPanel.tsx",
    ];

    // A type check of the whole program, not a wait: 0.9 s on a laptop, 4.6 s on hosted CI at main,
    // and 5.08 s after CHAOS-12429 added four files, past the 5 s default.
    it(
        "only the decided files read member rank, score or driver fields",
        { timeout: 30_000 },
        () => {
            const offenders = [...findRankReadsInFiles(walk(root)).keys()]
                .map((file) => path.relative(root, file))
                .filter((rel) => !ALLOWED_READERS.includes(rel));
            expect(offenders).toEqual([]);
        },
    );

    it("scans the workbench and home page entries", () => {
        const scanned = walk(root).map((file) => path.relative(root, file));
        expect(scanned).toContain("app/workbench/page.tsx");
        expect(scanned).toContain("app/page.tsx");
        expect(scanned).toContain("components/chat/AskDevChat.tsx");
    });

    it("flags an aliased member read planted in the workbench page source", () => {
        const source = readFileSync(path.join(root, "app/workbench/page.tsx"), "utf8");
        expect(findRankReadsTyped(source)).toEqual([]);
        const planted =
            'import type { Cohort as PlantedCohort } from "@/contracts/generated/investigation-result";\n' +
            "declare const plantedCohort: PlantedCohort;\n" +
            "const plantedMember = plantedCohort.members[0]!;\n" +
            "export const plantedRead = plantedMember.score;\n";
        expect(findRankReadsTyped(source + planted).length).toBeGreaterThan(0);
    });

    it.each(["a.ts", "a.tsx", "a.js", "a.jsx", "a.mjs", "a.cjs", "a.mts", "a.cts"])(
        "walks %s as source and a .test version of it as a test",
        (name) => {
            expect(SOURCE_FILE.test(name)).toBe(true);
            expect(TEST_FILE.test(name.replace(".", ".test."))).toBe(true);
            expect(TEST_FILE.test(name)).toBe(false);
        },
    );

    // The chat page renders `AskDevChat`, which owns the chat's result state.
    it.each(["app/workbench/page.tsx", "components/chat/AskDevChat.tsx"])(
        "%s hands every result it stores from the withheld boundary, never a raw one",
        (rel) => {
            const text = readFileSync(path.join(root, rel), "utf8");
            const file = ts.createSourceFile(
                rel,
                text,
                ts.ScriptTarget.Latest,
                true,
                ts.ScriptKind.TSX,
            );
            let boundaryAt = -1;
            let firstResultAt = -1;
            const stored: string[] = [];
            const visit = (node: ts.Node): void => {
                if (
                    ts.isVariableDeclaration(node) &&
                    ts.isIdentifier(node.name) &&
                    node.name.text === "boundary" &&
                    node.initializer?.getText().startsWith("withholdUnrankableRankings(")
                ) {
                    boundaryAt = node.getStart();
                }
                if (
                    (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
                    node.name.getText() === "result"
                ) {
                    if (firstResultAt === -1) firstResultAt = node.getStart();
                    stored.push(
                        ts.isPropertyAssignment(node) ? node.initializer.getText() : "result",
                    );
                }
                ts.forEachChild(node, visit);
            };
            visit(file);
            expect(boundaryAt).toBeGreaterThan(-1);
            expect(firstResultAt).toBeGreaterThan(boundaryAt);
            expect(stored.length).toBeGreaterThan(0);
            expect(new Set(stored)).toEqual(new Set(["boundary.result"]));
        },
    );

    it("applies the boundary on the route and at the client entry", () => {
        const route = readFileSync(path.join(root, "app/api/investigations/route.ts"), "utf8");
        const page = readFileSync(path.join(root, "components/chat/AskDevChat.tsx"), "utf8");
        expect(route).toContain("withholdUnrankableRankings(result)");
        expect(route).toContain("rankingWithheld: withheld.rankingWithheld");
        const workbench = readFileSync(path.join(root, "app/workbench/page.tsx"), "utf8");
        expect(workbench).toContain("withholdUnrankableRankings(result as InvestigationResult)");
        expect(route).not.toMatch(/NextResponse\.json\(\{\s*result\s*[,}]/);
        expect(page).toContain("withholdUnrankableRankings(result as InvestigationResult)");
        expect(page).not.toMatch(/result:\s*result as InvestigationResult/);
    });
});
