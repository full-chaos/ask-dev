import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(import.meta.dirname, "./src"),
            // `server-only` throws when imported from a client bundle. Under
            // Vitest every module is "server", so it is stubbed rather than
            // letting the import fail the suite.
            "server-only": path.resolve(import.meta.dirname, "./src/test/server-only.ts"),
        },
    },
    test: {
        // Playwright specs live in tests/ and must never be collected here.
        include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.mjs"],
        environment: "jsdom",
        globals: true,
        setupFiles: ["src/test/setup.ts"],
    },
});
