import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The workbench is a static, read-only client. It has no server runtime, so
// every deployment knob is a build-time VITE_* value (see .env.example) and no
// endpoint is hardcoded here.
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(import.meta.dirname, "./src"),
        },
    },
    server: {
        host: "127.0.0.1",
        port: 5180,
    },
    preview: {
        host: "127.0.0.1",
        port: 5180,
    },
});
