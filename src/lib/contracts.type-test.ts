/**
 * CHAOS-12375: what `tsc --noEmit` must refuse. Never run; `pnpm typecheck`
 * reads it, and a `@ts-expect-error` that stops being needed fails that step
 * with TS2578.
 *
 * The acr v2 result schema requires `structure_needs`, and `StructureNeedsV2`
 * requires a non-empty `anchor_options` (acr #1836, CHAOS-12073). `.v1` keeps
 * both optional.
 */
import type {
    InvestigationResult,
    InvestigationResultV1,
    InvestigationResultV2,
    StructureNeeds,
} from "./contracts";

const V1 = "context_fabric_investigation_result.v1";
const V2 = "context_fabric_investigation_result.v2";

export function v2WithoutStructureNeeds(result: InvestigationResultV2): InvestigationResult {
    const { structure_needs: _dropped, ...rest } = result;
    // @ts-expect-error a v2 result requires `structure_needs`.
    return { ...rest, schema_version: V2 };
}

export function v2WithoutAnchorOptions(
    result: InvestigationResultV2,
    structureNeeds: Omit<StructureNeeds, "anchor_options">,
): InvestigationResult {
    // @ts-expect-error a v2 `structure_needs` requires `anchor_options`.
    return { ...result, schema_version: V2, structure_needs: structureNeeds };
}

export function v2WithEmptyAnchorOptions(
    result: InvestigationResultV2,
    structureNeeds: StructureNeeds,
): InvestigationResult {
    // @ts-expect-error a v2 `anchor_options` has at least one entry.
    return { ...result, structure_needs: { ...structureNeeds, anchor_options: [] } };
}

/** The same shapes stay legal on v1, which keeps both fields optional. */
export function v1MayOmitBoth(result: InvestigationResultV1): InvestigationResult {
    const { structure_needs: _dropped, ...rest } = result;
    return { ...rest, schema_version: V1 };
}
