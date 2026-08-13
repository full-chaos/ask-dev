import { defineConfig } from "@playwright/test";

const isCI = process.env["CI"] === "true" || process.env["CI"] === "1";
const port = Number(process.env["PLAYWRIGHT_WEB_PORT"] ?? "3021");
const baseURL = process.env["PLAYWRIGHT_BASE_URL"] ?? `http://127.0.0.1:${port}`;
const resultsDirectory = process.env["PLAYWRIGHT_RESULTS_DIR"] ?? "test-results/playwright";

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
    // The smoke suite runs against the PRODUCTION build, not `next dev`: the CI
    // build stage already produced .next, and a smoke test that only exercised
    // the dev server would not prove the artifact a deploy ships.
    //
    // No ACR_* variables are supplied on purpose. The suite asserts the shell
    // renders and that a question produces an HONEST failure when the server hop
    // is unconfigured — it never asserts an answer, because an answer requires
    // the real service and the Workbench has no mock path.
    webServer: {
        command: `pnpm exec next start --hostname 127.0.0.1 --port ${port}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
