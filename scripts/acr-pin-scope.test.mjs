import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { touchesPin } from "./acr-pin-scope.mjs";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./acr-pin-scope.mjs");
const cli = (stdin) => spawnSync("node", [SCRIPT], { input: stdin, encoding: "utf8" });

describe("touchesPin", () => {
    it("enforces when a vendored contract file changes", () => {
        expect(touchesPin(["README.md", "src/contracts/manifest.json"])).toBe(true);
        expect(touchesPin(["src/contracts/schemas/a.v1.schema.json"])).toBe(true);
    });
    it("enforces when the generator changes", () => {
        expect(touchesPin(["scripts/sync-acr-contracts.mjs"])).toBe(true);
        expect(touchesPin(["scripts/acr-contract-helper.mjs"])).toBe(true);
    });
    it("does not enforce for a render path or the drift tooling itself", () => {
        expect(touchesPin(["src/render/Card.tsx", "src/components/A.tsx"])).toBe(false);
        expect(touchesPin(["scripts/check-acr-pin-drift.mjs"])).toBe(false);
        expect(touchesPin(["docs/src/contracts/notes.md", "src/contractsX/a.ts"])).toBe(false);
    });
    it("does not enforce for an empty list", () => {
        expect(touchesPin([])).toBe(false);
    });
});

describe("acr-pin-scope cli", () => {
    it("prints enforce=true for a contract path", () => {
        expect(cli("a.ts\nsrc/contracts/manifest.json\n").stdout).toBe("enforce=true\n");
    });
    it("prints enforce=false for a render path", () => {
        expect(cli("src/render/a.tsx\n").stdout).toBe("enforce=false\n");
    });
    it("prints enforce=false for empty input", () => {
        expect(cli("").stdout).toBe("enforce=false\n");
    });
});
