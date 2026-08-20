import { defineConfig } from "@playwright/test";

const isCI = process.env["CI"] === "true" || process.env["CI"] === "1";
const port = Number(process.env["PLAYWRIGHT_WEB_PORT"] ?? "3021");
const baseURL = process.env["PLAYWRIGHT_BASE_URL"] ?? `http://127.0.0.1:${port}`;
const resultsDirectory = process.env["PLAYWRIGHT_RESULTS_DIR"] ?? "test-results/playwright";

// A SECOND app instance, configured with a fake (but real, wire-level) ACR
// standing in behind it — see tests/support/fake-acr-server.mjs's own header
// for why this exists rather than mocking inside the browser or the app.
// Runs against the SAME production build as the unconfigured instance above
// (`next start` only reads `.next`, so two instances on different ports are
// safe); it exists purely so the chat surface's clarification-chip coverage
// can drive a real, schema-valid `clarification_required` response, which
// the unconfigured instance can never produce.
const fakeAcrPort = Number(process.env["FAKE_ACR_PORT"] ?? "4021");
const fakeAcrOrigin = `http://127.0.0.1:${fakeAcrPort}`;
const configuredPort = Number(process.env["PLAYWRIGHT_CONFIGURED_WEB_PORT"] ?? "3022");
export const configuredBaseURL =
    process.env["PLAYWRIGHT_CONFIGURED_BASE_URL"] ?? `http://127.0.0.1:${configuredPort}`;
// Written fresh by tests/support/gen-e2e-key.mjs on every run — never
// committed (test-results/ is gitignored, and *.pem/*.key are too, belt and
// braces). See that script's header for why a throwaway key is safe here.
const e2eSigningKeyPath = `${resultsDirectory}/e2e-acr-key.pem`;

export default defineConfig({
    testDir: "./tests",
    testMatch: /.*\.spec\.ts/,
    outputDir: resultsDirectory,
    fullyParallel: true,
    forbidOnly: isCI,
    retries: isCI ? 2 : 0,
    reporter: [
        ["list"],
        ["html", { outputFolder: "test-results/playwright-html", open: "never" }],
        ["junit", { outputFile: `${resultsDirectory}/junit.xml` }],
    ],
    use: {
        baseURL,
        headless: true,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    webServer: [
        // The suite asserts the shell renders and that a question produces an
        // HONEST failure when the server hop is unconfigured — it never
        // asserts an answer here, because an answer requires the real
        // service and this instance has no mock path. No ACR_* variables are
        // supplied on purpose.
        {
            command: `pnpm exec next start --hostname 127.0.0.1 --port ${port}`,
            url: baseURL,
            reuseExistingServer: false,
            timeout: 120_000,
        },
        // The fake-ACR double, started before the configured app instance so
        // its port is already listening once ACR_API_ORIGIN gets used.
        {
            command: `node tests/support/fake-acr-server.mjs`,
            url: fakeAcrOrigin,
            env: { FAKE_ACR_PORT: String(fakeAcrPort) },
            reuseExistingServer: false,
            timeout: 30_000,
        },
        // A second next-start instance, configured to talk to the fake-ACR
        // double above. Only the chat clarification-chip spec points its
        // baseURL here (via `configuredBaseURL`); every other spec uses the
        // unconfigured instance.
        {
            command: `bash -c "node tests/support/gen-e2e-key.mjs '${e2eSigningKeyPath}' && pnpm exec next start --hostname 127.0.0.1 --port ${configuredPort}"`,
            url: configuredBaseURL,
            reuseExistingServer: false,
            timeout: 120_000,
            env: {
                ACR_API_ORIGIN: fakeAcrOrigin,
                ACR_ORG_ID: "org_e2e",
                ACR_WEB_ASSERTION_KEY_FILE: e2eSigningKeyPath,
                ACR_REPOSITORY_SCOPES: "full-chaos/ask-dev",
            },
        },
    ],
});
