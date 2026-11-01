import { Details } from "./Details";
import { EvidenceReferences } from "./EvidenceReferences";
import { SafeAnswerText } from "./SafeAnswerText";
import { askedForCohort, cohortRanking, isRankableSubjectKind } from "../lib/cohort-ranking";
import type { EvidenceRefLabels, InvestigationResult, RelationshipPath } from "../lib/contracts";
import { humanizeTerm } from "../lib/presentation";

/** Check 7: an edge establishes relevance, not cause. Said wherever a path is shown. */
const NOT_CAUSE = "A path shows how these are linked. It does not show cause.";

/**
 * An edge's word. ACR serves no label for an edge type, so this is the generic path, always inside
 * a fold (CHAOS-4690): no consumer table over the vocabulary.
 */
function edgeWord(type: string): string {
    return humanizeTerm(type.toLowerCase());
}

/**
 * A path may name only a kind the render may list: the closed allowlist the ranking uses, so
 * `person` and any kind no pin documents fail closed. The result boundary reads the cohort only, so
 * a person who stands on a path alone would pass it (AGENTS.md: no person ranking or listing here).
 */
function isDrawable(path: RelationshipPath): boolean {
    return [...path.nodes, ...path.edges.flatMap((edge) => [edge.from, edge.to])].every((subject) =>
        isRankableSubjectKind(subject.kind),
    );
}

function PathList({
    paths,
    evidenceRefLabels,
}: {
    readonly paths: readonly RelationshipPath[];
    readonly evidenceRefLabels: EvidenceRefLabels;
}) {
    const drawn = paths.filter(isDrawable);
    const leftOut = paths.length - drawn.length;
    return (
        <>
            {drawn.length === 0 ? null : <p className="record__meta">{NOT_CAUSE}</p>}
            <ul className="stack stack--tight">
                {drawn.map((path, index) => (
                    // Index key: a driver may cite a path twice, and this list is never reordered.
                    <li data-testid="relationship-path" key={index}>
                        <p className="record__meta">
                            <SafeAnswerText text={path.why_relevant} />
                        </p>
                        <ol className="stack stack--tight">
                            {path.edges.map((edge, hop) => (
                                <li className="record__meta" data-testid="path-hop" key={hop}>
                                    {edge.from.label} — {edgeWord(edge.type)} → {edge.to.label} ·{" "}
                                    {humanizeTerm(edge.epistemic_status)} ·{" "}
                                    {humanizeTerm(edge.derivation)}
                                </li>
                            ))}
                        </ol>
                        {path.truncated ? (
                            <p className="record__meta">
                                This path is cut: the service sent only part of it.
                            </p>
                        ) : null}
                        <EvidenceReferences
                            evidenceRefIds={path.evidence_ref_ids}
                            evidenceRefLabels={evidenceRefLabels}
                            label="Evidence"
                        />
                    </li>
                ))}
            </ul>
            {leftOut === 0 ? null : (
                <p className="record__meta" data-testid="paths-left-out">
                    {leftOut === 1
                        ? "A path is not shown: it names a subject this view does not list."
                        : `${String(leftOut)} paths are not shown: they name subjects this view does not list.`}
                </p>
            )}
        </>
    );
}

/**
 * The paths a driver cites, for its Details fold. An id that names no path shows nothing. A path's
 * evidence refs open like any other: they are in ACR's citing closure.
 */
export function DriverPaths({
    pathIds,
    paths,
    evidenceRefLabels,
}: {
    readonly pathIds: readonly string[] | undefined;
    readonly paths: readonly RelationshipPath[];
    readonly evidenceRefLabels: EvidenceRefLabels;
}) {
    const cited = paths.filter((path) => pathIds?.includes(path.path_id));
    if (cited.length === 0) return null;
    return (
        <>
            <p className="record__meta">Why this is relevant</p>
            <PathList evidenceRefLabels={evidenceRefLabels} paths={cited} />
        </>
    );
}

/**
 * The paths no driver cites, in one collapsed panel. Drivers withheld for the cohort's kind take
 * their paths with them: both would name what "Ranking not shown" declined to show. A withheld
 * result has no paths: the boundary empties them.
 */
export function OtherPathsPanel({ result }: { readonly result: InvestigationResult }) {
    const { state } = cohortRanking(
        askedForCohort(result.interpretation.shape, result),
        result.cohort,
    );
    const citedIds = new Set(result.drivers.flatMap((driver) => driver.path_ids ?? []));
    const others = result.paths.filter((path) => !citedIds.has(path.path_id));
    if (state === "kind_not_ranked" || others.length === 0) return null;
    return (
        <section className="panel" data-testid="relationship-paths-panel">
            <Details summary="Other related paths">
                <PathList evidenceRefLabels={result.evidence_ref_labels} paths={others} />
            </Details>
        </section>
    );
}
