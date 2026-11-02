import { describe, expect, it } from "vitest";

import commonSchema from "../../contracts/schemas/context_fabric_common.v1.schema.json";
import eventSchema from "../../contracts/schemas/context_fabric_investigation_event.v1.schema.json";
import {
    ACR_MAX_SERIALIZED_BYTES,
    ACR_MAX_SILENCE_MS,
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

    // CHAOS-12618: moved from web's duplicate (CHAOS-12613), held to ask-dev's own pinned schema.
    it("silence: the pinned event schema's 11 s between two elapsed_ms values", () => {
        expect((eventSchema as { description: string }).description).toContain(
            "(accepted counting as 0) are more than 11 seconds apart",
        );
        expect(ACR_MAX_SILENCE_MS).toBe(11_000);
    });

    it("in all: 8 MiB of wire bytes (plan §2.7.7)", () => {
        expect(MAX_STREAM_BYTES).toBe(8 * 1_024 * 1_024);
    });
});
