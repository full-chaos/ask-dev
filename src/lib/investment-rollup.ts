import type { ClaimedFact } from "./contracts";

/**
 * The owning-team roll-up disclosure of an investment claim (CHAOS-12178, CHAOS-12429).
 *
 * The service sets `investment_mix` on an investment claim about a project, from the claim's
 * grounding fact (never model-authored). `owning_team_rollup` means the value is the owning teams'
 * roll-up, served because the project has no measurable work of its own in the window; CHAOS-5930
 * decision A says that must be disclosed. The model's prose need not restate it, so the render
 * labels it wherever such a claim is drawn: drivers, the ranking and the fact tables.
 *
 * Nothing is invented: no `investment_mix`, `project_native`, or a source this client does not know
 * (the vocabulary is open) gives no label.
 */
export const OWNING_TEAM_ROLLUP = "owning_team_rollup";

export type InvestmentRollup = {
    readonly subject: ClaimedFact["subject"];
    /** The project's own work units in the window, as served; `null` when not a whole count. */
    readonly ownUnits: number | null;
    /** The work units the roll-up covers, as served; `null` when not a whole count. */
    readonly units: number | null;
};

type Counts = Pick<InvestmentRollup, "ownUnits" | "units">;

const count = (value: unknown): number | null =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const INVESTMENT_ROLLUP_COPY = {
    label: "Owning team's roll-up",
    /** The visible label: the roll-up, then the project's own units when served. */
    visible: ({ ownUnits }: Counts): string =>
        ownUnits === null
            ? INVESTMENT_ROLLUP_COPY.label
            : `${INVESTMENT_ROLLUP_COPY.label} · ${String(ownUnits)} own work ${plural(ownUnits, "unit", "units")} in this window`,
    /** The sentence assistive technology reads with the label. */
    aria: ({ ownUnits, units }: Counts): string => {
        const over =
            units === null
                ? ""
                : ` over ${units.toLocaleString("en-US")} work ${plural(units, "unit", "units")}`;
        const own =
            ownUnits === null
                ? ""
                : `: the project has ${ownUnits.toLocaleString("en-US")} work ${plural(ownUnits, "unit", "units")} of its own in this window`;
        return `This investment is the owning team's roll-up${over}, not this project's own work${own}.`;
    },
} as const;

/** The roll-up of one claim, or `null` when the service did not mark it a roll-up. */
export function investmentRollupOf(claim: ClaimedFact): InvestmentRollup | null {
    const mix = claim.investment_mix;
    if (claim.kind !== "investment" || mix?.investment_mix_source !== OWNING_TEAM_ROLLUP) {
        return null;
    }
    return {
        subject: claim.subject,
        ownUnits: count(mix.project_own_work_unit_count),
        units: count(mix.work_unit_count),
    };
}

/** One roll-up per subject, in claim order: the first roll-up claim of a subject speaks for it. */
function bySubject(rollups: readonly InvestmentRollup[]): InvestmentRollup[] {
    const seen = new Set<string>();
    return rollups.filter((rollup) => {
        const key = rollup.subject.canonical_id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** The roll-ups among the claims `ids` cite (a driver's `claimed_fact_ids`), in citation order, one per subject. */
export function rollupsOfClaims(
    claims: readonly ClaimedFact[],
    ids: readonly string[],
): InvestmentRollup[] {
    const byId = new Map(claims.map((claim) => [claim.claim_id, claim]));
    return bySubject(
        ids
            .map((id) => byId.get(id))
            .filter((claim): claim is ClaimedFact => claim !== undefined)
            .map(investmentRollupOf)
            .filter((rollup): rollup is InvestmentRollup => rollup !== null),
    );
}

/** The roll-up of a subject (a ranked member) among the answer's claims, or `null`. */
export function rollupForSubject(
    claims: readonly ClaimedFact[],
    canonicalId: string,
): InvestmentRollup | null {
    for (const claim of claims) {
        if (claim.subject.canonical_id !== canonicalId) continue;
        const rollup = investmentRollupOf(claim);
        if (rollup !== null) return rollup;
    }
    return null;
}
