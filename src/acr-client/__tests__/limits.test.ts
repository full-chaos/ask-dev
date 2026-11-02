import { describe, expect, it } from "vitest";

import commonSchema from "../../contracts/schemas/context_fabric_common.v1.schema.json";
import {
    ACR_MAX_SERIALIZED_BYTES,
    MAX_BODY_BYTES,
    MAX_EVENT_BYTES,
    MAX_STREAM_BYTES,
} from "../limits";

/** CHAOS-12104 (T14a; ported from #1608): the caps are held to the pinned contract. */
describe("the transport's caps", () => {
    it("per event: the pinned InvestigationOptions max_serialized_bytes maximum plus 64 KiB", () => {
        const options = (
            commonSchema as {
                $defs: {
                    InvestigationOptions: { properties: Record<string, { maximum?: number }> };
                };
            }
        ).$defs.InvestigationOptions.properties.max_serialized_bytes;
        expect(ACR_MAX_SERIALIZED_BYTES).toBe(options?.maximum);
        expect(MAX_EVENT_BYTES).toBe(options!.maximum! + 64 * 1_024);
        expect(MAX_BODY_BYTES).toBe(MAX_EVENT_BYTES);
    });

    it("in all: 8 MiB of wire bytes (plan §2.7.7)", () => {
        expect(MAX_STREAM_BYTES).toBe(8 * 1_024 * 1_024);
    });
});
