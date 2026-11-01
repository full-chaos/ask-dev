import { describe, expect, it } from "vitest";

import { validateContract } from "@/lib/acr/validate";
import { servedWordScenarios } from "@/test/fixtures/served-words";

// The fixtures are ACR's real encoder output, so ACR's schema must accept each one as it stands.
describe("the served word fixtures", () => {
    it.each(Object.entries(servedWordScenarios))("%s passes its own schema", (_name, result) => {
        const schema = `${result.schema_version}.schema.json` as const;
        expect(validateContract(schema, result).errors).toEqual([]);
    });

    it("carries every vocabulary the design's table names", () => {
        const keys = Object.values(servedWordScenarios).flatMap((result) =>
            Object.keys(result.vocabulary_labels ?? {}),
        );
        const vocabularies = new Set(keys.map((key) => key.split(":")[0]));
        expect([...vocabularies].sort()).toEqual(
            [
                "answer_status",
                "candidate_state",
                "driver_standing",
                "driver_window",
                "fact_kind",
                "member_outcome",
                "prior_receipt_disposition",
                "ranking_signal",
                "requirement_outcome",
                "status_correction",
                "structure_disposition",
                "subject_kind",
                "subject_kind_plural",
                "threshold_label",
                "window_provenance",
                "window_relative_id",
            ].sort(),
        );
    });
});
