import { describe, expect, it } from "vitest";

import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import type { CohortMember, CohortMemberDriver, InvestigationResult } from "@/lib/contracts";
import {
    RANKING_TABLE_TOP_DRIVERS,
    rankingTable,
    rowWindow,
    topDriversByWeightContributed,
} from "@/lib/cohort-ranking";

const result = canonicalResult as unknown as InvestigationResult;

/**
 * A minimal ranked member. Every value comes from the contract's own closed
 * vocabularies — the house rule for fixtures (`src/test/fixtures/investigations.ts`)
 * is that nothing is invented, and it holds here too.
 */
function member(overrides: Partial<CohortMember> & { label: string }): CohortMember {
    const { label, ...rest } = overrides;
    return {
        subject: { kind: "team", canonical_id: `team:${label}`, label },
        rank: 1,
        inclusion_reasons: ["Matched by kind census over the org's team roster."],
        ...rest,
    };
}

function driver(overrides: Partial<CohortMemberDriver>): CohortMemberDriver {
    return {
        signal: "health.compounding_risk",
        value: 0.5,
        weight: 25,
        weight_contributed: 12.5,
        window: "current",
        ...overrides,
    };
}

describe("rankingTable", () => {
    it("is null when the cohort carries no ranked member (not computed ≠ nothing qualified)", () => {
        expect(rankingTable([member({ label: "CHAOS" })])).toBeNull();
    });

    it("is null for an empty cohort", () => {
        expect(rankingTable([])).toBeNull();
    });

    it("keeps only the members acr actually ranked", () => {
        const rows = rankingTable([
            member({ label: "CHAOS", ranking_computed: true, attention_rank: 1 }),
            member({ label: "Platform" }),
        ]);
        expect(rows?.map((row) => row.member.subject.label)).toEqual(["CHAOS"]);
    });

    it("orders rows by attention_rank, not by the member's own list position", () => {
        const rows = rankingTable([
            member({ label: "Third", ranking_computed: true, attention_rank: 3 }),
            member({ label: "First", ranking_computed: true, attention_rank: 1 }),
            member({ label: "Second", ranking_computed: true, attention_rank: 2 }),
        ]);
        expect(rows?.map((row) => row.member.subject.label)).toEqual(["First", "Second", "Third"]);
    });

    it("reports a missing score as null, never as 0", () => {
        const rows = rankingTable([
            member({
                label: "CHAOS",
                ranking_computed: true,
                attention_rank: 1,
                outcome: "insufficient_evidence",
            }),
        ]);
        expect(rows?.[0]?.score).toBeNull();
    });

    it("projects the pinned canonical example's own cohort", () => {
        // Red on the parent pin: `cohort` carried no ranked member there.
        const rows = rankingTable(result.cohort!.members);
        expect(rows).toHaveLength(1);
        const [row] = rows!;
        expect(row!.member.subject.label).toBe("CHAOS");
        expect(row!.attentionRank).toBe(1);
        expect(row!.score).toBe(43.5);
        expect(row!.member.outcome).toBe("qualified");
        expect(row!.member.data_completeness).toBe("complete");
        expect(row!.window).toBe("current");
        // The two strongest of the member's five drivers, by contribution.
        expect(row!.topDrivers.map((entry) => entry.signal)).toEqual([
            "operational_deficiencies.severity",
            "health.compounding_risk",
        ]);
    });

    it("flags a score with no drivers as withheld", () => {
        const [row] = rankingTable([
            member({
                label: "CHAOS",
                ranking_computed: true,
                attention_rank: 1,
                outcome: "qualified",
                score: 43.5,
            }),
        ])!;
        expect(row!.scoreWithheld).toBe(true);
    });

    it("does not flag a score that HAS drivers, nor an absent score", () => {
        const [explained] = rankingTable([
            member({
                label: "CHAOS",
                ranking_computed: true,
                attention_rank: 1,
                outcome: "qualified",
                score: 43.5,
                drivers: [driver({})],
            }),
        ])!;
        expect(explained!.scoreWithheld).toBe(false);

        const [scoreless] = rankingTable([
            member({
                label: "Platform",
                ranking_computed: true,
                attention_rank: 1,
                outcome: "insufficient_evidence",
            }),
        ])!;
        // Nothing to withhold — "no score" is not a withheld score.
        expect(scoreless!.scoreWithheld).toBe(false);
    });

    it("never yields a score without the drivers that explain it", () => {
        // North Star check 8, stated over the pinned example rather than a
        // constructed one: a scored row always carries drivers to show.
        for (const row of rankingTable(result.cohort!.members) ?? []) {
            if (row.score !== null) expect(row.topDrivers.length).toBeGreaterThan(0);
        }
    });
});

describe("topDriversByWeightContributed", () => {
    it("orders by contribution descending and caps at the limit", () => {
        const ordered = topDriversByWeightContributed(
            [
                driver({ signal: "readiness.coverage_gap", weight_contributed: 6 }),
                driver({ signal: "operational_deficiencies.severity", weight_contributed: 20 }),
                driver({ signal: "health.compounding_risk", weight_contributed: 12.5 }),
            ],
            RANKING_TABLE_TOP_DRIVERS,
        );
        expect(ordered.map((entry) => entry.signal)).toEqual([
            "operational_deficiencies.severity",
            "health.compounding_risk",
        ]);
    });

    it("breaks ties by signal so the order is stable across renders", () => {
        const tied = [
            driver({ signal: "workload.forecast_pressure", weight_contributed: 5 }),
            driver({ signal: "health.compounding_risk", weight_contributed: 5 }),
        ];
        expect(topDriversByWeightContributed(tied, 2).map((entry) => entry.signal)).toEqual([
            "health.compounding_risk",
            "workload.forecast_pressure",
        ]);
        // Same result from the opposite input order — the tie-break decides it,
        // not the caller's ordering.
        expect(topDriversByWeightContributed([...tied].reverse(), 2).map((e) => e.signal)).toEqual([
            "health.compounding_risk",
            "workload.forecast_pressure",
        ]);
    });

    it("does not mutate its input", () => {
        const drivers = [
            driver({ signal: "readiness.coverage_gap", weight_contributed: 6 }),
            driver({ signal: "operational_deficiencies.severity", weight_contributed: 20 }),
        ];
        topDriversByWeightContributed(drivers, 2);
        expect(drivers.map((entry) => entry.signal)).toEqual([
            "readiness.coverage_gap",
            "operational_deficiencies.severity",
        ]);
    });
});

describe("rowWindow", () => {
    it("is current_vs_prior when any driver compared against a prior window", () => {
        expect(
            rowWindow([
                driver({}),
                driver({ signal: "investment_mix", window: "current_vs_prior" }),
            ]),
        ).toBe("current_vs_prior");
    });

    it("is current when every driver is current", () => {
        expect(rowWindow([driver({})])).toBe("current");
    });

    it("is current for a member carrying no drivers at all", () => {
        expect(rowWindow([])).toBe("current");
    });
});
