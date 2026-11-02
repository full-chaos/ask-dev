import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import v2Result from "@/contracts/examples/context_fabric_investigation_result.v2.json";
import v1Result from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import { StructureNeedsPanel } from "@/components/StructureNeedsPanel";
import { resultOutcome } from "@/lib/acr/investigate";
import { validateContract } from "@/lib/acr/validate";
import type { InvestigationResult } from "@/lib/contracts";
import { EMPTY_STRUCTURE_SELECTION_BATCH } from "@/lib/structure-selections";

// CHAOS-11906. `v2Result` is acr's own v2 golden (vendored byte-for-byte from the
// pinned commit; digest-checked by `pnpm acr:contracts:check`), not hand-authored.

function violationOf(outcome: ReturnType<typeof resultOutcome>) {
    if (outcome.kind === "failed") return outcome.failure;
    throw new Error("expected acr_contract_violation, but the call answered");
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("investigation result v2 dispatch", () => {
    it("the v2 golden validates against the v2 schema, and the v1 golden against v1", () => {
        expect(
            validateContract("context_fabric_investigation_result.v2.schema.json", v2Result),
        ).toEqual({ valid: true, errors: [] });
        expect(
            validateContract("context_fabric_investigation_result.v1.schema.json", v1Result).valid,
        ).toBe(true);
    });

    it("schemas are version-exclusive: each golden fails the other version's schema", () => {
        expect(
            validateContract("context_fabric_investigation_result.v1.schema.json", v2Result).valid,
        ).toBe(false);
        expect(
            validateContract("context_fabric_investigation_result.v2.schema.json", v1Result).valid,
        ).toBe(false);
    });

    it("resultOutcome serves a v2 result unchanged (was acr_contract_violation under the v1-only dispatch)", () => {
        expect(resultOutcome(v2Result)).toEqual({ kind: "answered", result: v2Result });
    });

    it("resultOutcome still serves v1 unchanged", () => {
        expect(resultOutcome(v1Result)).toEqual({ kind: "answered", result: v1Result });
    });

    it("rejects a v2 body that is not v2-valid (version label alone does not buy acceptance)", () => {
        const failure = violationOf(resultOutcome({ ...v2Result, unexpected_field: true }));
        expect(failure.code).toBe("acr_contract_violation");
    });

    it("rejects an unknown schema_version and a missing one, loudly", () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const v3 = { ...v2Result, schema_version: "context_fabric_investigation_result.v3" };
        expect(violationOf(resultOutcome(v3)).code).toBe("acr_contract_violation");
        const { schema_version: _drop, ...noVersion } = v2Result;
        expect(violationOf(resultOutcome(noVersion)).code).toBe("acr_contract_violation");
        expect(logged).toHaveBeenCalledTimes(2);
    });

    it("renders the v2 result's membership-verify anchor offers", () => {
        const result = v2Result as unknown as InvestigationResult;
        render(
            <StructureNeedsPanel
                batch={EMPTY_STRUCTURE_SELECTION_BATCH}
                onReject={vi.fn()}
                onToggle={vi.fn()}
                resultId={result.result_id}
                structureNeeds={result.structure_needs!}
            />,
        );
        expect(screen.getByText("repoA")).toBeTruthy();
        expect(screen.getByText("repoB")).toBeTruthy();
    });
});
