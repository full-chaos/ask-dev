import { generateKeyPairSync } from "node:crypto";

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import v2Result from "@/contracts/examples/context_fabric_investigation_result.v2.json";
import v1Result from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import { StructureNeedsPanel } from "@/components/StructureNeedsPanel";
import { investigate } from "@/lib/acr/client";
import type { AcrRuntimeConfig } from "@/lib/acr/config";
import { AcrRequestError } from "@/lib/acr/errors";
import { validateContract } from "@/lib/acr/validate";
import type { InvestigationResult } from "@/lib/contracts";
import { EMPTY_STRUCTURE_SELECTION_BATCH } from "@/lib/structure-selections";

// CHAOS-11906. `v2Result` is acr's own v2 golden (vendored byte-for-byte from the
// pinned commit; digest-checked by `pnpm acr:contracts:check`), not hand-authored.

const { privateKey } = generateKeyPairSync("ed25519");
const config: AcrRuntimeConfig = {
    apiOrigin: "http://acr.test",
    audience: "dev-health-acr",
    issuer: "dev-health-web",
    keyId: "acr-dev-web",
    orgId: "70d529e0-3c06-4597-8480-794fd02328b6",
    privateKey,
    repositoryScopes: ["full.chaos/dev-health-ops"],
    subject: "context-fabric-workbench",
    timeoutMs: 5_000,
};

function respondWith(body: unknown, status = 200): void {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
        }),
    );
}

async function violationOf(call: Promise<unknown>) {
    try {
        await call;
    } catch (error) {
        if (error instanceof AcrRequestError) return error.failure;
        throw error;
    }
    throw new Error("expected acr_contract_violation, but the call resolved");
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("investigation result v2 dispatch", () => {
    it("the v2 golden validates against the v2 schema, and the v1 golden against v1", () => {
        expect(validateContract("context_fabric_investigation_result.v2.schema.json", v2Result)).toEqual({ valid: true, errors: [] });
        expect(validateContract("context_fabric_investigation_result.v1.schema.json", v1Result).valid).toBe(true);
    });

    it("schemas are version-exclusive: each golden fails the other version's schema", () => {
        expect(validateContract("context_fabric_investigation_result.v1.schema.json", v2Result).valid).toBe(false);
        expect(validateContract("context_fabric_investigation_result.v2.schema.json", v1Result).valid).toBe(false);
    });

    it("investigate serves a v2 result unchanged (was acr_contract_violation under the v1-only dispatch)", async () => {
        respondWith(v2Result);
        await expect(investigate(config, { question: "Is widget-service healthy?" })).resolves.toEqual(v2Result);
    });

    it("investigate still serves v1 unchanged", async () => {
        respondWith(v1Result);
        await expect(investigate(config, { question: "status?" })).resolves.toEqual(v1Result);
    });

    it("rejects a v2 body that is not v2-valid (version label alone does not buy acceptance)", async () => {
        respondWith({ ...v2Result, unexpected_field: true });
        const failure = await violationOf(investigate(config, { question: "q" }));
        expect(failure.code).toBe("acr_contract_violation");
    });

    it("rejects an unknown schema_version and a missing one, loudly", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
        respondWith({ ...v2Result, schema_version: "context_fabric_investigation_result.v3" });
        expect((await violationOf(investigate(config, { question: "q" }))).code).toBe("acr_contract_violation");
        const { schema_version: _drop, ...noVersion } = v2Result;
        respondWith(noVersion);
        expect((await violationOf(investigate(config, { question: "q" }))).code).toBe("acr_contract_violation");
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
