import { describe, expect, it } from "vitest";

import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import type { InvestigationResult } from "@/lib/contracts";
import { buildOutcomeEvent } from "@/lib/telemetry/outcome";

const base = canonicalResult as unknown as InvestigationResult;
const LEAK = "jane.doe@example.com";

describe("P1-2: open vocabulary values never leave the process raw", () => {
    it("sends other for unknown shape, status, candidate state, subject kind and coverage state", () => {
        const dirty = {
            ...base,
            status: LEAK,
            interpretation: { ...base.interpretation, shape: LEAK },
            subject_resolution: {
                ...base.subject_resolution,
                committed: base.subject_resolution.committed.map((s) => ({ ...s, kind: LEAK })),
                candidates: base.subject_resolution.candidates.map((c) => ({
                    ...c,
                    state: LEAK,
                })),
            },
            coverage: {
                ...base.coverage,
                sources: base.coverage.sources.map((s) => ({ ...s, state: LEAK })),
            },
        } as unknown as InvestigationResult;
        const event = buildOutcomeEvent({ result: dirty, latencyMs: 1 } as never);
        expect(JSON.stringify(event)).not.toContain(LEAK);
        expect(event.questionShape).toBe("other");
        expect(event.committedSubjectKinds).toContain("other");
    });
});
