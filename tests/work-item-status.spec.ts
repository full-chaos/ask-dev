import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { readFileSync } from "node:fs";

import type { InvestigationResult } from "../src/lib/contracts";

const PRODUCER_FIXTURE = "tests/fixtures/work-item-status-result.json";
const WORK_ITEM_ZERO = "work_item.v2:repo-1:work-00";
const WORK_ITEM_MISSING = "work_item.v2:repo-1:work-01";

function loadProducerResult(): InvestigationResult {
    return JSON.parse(readFileSync(PRODUCER_FIXTURE, "utf8")) as InvestigationResult;
}

function resultWithStatus(result: InvestigationResult, canonicalId: string, value: string) {
    const controlled = structuredClone(result);
    const fact = controlled.claimed_facts.find(
        (candidate) =>
            candidate.kind === "status" &&
            candidate.subject.kind === "work_item" &&
            candidate.subject.canonical_id === canonicalId,
    );
    if (fact === undefined) throw new Error(`missing status fact for ${canonicalId}`);
    fact.value = { string: value };
    return controlled;
}

function resultWithoutStatus(result: InvestigationResult, canonicalId: string) {
    const controlled = structuredClone(result);
    controlled.claimed_facts = controlled.claimed_facts.filter(
        (candidate) =>
            candidate.kind !== "status" ||
            candidate.subject.kind !== "work_item" ||
            candidate.subject.canonical_id !== canonicalId,
    );
    return controlled;
}

async function openResult(page: Page, result: InvestigationResult, width: number) {
    await page.setViewportSize({ width, height: 844 });
    await page.route("**/api/investigations", (route) =>
        route.fulfill({
            status: 200,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ result }),
        }),
    );
    await page.goto("/");
    await page.getByLabel("Ask a question").fill("What is the status of work items?");
    await page.getByRole("button", { name: "Send" }).click();
    const panel = page.getByTestId("work-item-status-panel");
    await expect(panel).toBeVisible();
    return panel;
}

function rowFor(panel: Locator, id: string) {
    return panel.locator(`[data-testid="work-item-status-row"][data-subject-id="${id}"]`);
}

test.describe("Work item status panel", () => {
    test("renders the retained producer values at desktop and narrow widths", async ({ page }) => {
        const result = loadProducerResult();
        for (const width of [1440, 390]) {
            const panel = await openResult(page, result, width);
            await expect(panel.getByRole("columnheader", { name: "Work item" })).toBeVisible();
            await expect(panel.getByRole("columnheader", { name: "Status" })).toBeVisible();
            await expect(panel.getByRole("columnheader", { name: "Evidence" })).toBeVisible();
            const rows = panel.getByTestId("work-item-status-row");
            await expect(rows).toHaveCount(12);
            await expect(rows.nth(0).getByTestId("work-item-status-value")).toHaveText("open");
            await expect(rows.nth(9).getByTestId("work-item-status-value")).toHaveText("waiting");
            await expect(panel).not.toContainText("work_item");
            await expect(page.getByTestId("cohort-ranking-panel")).toHaveCount(0);
            await expect(
                page.evaluate(
                    () =>
                        document.documentElement.scrollWidth <=
                        document.documentElement.clientWidth,
                ),
            ).resolves.toBe(true);
        }
    });

    test("shows recorded blank status separately from missing status", async ({ page }) => {
        const producer = loadProducerResult();
        const blank = resultWithStatus(producer, WORK_ITEM_ZERO, "");
        const controlled = resultWithoutStatus(blank, WORK_ITEM_MISSING);
        const panel = await openResult(page, controlled, 390);
        const rows = panel.getByTestId("work-item-status-row");
        await expect(rows).toHaveCount(12);

        const blankRow = rowFor(panel, WORK_ITEM_ZERO);
        await expect(blankRow.getByTestId("work-item-status-blank")).toHaveText(
            "Recorded blank value",
        );
        await expect(blankRow.getByTestId("work-item-status-value")).toContainText(
            "Recorded blank value",
        );

        const missingRow = rowFor(panel, WORK_ITEM_MISSING);
        await expect(missingRow.getByTestId("work-item-status-missing")).toHaveText(
            "No status evidence in this answer",
        );
        await expect(missingRow.getByTestId("work-item-status-blank")).toHaveCount(0);
        await expect(rows.nth(9).getByTestId("work-item-status-value")).toHaveText("waiting");
        await expect(panel).not.toContainText("work_item");
        await expect(page.getByTestId("cohort-ranking-panel")).toHaveCount(0);
    });
});
