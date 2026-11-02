import { resultOutcome } from "@/lib/acr/investigate";
import type { StandaloneInvestigate } from "@/render/standalone-source";

/**
 * Tests drive the standalone source and the pages through a fake `fetch` that answers the JSON a
 * test wrote: `{ result }` for an answer, `{ failure }` for a failure. These adapt such a fake to
 * the investigation call the source now takes (CHAOS-12106). The fake sees the call's options as
 * the JSON body of one POST, so a test can read what the source asked.
 */
const FAKE_URL = "fake://investigate";

type Reply = { readonly result?: unknown; readonly failure?: unknown };

export function investigateFromFetch(fetchImpl: typeof fetch): StandaloneInvestigate {
    return async (options) => {
        const response = await fetchImpl(FAKE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(options),
        });
        const reply = (await response.json()) as Reply;
        if (reply.failure !== undefined && reply.failure !== null) {
            return {
                kind: "failed",
                failure: reply.failure as Extract<
                    Awaited<ReturnType<StandaloneInvestigate>>,
                    { kind: "failed" }
                >["failure"],
            };
        }
        if (reply.result === undefined || reply.result === null) {
            throw new Error("the fake answered neither a result nor a failure");
        }
        // ACR's bounded form goes through the app's own classifier (CHAOS-12559): it is drawn only
        // when it meets its schema, as on the real stream.
        if (
            (reply.result as { schema_version?: unknown }).schema_version ===
            "context_fabric_answer_projection.v1"
        ) {
            return resultOutcome(reply.result);
        }
        return {
            kind: "answered",
            result: reply.result as Extract<
                Awaited<ReturnType<StandaloneInvestigate>>,
                { kind: "answered" }
            >["result"],
        };
    };
}

/** The same over whatever `fetch` is when the call is made, so a test may stub it later. */
export const investigateFromGlobalFetch: StandaloneInvestigate = (options) =>
    investigateFromFetch((input, init) => fetch(input, init))(options);
