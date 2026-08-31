import commonSchema from "@/contracts/schemas/context_fabric_common.v1.schema.json";
import { humanizeTerm } from "@/lib/presentation";

/**
 * CHAOS-4673: a user-language mapping layer at the ASK-DEV render boundary.
 *
 * acr's closed vocabularies (fact kinds, scope-expansion outcomes, evidence
 * id prefixes, ...) are STABLE IDENTIFIERS by design (the corpus-boundary
 * rule: acr's contracts stay identifiers, ask-dev owns the user-facing
 * phrasing). Every function here takes one such raw string and returns BOTH
 * a plain-English `sentence`/`label` for the lead surface AND the untouched
 * `raw` value for a collapsed ▸Details — never one without the other, and
 * never the raw value alone on the lead surface.
 *
 * Fail READABLE, never fail LEAKY (the ticket's own words): a raw string
 * this module does not recognize — a future acr vocabulary addition, a
 * fixture stub, a producer this file's author never saw — still gets a
 * generic, honest phrase. It never falls through to rendering the raw
 * identifier as if it were prose. `mapped: false` on the return value is
 * the DELIBERATE signal for that path, not an afterthought: a call site
 * (or a test) can use it to notice a growing pile of unmapped values without
 * a user ever seeing a leaked token.
 *
 * Traced from the real producers in acr (not invented, same discipline
 * `src/test/fixtures/investigations.ts` documents for itself):
 *   - `internal/contextfabric/fact_planner.go` (`prunedReason`/
 *     `unexpandedReason`/`narrowedReason`) — the three
 *     `coverage.sources[].reason` / `coverage.degraded_reasons[]` shapes.
 *   - `internal/contextfabric/fact_registry.go`'s `appendFactCoverage` —
 *     `degraded_reasons[]` entries are `"<fact kind>: " + <reason>`, the
 *     bare `reason` shape prefixed with the fact kind (schema-closed
 *     vocabulary, same one `FactRequirement.kind` declares).
 *   - `internal/contextpacket/source_queries.go` — `evidence_ref_ids` are
 *     `acr:v1:<entity-type>:<id>`, one literal per SQL producer.
 */

export type MappedText = {
    /** Plain-English text, safe for the lead answer surface. */
    readonly sentence: string;
    /** The untouched original string — render ONLY inside a collapsed Details. */
    readonly raw: string;
    /** False when no known vocabulary shape matched — `sentence` is the generic fallback. */
    readonly mapped: boolean;
};

/** The closed FactKind vocabulary, read from the pinned schema (never hand-copied — see outcome.ts's own FACT_KINDS for the same discipline). */
const FACT_KINDS: ReadonlySet<string> = new Set(
    (
        commonSchema as {
            $defs: { FactRequirement: { properties: { kind: { enum?: string[] } } } };
        }
    ).$defs.FactRequirement.properties.kind.enum ?? [],
);

function generic(sentence: string, raw: string): MappedText {
    return { sentence, raw, mapped: false };
}

function known(sentence: string, raw: string): MappedText {
    return { sentence, raw, mapped: true };
}

/** `unexpanded:<outcome>` — the closed `FactScopeExpansionOutcome` gap vocabulary acr can disclose. */
const UNEXPANDED_OUTCOME_SENTENCES: Readonly<Record<string, string>> = {
    policy_unavailable: "no data-sharing policy is configured to reach it from what was resolved",
    attempted_empty: "the search reached it but found nothing linked",
    target_kind_mismatch: "what the search found there doesn't match what was asked about",
    failed: "the search to reach it failed",
    matched_unauthorized: "a match exists there, but this account isn't authorized to see it",
};

/** `basis: <token>` — how the (unauthoritative) link to the evidence was made. */
const BASIS_SENTENCES: Readonly<Record<string, string>> = {
    direct: "a direct link",
    activity_proxy: "recent activity, not a confirmed link",
    attributed_primary_team: "an inferred primary-team attribution",
};

/**
 * Humanizes ONE `coverage.sources[].reason` string, or the `<reasonBody>`
 * half of one `coverage.degraded_reasons[]` entry once its `"<kind>: "`
 * prefix has been split off by `humanizeDegradedReason` below.
 *
 * Classification keys off the reason's OWN prefix token (before the first
 * `:`) — `pruned:subject_kind_unsupported`, `unexpanded:<outcome>`,
 * `narrowed:subject_kind_unsupported` are the three shapes
 * `fact_planner.go` emits today. The parenthetical detail
 * (`origin`/`policy`/`basis`/counts) is read on a best-effort basis: a
 * classified prefix still gets its known sentence even if the detail fails
 * to parse (a producer that reorders or drops a field must not turn a
 * recognized reason into a leaked one) — only the WHOLE string failing to
 * match any known prefix falls through to the fully generic sentence.
 */
export function humanizeReasonBody(raw: string): MappedText {
    const trimmed = raw.trim();
    if (trimmed === "") return generic("No reason was given.", raw);

    if (trimmed.startsWith("pruned:subject_kind_unsupported")) {
        return known("This source doesn't cover the kind of thing being asked about.", raw);
    }

    if (trimmed.startsWith("narrowed:subject_kind_unsupported")) {
        const countMatch = /:\s*(\d+)\s+subject/.exec(trimmed);
        const count = countMatch?.[1];
        return known(
            count === undefined
                ? "Some subjects were skipped because this source doesn't cover their kind."
                : `${count} subject${count === "1" ? "" : "s"} were skipped because this source doesn't cover their kind.`,
            raw,
        );
    }

    const unexpandedMatch = /^unexpanded:([a-z_]+)/.exec(trimmed);
    if (unexpandedMatch !== null && unexpandedMatch[1] !== undefined) {
        const outcome = unexpandedMatch[1];
        const outcomeSentence = UNEXPANDED_OUTCOME_SENTENCES[outcome];
        const basisMatch = /basis:\s*([a-z_]+)/.exec(trimmed);
        const basisToken = basisMatch?.[1];
        const basisSentence = basisToken === undefined ? undefined : BASIS_SENTENCES[basisToken];
        const lead =
            outcomeSentence ?? "this data wasn't reachable from what was resolved for this answer";
        const withBasis =
            basisSentence === undefined
                ? `This source wasn't expanded: ${lead}.`
                : `This source wasn't expanded: ${lead} (the closest link found was ${basisSentence}).`;
        return known(withBasis, raw);
    }

    // The relationship-graph reader (`falkorgraph/reader.go`) emits these
    // FOUR bare, un-kind-prefixed codes straight into `degraded_reasons[]`
    // (no `appendFactCoverage` involved, so no `"<kind>: "` prefix to
    // split off first) — each is a fixed code, optionally with a trailing
    // `:<count>`.
    for (const [prefix, sentence] of GRAPH_READER_REASON_SENTENCES) {
        if (!trimmed.startsWith(prefix)) continue;
        const countMatch = /:(\d+)$/.exec(trimmed);
        const count = countMatch?.[1];
        return known(count === undefined ? sentence(undefined) : sentence(count), raw);
    }

    return generic("This source didn't fully contribute; see details for the reason.", raw);
}

/**
 * `internal/contextfabric/falkorgraph/reader.go`'s own `degradedReasons`
 * vocabulary — checked longest-prefix-first isn't needed here since none of
 * the four codes is a prefix of another. Each entry's sentence function
 * receives the trailing `:<count>` when the raw string carries one.
 */
const GRAPH_READER_REASON_SENTENCES: ReadonlyArray<
    readonly [string, (count: string | undefined) => string]
> = [
    [
        "endpoint_lookup_failed",
        (count) =>
            count === undefined
                ? "Some relationship links in the graph could not be resolved."
                : `${count} relationship link${count === "1" ? "" : "s"} in the graph could not be resolved.`,
    ],
    [
        "exact_name_candidates_truncated",
        () => "More exact-name matches existed than could be shown; the list was cut off.",
    ],
    [
        "cohort_denied_by_authorization",
        (count) =>
            count === undefined
                ? "Some members of this group were left out because this account isn't authorized to see them."
                : `${count} member${count === "1" ? "" : "s"} of this group ${count === "1" ? "was" : "were"} left out because this account isn't authorized to see ${count === "1" ? "it" : "them"}.`,
    ],
    [
        "unknown_relationship_type",
        (count) =>
            count === undefined
                ? "Some relationship edges used a type outside the recognized vocabulary and were dropped."
                : `${count} relationship edge${count === "1" ? "" : "s"} used a type outside the recognized vocabulary and ${count === "1" ? "was" : "were"} dropped.`,
    ],
];

/**
 * Humanizes one `coverage.degraded_reasons[]` entry — `"<fact kind>: "`
 * prefixed onto the same reason-body shape `humanizeReasonBody` reads
 * (`appendFactCoverage`'s own composition). The kind is read against the
 * schema-closed `FactRequirement.kind` vocabulary so an entry that does not
 * start with a real kind (a future producer, a hand-built fixture) still
 * gets a readable sentence rather than a misparsed one.
 */
export function humanizeDegradedReason(raw: string): MappedText {
    const trimmed = raw.trim();
    const sep = trimmed.indexOf(": ");
    // A kind prefix that is not a real, schema-closed FactKind is not a
    // kind prefix at all -- re-parse the WHOLE original string instead of
    // treating an arbitrary substring before the first ": " as the reason
    // body (which would misclassify, e.g., a colon inside an unrecognized
    // shape's own text as this boundary).
    if (sep === -1 || !FACT_KINDS.has(trimmed.slice(0, sep))) return humanizeReasonBody(raw);
    const kind = trimmed.slice(0, sep);
    const body = trimmed.slice(sep + 2);
    const bodyMapped = humanizeReasonBody(body);
    const label = humanizeTerm(kind);
    return {
        sentence: `${label.charAt(0).toUpperCase()}${label.slice(1)}: ${bodyMapped.sentence}`,
        raw,
        mapped: bodyMapped.mapped,
    };
}

/** Known coverage source prefixes (`fact_registry.go`'s `"canonical_fact:" + kind`, the ops facade, and the graph reader — see `outcome.ts`'s own `KNOWN_SOURCES`/prefix list for the same three). */
const SOURCE_PREFIX_LABELS: ReadonlyArray<readonly [string, string]> = [
    ["canonical_fact:", "Canonical"],
    ["dev-health-ops:", "Dev Health"],
];

/**
 * Humanizes one `coverage.sources[].source` name — `canonical_fact:<kind>`,
 * `dev-health-ops:<capability>`, or the fixed `context-fabric:graph` value.
 */
export function humanizeCoverageSourceName(source: string): MappedText {
    if (source === "context-fabric:graph") {
        return known("Relationship graph", source);
    }
    // A distinct, non-degrading source row the graph reader emits ONLY
    // alongside a historical-axis answer (`falkorgraph/reader.go`, "a
    // reader deserves to see [unbounded validity] separately from real
    // degradation") — never `Partial`, so it needs its own name rather
    // than folding into the plain "Relationship graph" row above.
    if (source === "context-fabric:graph-validity-windows") {
        return known("Relationship graph — undated elements", source);
    }
    for (const [prefix, prefixLabel] of SOURCE_PREFIX_LABELS) {
        if (!source.startsWith(prefix)) continue;
        const kind = source.slice(prefix.length);
        // codex round 1, finding 4 (EXECUTED repro): `coverage.sources[].source`
        // is free text on the wire (schema types it as a 1..128 char string,
        // not a closed enum — see `outcome.ts`'s own `boundedCoverageSource`
        // doc comment), so treating ANY non-empty suffix after a recognized
        // PREFIX as "mapped" let an unrecognized/malformed kind (e.g. one
        // that itself embedded another closed-vocabulary prefix) leak onto
        // the always-visible chip via `humanizeTerm`, which only replaces
        // underscores — it does not validate the kind at all. Only a kind
        // this schema actually declares (`FACT_KINDS`, the same allowlist
        // `humanizeDegradedReason` already trusts) counts as mapped now;
        // this mirrors `outcome.ts`'s own `boundedCoverageSource`, which
        // validates the identical two prefixes against the identical set.
        if (!FACT_KINDS.has(kind)) continue;
        return known(`${prefixLabel} — ${humanizeTerm(kind)}`, source);
    }
    return generic("Source", source);
}

/** `acr:v1:<entity-type>:<id...>` entity-type segment -> a human noun (see `internal/contextpacket/source_queries.go`'s producers). */
const EVIDENCE_ENTITY_LABELS: Readonly<Record<string, string>> = {
    commit: "Commit",
    repository: "Repository",
    "work-item": "Work item",
    "work-item-dependency": "Work item dependency",
    "commit-file": "Commit file",
    "pull-request": "Pull request",
    review: "Review",
    ci: "CI run",
    graph: "Relationship",
    "ai-run": "AI workflow run",
    "ai-artifact": "AI artifact",
    "review-outcome": "Review outcome",
    deployment: "Deployment",
    incident: "Incident",
    "deployment-incident": "Deployment/incident link",
    hotspot: "File hotspot",
    complexity: "File complexity",
    team: "Team",
};

/**
 * Humanizes one `evidence_ref_ids[]` entry (`acr:v1:<entity-type>:<id...>`).
 * The raw id always carries the specific identity (a commit hash, a PR
 * number, a team key) that the human label alone cannot — callers render
 * `sentence` inline and `raw` behind Details, never `raw` alone.
 */
export function humanizeEvidenceRefId(refId: string): MappedText {
    const parts = refId.split(":");
    if (parts.length < 4 || parts[0] !== "acr" || parts[1] !== "v1") {
        return generic("Evidence", refId);
    }
    const entityType = parts[2]!;
    const id = parts.slice(3).join(":");
    const label = EVIDENCE_ENTITY_LABELS[entityType];
    if (label === undefined) return generic("Evidence", refId);
    return known(id === "" ? label : `${label}: ${id}`, refId);
}

/**
 * Rewrites the "implementation-state" copy CHAOS-4673 named directly:
 * StructureNeedsPanel's and ClarificationPanel's own text for when the
 * surrounding surface has no `onConfirm` to call — in practice, a frozen
 * (superseded) chat turn, which is rendered read-only by design. Not a
 * vocabulary lookup (this copy is ask-dev's own product text, not raw acr
 * data) — a named export so both call sites say the identical sentence
 * rather than drifting.
 */
export const CANNOT_REASK_HERE_COPY = "These options can't be changed from this earlier message.";

/** Exposed for tests, so the FactKind allowlist's source can be asserted rather than assumed. */
export const factKindVocabulary: ReadonlySet<string> = FACT_KINDS;
