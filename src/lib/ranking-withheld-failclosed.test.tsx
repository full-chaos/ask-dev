import { readFileSync } from "node:fs";
import path from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
import { findRankReads } from "@/test/rank-read-scan";

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
