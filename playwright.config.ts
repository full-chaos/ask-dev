import { defineConfig } from "@playwright/test";

const isCI = process.env["CI"] === "true" || process.env["CI"] === "1";
const port = Number(process.env["PLAYWRIGHT_WEB_PORT"] ?? "5181");
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
    // The smoke suite runs against the PRODUCTION build, not the dev server:
    // the CI build stage already produced dist/, and a smoke test that only
    // ever exercises `vite dev` would not prove the artifact CI ships works.
    webServer: {
        command: `pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 60_000,
    },
});
