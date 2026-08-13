/**
 * Build-time configuration. Values only — no endpoint is hardcoded and no
 * secret belongs here or in any committed .env. See .env.example.
 *
 * CHAOS-3803 scaffold: the workbench runs on mock fixtures until the live
 * Context Fabric wiring lands, so `apiBaseUrl` is read but not yet used.
 */
export type WorkbenchConfig = {
    /** Base URL of the ACR Context Fabric investigation API, when one is configured. */
    readonly apiBaseUrl: string | undefined;
    /** True while the workbench answers from committed mock fixtures. */
    readonly useMockFixtures: boolean;
};

function readEnvironment(key: string): string | undefined {
    // `import.meta.env` is typed as an index signature of `any`; narrow it to
    // `unknown` first so a missing or non-string value cannot flow onward
    // untyped.
    const environment = import.meta.env as Record<string, unknown>;
    const value: unknown = environment[key];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function loadConfig(): WorkbenchConfig {
    const apiBaseUrl = readEnvironment("VITE_ASK_DEV_API_BASE_URL");
    return {
        apiBaseUrl,
        // Mocks stay on until an API base URL is configured AND the flag is
        // explicitly turned off, so a missing value can never silently point
        // the workbench at nothing.
        useMockFixtures:
            apiBaseUrl === undefined || readEnvironment("VITE_ASK_DEV_USE_MOCKS") !== "false",
    };
}
