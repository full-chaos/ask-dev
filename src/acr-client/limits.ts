/**
 * The browser ACR transport's limits (CHAOS-12104, T14a; plan §2.7.6, §2.7.7; design amendment §6).
 */

/**
 * ACR's largest answer: the `max_serialized_bytes` maximum of the pinned `InvestigationOptions`
 * (`context_fabric_common.v1`). A test holds it to the pin.
 */
export const ACR_MAX_SERIALIZED_BYTES = 1_048_576;

/** Largest single event the browser parses: ACR's largest answer plus 64 KiB (plan §2.7.7). */
export const MAX_EVENT_BYTES = ACR_MAX_SERIALIZED_BYTES + 64 * 1_024;

/** Largest stream the browser reads, in wire bytes, before it ends the run (plan §2.7.7). */
export const MAX_STREAM_BYTES = 8 * 1_024 * 1_024;

/** Largest JSON body (status, replay, refusal) the browser reads: an answer plus 64 KiB. */
export const MAX_BODY_BYTES = MAX_EVENT_BYTES;

/**
 * The longest step between two consecutive `elapsed_ms` values of a stream (`accepted` counting as
 * 0): ACR's heartbeat interval, 10 s, plus its 1 s of slack. The pinned event schema states it; a
 * test holds it there.
 */
export const ACR_MAX_SILENCE_MS = 11_000;

/** The client version ACR requires on every protected route (426 without it; design §1.2). */
export const ACR_CLIENT_VERSION = "0.1.0";
