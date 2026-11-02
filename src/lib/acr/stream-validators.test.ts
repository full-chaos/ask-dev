import { describe, expect, it } from "vitest";

import accepted from "@/contracts/examples/context_fabric_investigation_event_accepted.v1.json";
import errorEvent from "@/contracts/examples/context_fabric_investigation_event_error_budget_refusal.v1.json";
import result from "@/contracts/examples/context_fabric_investigation_event_result.v1.json";
import status from "@/contracts/examples/context_fabric_submission_status.v1.json";
import error from "@/contracts/examples/error_context_fabric_interpretation_rejected.v1.json";

import { loadStreamValidators, streamEnvelopeValidators } from "./stream-validators";

/** CHAOS-12106: the Workbench's stream checks, against ACR's own documents at the pin. */
describe("the stream validators", () => {
    it.each([
        ["accepted", accepted],
        ["result", result],
        ["error", errorEvent],
    ])("pass ACR's %s event", async (_name, event) => {
        const full = await loadStreamValidators();
        expect(streamEnvelopeValidators.validateInvestigationEventEnvelope(event)).toBe(true);
        expect(full.validateInvestigationEvent(event)).toBe(true);
    });

    it.each([
        ["no type", { ...accepted, type: undefined }],
        ["an unknown type", { ...accepted, type: "other" }],
        ["no seq", { ...accepted, seq: undefined }],
    ])("refuse an event with %s", async (_name, event) => {
        const full = await loadStreamValidators();
        expect(streamEnvelopeValidators.validateInvestigationEventEnvelope(event)).toBe(false);
        expect(full.validateInvestigationEvent(event)).toBe(false);
    });

    it("read ACR's submission status, and refuse a broken one", () => {
        expect(streamEnvelopeValidators.validateSubmissionStatus(status)).toBe(true);
        expect(streamEnvelopeValidators.validateSubmissionStatus({ ...status, state: 7 })).toBe(
            false,
        );
    });

    it("read ACR's error, and refuse a broken one", () => {
        expect(streamEnvelopeValidators.validateErrorEnvelope(error)).toBe(true);
        expect(streamEnvelopeValidators.validateErrorEnvelope({ ...error, error: {} })).toBe(false);
    });

    it("read the result form the stream carries, and refuse a broken one", async () => {
        const full = await loadStreamValidators();
        const form = (result as { result: Record<string, unknown> }).result;
        expect(full.validateInvestigationResultV1(form)).toBe(true);
        expect(full.validateInvestigationResultV1({ ...form, status: 7 })).toBe(false);
    });
});
