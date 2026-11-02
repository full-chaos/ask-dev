/**
 * The ACR browser client (CHAOS-12540; T18): one copy, and every host imports it. It holds the
 * OAuth token store, the event stream checks and the calls. A host gives it what only the host has:
 * its session read and routes (`configureAcrAuth`), a log sink (`setAcrLogger`), and its validators
 * and result reading (`createAcrCalls`).
 *
 * `./config` is a subpath of its own, so that a host's server code can read it without this entry.
 */
export * from "./auth";
export * from "./config";
export * from "./deadline";
export * from "./eventGate";
export * from "./limits";
export { logger as acrLogger, setAcrLogger, type AcrLogFields, type AcrLogger } from "./logger";
export * from "./sseParser";
export * from "./transport";
export * from "./types";
