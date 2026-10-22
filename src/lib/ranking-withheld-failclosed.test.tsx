import { readFileSync } from "node:fs";
import path from "node:path";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChatPage from "@/app/page";
import WorkbenchPage from "@/app/workbench/page";
import { CanonicalResultInspector } from "@/components/CanonicalResultInspector";
import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import shapesExample from "@/contracts/examples/context_fabric_investigation_result_render_shapes.v1.json";
import type { InvestigationResult } from "@/lib/contracts";
import {
    RESULT_FIELDS_DROPPED,
    RESULT_FIELDS_DROPPED_TO_EMPTY,
    RESULT_FIELDS_KEPT,
    withholdUnrankableRankings,
} from "@/lib/ranking-withheld";
import { findRankReads, findRankReadsTyped } from "@/test/rank-read-scan";

const teamResult = shapesExample as unknown as InvestigationResult;

function personResult(): InvestigationResult {
    return {
        ...teamResult,
        cohort: {
            ...teamResult.cohort!,
            kind: "person",
            members: teamResult.cohort!.members.map((m) => ({
                ...m,
                subject: { ...m.subject, kind: "person", canonical_id: "person:ada", label: "Ada" },
            })),
        },
        render_shapes: JSON.parse(
            JSON.stringify(teamResult.render_shapes).replaceAll("team:CHAOS", "person:ada"),
        ) as NonNullable<InvestigationResult["render_shapes"]>,
    };
}

describe("fail-closed withholding (allowlist)", () => {
    it("(a) a person cohort result carries no value, label or subject id of its shapes", () => {
        const text = JSON.stringify(withholdUnrankableRankings(personResult()));
        expect(personResult().render_shapes?.length).toBeGreaterThan(0);
        for (const leak of [
            "cohort_member_score",
            "cohort_driver_weight_contributed",
            "person:ada",
            "43.5",
            '"render_shapes":',
            "attention_rank",
        ]) {
            expect(text).not.toContain(leak);
        }
        expect(text).toContain("rankingWithheld");
    });

    it("(a) the inspector and answer view render the kept-only result", () => {
        const withheld = withholdUnrankableRankings(personResult());
        const inspector = render(
            <CanonicalResultInspector
                rankingWithheld={withheld.rankingWithheld}
                result={withheld.result}
            />,
        );
        expect(inspector.container.textContent).not.toContain("person:ada");
        expect(inspector.container.textContent).toMatch(/Ranking not shown/);
        inspector.unmount();
        const view = render(
            <DeterministicAnswerView
                rankingWithheld={withheld.rankingWithheld}
                result={withheld.result}
            />,
        );
        expect(view.container.textContent).not.toContain("person:ada");
    });

    it("(b) every top-level result property is on the keep list or the drop lists", () => {
        const schema = JSON.parse(
            readFileSync(
                path.resolve(
                    __dirname,
                    "../contracts/schemas/context_fabric_investigation_result.v1.schema.json",
                ),
                "utf8",
            ),
        ) as { properties: Record<string, unknown> };
        const decided = new Set<string>([
            ...RESULT_FIELDS_KEPT,
            ...RESULT_FIELDS_DROPPED,
            ...RESULT_FIELDS_DROPPED_TO_EMPTY,
        ]);
        const undecided = Object.keys(schema.properties).filter((key) => !decided.has(key));
        expect(undecided).toEqual([]);
    });

    it("(d) a rankable cohort result is returned unchanged", () => {
        const before = structuredClone(teamResult);
        const after = withholdUnrankableRankings(teamResult);
        expect(after.result).toEqual(before);
        expect(after.result).toBe(teamResult);
        expect(after.rankingWithheld).toBeUndefined();
    });

    it("is idempotent and drops a field a future producer adds", () => {
        const once = withholdUnrankableRankings({
            ...personResult(),
            member_scores_v9: [{ s: 1 }],
        });
        expect(JSON.stringify(once)).not.toContain("member_scores_v9");
        expect(withholdUnrankableRankings(once.result)).toEqual({ result: once.result });
    });
});

describe("(c) rank-read scanner (AST)", () => {
    it.each([
        ["property access", "const a = member.score;"],
        ["destructuring", "const { score, drivers } = member;"],
        ["renamed destructuring", "const { score: s } = members[0]!;"],
        ["bracket access", 'const a = member["score"];'],
        ["bracket rank", 'const a = row["attention_rank"];'],
        ["for-of destructuring", "for (const { drivers } of cohort.members) { use(drivers); }"],
        ["param destructuring", "cohort.members.map(({ score }) => score);"],
        ["rank destructuring", "const { attention_rank } = anything;"],
    ])("flags %s", (_name, code) => {
        expect(findRankReads(code).length).toBeGreaterThan(0);
    });

    it("does not flag unrelated reads", () => {
        expect(findRankReads("const { drivers } = result; const s = result.score2;")).toEqual([]);
    });
});

describe("(d) rank-read scanner (type-aware)", () => {
    const HEAD =
        'import type { Cohort, CohortMember } from "@/contracts/generated/investigation-result";\n' +
        "declare const cohort: Cohort;\ndeclare function use(value: unknown): void;\n";

    it.each([
        ["alias of an indexed member", "const p = cohort.members[0]!; use(p.score);"],
        ["alias read through optional chain", "const [m] = cohort.members; use(m?.drivers);"],
        ["destructured alias", "const p = cohort.members[0]!; const { score } = p; use(score);"],
        ["alias bracket read", 'const p = cohort.members[0]!; use(p["drivers"]);'],
        ["alias inside for-of", "for (const m of cohort.members) { const x = m; use(x.score); }"],
        ["alias inside a callback", "cohort.members.map((m) => { const x = m; return x.score; });"],
        ["typed parameter", "function f(m: CohortMember) { return m.score; } use(f);"],
        ["Pick projection", 'declare const proj: Pick<CohortMember, "score">; use(proj.score);'],
        ["Partial projection", "declare const part: Partial<CohortMember>; use(part.drivers);"],
        ["spread copy", "const { score } = { ...cohort.members[0]! }; use(score);"],
        ["untyped any receiver", "declare const blob: any; use(blob.score);"],
        [
            "computed key of literal type",
            'const row = cohort.members[0]!; const rankKey: "score" = "score"; use(row[rankKey]);',
        ],
        [
            "computed key from a const tuple",
            'const row = cohort.members[0]!; for (const k of ["score", "drivers"] as const) use(row[k]);',
        ],
        ["re-alias chain", "const a = cohort.members[0]!; const b = a; const c = b; use(c.score);"],
    ])("flags %s", (_name, body) => {
        expect(findRankReadsTyped(HEAD + body).length).toBeGreaterThan(0);
    });

    it.each([
        [
            "a result drivers array",
            "declare const result: { drivers: string[] }; use(result.drivers);",
        ],
        ["a non-member score", "declare const row: { score: number }; use(row.score);"],
        [
            "a member field that is not a rank field",
            "const p = cohort.members[0]!; use(p.subject);",
        ],
    ])("does not flag %s", (_name, body) => {
        expect(findRankReadsTyped(HEAD + body)).toEqual([]);
    });
});

describe("(e) both page entries render the withheld form of a raw person-cohort result", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    const LEAKS = ["person:ada", "Ada", "43.5", "attention_rank", "Ranked Persons"];

    async function answerWith(raw: InvestigationResult, label: string, button: string) {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ result: raw }), {
                headers: { "Content-Type": "application/json" },
            }),
        );
        const user = userEvent.setup();
        await user.type(screen.getByLabelText(label), "Who needs attention?");
        await user.click(screen.getByRole("button", { name: button }));
    }

    it.each([
        ["workbench", WorkbenchPage, "Ask Context Fabric", "Investigate"],
        ["chat", ChatPage, "Ask a question", "Send"],
    ] as const)("%s page shows no person ranking", async (_name, Page, label, button) => {
        const { container } = render(<Page />);
        await answerWith(personResult(), label, button);
        expect((await screen.findAllByText(/Ranking not shown/)).length).toBeGreaterThan(0);
        expect(screen.queryByText(/Ranked/)).toBeNull();
        const inspectorTab = screen.queryByRole("tab", { name: "Canonical result" });
        if (inspectorTab !== null) await userEvent.setup().click(inspectorTab);
        for (const leak of LEAKS) expect(container.textContent).not.toContain(leak);
    });
});
