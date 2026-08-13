import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "@": path.resolve(import.meta.dirname, "./src"),
        },
    },
    test: {
        // Playwright specs live in tests/ and must never be collected by Vitest.
        include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.mjs"],
        environment: "jsdom",
        globals: true,
        setupFiles: ["src/test/setup.ts"],
    },
});
