import { defineConfig } from "@playwright/test";

const isCI = process.env["CI"] === "true" || process.env["CI"] === "1";
const port = Number(process.env["PLAYWRIGHT_WEB_PORT"] ?? "3021");
const baseURL = process.env["PLAYWRIGHT_BASE_URL"] ?? `http://127.0.0.1:${port}`;
const resultsDirectory = process.env["PLAYWRIGHT_RESULTS_DIR"] ?? "test-results/playwright";

// Two app instances stand in front of a fake (but real, wire-level) ACR: see
// tests/support/fake-acr-server.mjs's own header for why this exists rather than mocking inside the
// browser or the app. Both serve the SAME production build (`next start` only reads `.next`).
// CHAOS-12106: the app is a browser OAuth client of ACR, so the browser talks to the fake ACR
// directly: sign-in (the redirect to its /authorize and back), then the event stream.
//
// - The default instance (`baseURL`) is a user ACR refuses: the fake answers its investigations
//   with 403, so a failure must present as a failure, never as a thin answer.
// - The configured instance answers: it exists so the chat surface's clarification-chip,
//   structure-needs-chip, mixed-receipt-family, conversation-threading, and same-conversation-carry
//   (CHAOS-5837) coverage can drive real, schema-valid responses.
//
// `NEXT_PUBLIC_ACR_OAUTH_ISSUER` is inlined by `next build`, so only the build's value counts:
// ci/run_checks.sh builds with it pointing at the fake ACR's port. It is also set on the servers
// below so the intent reads here; `next start` ignores it.
const fakeAcrPort = Number(process.env["FAKE_ACR_PORT"] ?? "4021");
const fakeAcrOrigin = `http://127.0.0.1:${fakeAcrPort}`;
// The origin the fake ACR refuses: the default instance.
const refusedOrigin = new URL(baseURL).origin;
const configuredPort = Number(process.env["PLAYWRIGHT_CONFIGURED_WEB_PORT"] ?? "3022");
export const configuredBaseURL =
    process.env["PLAYWRIGHT_CONFIGURED_BASE_URL"] ?? `http://127.0.0.1:${configuredPort}`;

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
        // The default instance: a user the fake ACR refuses.
        {
            command: `pnpm exec next start --hostname 127.0.0.1 --port ${port}`,
            url: baseURL,
            reuseExistingServer: false,
            timeout: 120_000,
            env: { NEXT_PUBLIC_ACR_OAUTH_ISSUER: fakeAcrOrigin },
        },
        // The fake-ACR double, started with the app instances: it serves the OAuth endpoints and
        // the event stream, and refuses the default instance's origin.
        {
            command: `node tests/support/fake-acr-server.mjs`,
            url: fakeAcrOrigin,
            env: { FAKE_ACR_PORT: String(fakeAcrPort), FAKE_ACR_REFUSED_ORIGIN: refusedOrigin },
            reuseExistingServer: false,
            timeout: 30_000,
        },
        // A second next-start instance, whose origin the fake ACR answers. Only the
        // `tests/chat.spec.ts` describe blocks that opt in via
        // `test.use({ baseURL: configuredBaseURL })` point here.
        {
            command: `pnpm exec next start --hostname 127.0.0.1 --port ${configuredPort}`,
            url: configuredBaseURL,
            reuseExistingServer: false,
            timeout: 120_000,
            env: { NEXT_PUBLIC_ACR_OAUTH_ISSUER: fakeAcrOrigin },
        },
    ],
});
