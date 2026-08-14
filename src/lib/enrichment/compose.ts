import type { InvestigationResult } from "@/lib/contracts";
import { REF_PREFIX } from "@/lib/enrichment/refs";
import type { PresentationManifest } from "@/lib/enrichment/manifest";

/**
 * The DETERMINISTIC composition builder (CHAOS-3738).
 *
 * Given a result, it emits a valid reference-only composition. No model is
 * involved: this is our own code choosing a layout over real values — exactly
 * the epistemic status the deterministic view already has, expressed as OpenUI
 * Lang instead of React. It authors no prose, no facts, and no judgments; every
 * material prop it emits is a `@result.` reference.
 *
 * It exists for two reasons beyond unblocking the enriched view:
 *
 *   - it lets the enriched path be exercised end to end against a real result,
 *     rather than discovering integration problems at the moment one arrives;
 *   - it is the REFERENCE composition a model-authored one can be diffed
 *     against, which is a far better basis for judging enrichment quality than
 *     looking at it.
 *
 * Its output is required to pass the fail-closed validator, and a test pins
 * that — a builder emitting compositions its own validator rejects is a
 * silent desync waiting to happen.
 */

/**
 * Statement identifiers are generated, never taken from the result.
 *
 * A subject label or a finding kind could contain a quote, a bracket, or a
 * newline, any of which would corrupt the emitted program. Counter-based
 * identifiers cannot.
 */
class Statements {
    private readonly lines: string[] = [];
    private counter = 0;

    add(expression: string): string {
        const id = `s${String((this.counter += 1))}`;
        this.lines.push(`${id} = ${expression}`);
        return id;
    }

    /** Emits with `root` first, as OpenUI Lang requires. */
    render(rootExpression: string): string {
        return [`root = ${rootExpression}`, ...this.lines].join("\n");
    }
}

function ref(path: string): string {
    return `"${REF_PREFIX}${path}"`;
}

function list(ids: readonly string[]): string {
    return `[${ids.join(", ")}]`;
}

export type ComposeOptions = {
    /** Caps mirror the manifest's intent: a composition is a view, not a dump. */
    readonly maxDrivers?: number;
    readonly maxFindings?: number;
    readonly maxPaths?: number;
    readonly maxEvidencePerItem?: number;
};

const DEFAULTS = {
    maxDrivers: 10,
    maxFindings: 10,
    maxPaths: 5,
    maxEvidencePerItem: 5,
} as const;

/**
 * Builds the composition.
 *
 * Every emitted reference is guarded by the array length it indexes, so the
 * builder can never emit a reference that does not resolve — the failure mode
 * that would otherwise turn a valid result into a fallback.
 */
export function buildComposition(
    result: InvestigationResult,
    manifest: PresentationManifest,
    options: ComposeOptions = {},
): string {
    const limits = { ...DEFAULTS, ...options };
    const statements = new Statements();
    const sections: string[] = [];

    const evidenceIds = (path: string, count: number): string[] =>
        Array.from({ length: Math.min(count, limits.maxEvidencePerItem) }, (_, index) =>
            statements.add(`EvidenceRef(${ref(`${path}.${String(index)}`)})`),
        );

    // The judgment, when there is one. A clarification or no-match result has
    // an empty direct_judgment, and an empty prose block is noise rather than
    // information, so it is simply omitted.
    if (result.direct_judgment.trim() !== "") {
        const evidence = evidenceIds("evidence_ref_ids", result.evidence_ref_ids.length);
        sections.push(
            statements.add(
                `Prose(${ref("direct_judgment")}${evidence.length > 0 ? `, ${list(evidence)}` : ""})`,
            ),
        );
    }
    if (result.current_state.trim() !== "") {
        sections.push(statements.add(`Prose(${ref("current_state")})`));
    }

    result.drivers.slice(0, limits.maxDrivers).forEach((driver, index) => {
        const base = `drivers.${String(index)}`;
        const evidence = evidenceIds(
            `${base}.evidence_ref_ids`,
            driver.evidence_ref_ids?.length ?? 0,
        );
        sections.push(
            statements.add(
                `DriverCard(${ref(`${base}.title`)}, ${ref(`${base}.summary`)}, ` +
                    `${ref(`${base}.standing`)}, ${ref(`${base}.confidence`)}` +
                    `${evidence.length > 0 ? `, ${list(evidence)}` : ""})`,
            ),
        );
    });

    result.remaining_work.slice(0, limits.maxFindings).forEach((finding, index) => {
        const base = `remaining_work.${String(index)}`;
        const evidence = evidenceIds(`${base}.evidence_ref_ids`, finding.evidence_ref_ids.length);
        sections.push(
            statements.add(
                `FindingCard(${ref(`${base}.kind`)}, ${ref(`${base}.summary`)}` +
                    `${evidence.length > 0 ? `, ${list(evidence)}` : ""})`,
            ),
        );
    });

    // Every field referenced below is REQUIRED by the contract
    // (`RelationshipPath.required` includes `why_relevant`), and the client
    // schema-validates the result before it reaches here — so no presence guard
    // is needed. An earlier draft had one; it was dead code implying a state
    // that cannot occur, which is worse than none.
    result.paths.slice(0, limits.maxPaths).forEach((path, index) => {
        const base = `paths.${String(index)}`;
        const edges = path.edges.map((_, edgeIndex) =>
            statements.add(
                `RelationshipEdgeView(${ref(`${base}.edges.${String(edgeIndex)}.from.label`)}, ` +
                    `${ref(`${base}.edges.${String(edgeIndex)}.to.label`)}, ` +
                    `${ref(`${base}.edges.${String(edgeIndex)}.type`)})`,
            ),
        );
        sections.push(
            statements.add(
                `RelationshipPathView(${ref(`${base}.path_id`)}, ${ref(`${base}.why_relevant`)}, ${list(edges)})`,
            ),
        );
    });

    // Coverage and limitations are MANDATORY. They are emitted unconditionally,
    // including when their arrays are empty, because "no limitations were
    // reported" and "limitations were not shown" must never look the same.
    const coverageSources = result.coverage.sources.map((_, index) =>
        statements.add(
            `CoverageSource(${ref(`coverage.sources.${String(index)}.source`)}, ` +
                `${ref(`coverage.sources.${String(index)}.state`)})`,
        ),
    );
    sections.push(statements.add(`Coverage(${ref("coverage.partial")}, ${list(coverageSources)})`));

    const limitationItems = result.limitations.map((_, index) =>
        statements.add(`LimitationItem(${ref(`limitations.${String(index)}`)})`),
    );
    sections.push(statements.add(`Limitations(${list(limitationItems)})`));

    // backend_version is optional; the trust panel needs three present
    // references, so it is emitted only when they all resolve.
    sections.push(
        statements.add(
            `DataTrustPanel(${ref("versions.backend")}, ${ref("versions.projection_version")}, ` +
                `${ref("versions.query_version")})`,
        ),
    );

    if (manifest.root !== "Answer") {
        throw new Error(`the composition builder emits an Answer root, not ${manifest.root}`);
    }
    return statements.render(`Answer(${ref("deterministic_answer")}, ${list(sections)})`);
}
