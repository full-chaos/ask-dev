import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/investigations/route";
import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import type { InvestigationResult } from "@/lib/contracts";

/**
 * Review round 2 (P1, P2-b): the route is the boundary. A person cohort's
 * rank/score/drivers are removed there with a typed marker, and the
 * scope-loss notice is built ONCE, here, and returned.
 */
const { privateKey } = generateKeyPairSync("ed25519");
const keyDir = mkdtempSync(path.join(tmpdir(), "acr-web-assertion-key-"));
const keyFile = path.join(keyDir, "key.pem");
writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));

function stubAcr(body: unknown): void {
    vi.stubEnv("ACR_API_ORIGIN", "http://acr.test");
    vi.stubEnv("ACR_ORG_ID", "70d529e0-3c06-4597-8480-794fd02328b6");
    vi.stubEnv("ACR_WEB_ASSERTION_KEY_FILE", keyFile);
    vi.stubEnv("ACR_REPOSITORY_SCOPES", "full.chaos/dev-health-ops");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        }),
    );
    vi.spyOn(console, "info").mockImplementation(() => {});
}

function post(body: unknown): Request {
    return new Request("http://workbench.test/api/investigations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

const base = canonicalResult as unknown as InvestigationResult;
const personResult = {
    ...base,
    interpretation: { ...base.interpretation, shape: "explicit_cohort" },
    cohort: {
        ...base.cohort!,
        kind: "person",
        members: base.cohort!.members.map((m) => ({
            ...m,
            subject: { ...m.subject, kind: "person" },
        })),
    },
};

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe("route boundary", () => {
    it("returns a person cohort with no rank, score or drivers and a typed marker", async () => {
        stubAcr(personResult);
        const response = await POST(post({ question: "who needs attention?" }));
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).not.toContain("attention_rank");
        expect(text).not.toContain('"score"');
        const payload = JSON.parse(text) as { result: { ranking_withheld?: { reason: string } } };
        expect(payload.result.ranking_withheld?.reason).toBe("subject_kind_not_ranked");
    });

    it("leaves a team cohort's ranking untouched", async () => {
        stubAcr(canonicalResult);
        const response = await POST(post({ question: "status?" }));
        const text = await response.text();
        expect(text).toContain("attention_rank");
        expect(JSON.parse(text)).not.toHaveProperty("result.ranking_withheld");
    });

    it("builds the scope-loss notice once, server side, from the unsent subjects", async () => {
        stubAcr(canonicalResult);
        const response = await POST(
            post({
                question: "status?",
                parentResultId: "result_prior",
                unsentSubjects: [{ kind: "new_entity", label: "Alpha" }],
            }),
        );
        const payload = (await response.json()) as { scopeLossNotice?: string };
        expect(payload.scopeLossNotice).toMatch(/does not carry Alpha/);
    });

    it("returns no scope-loss notice when nothing was unsent", async () => {
        stubAcr(canonicalResult);
        const response = await POST(post({ question: "status?" }));
        const payload = (await response.json()) as { scopeLossNotice?: string };
        expect(payload.scopeLossNotice).toBeUndefined();
    });

    it("rejects a malformed unsentSubjects list", async () => {
        const response = await POST(post({ question: "q", unsentSubjects: [{ kind: 1 }] }));
        expect(response.status).toBe(400);
    });
});
