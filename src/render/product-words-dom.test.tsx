import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { InspectorRail } from "@/components/chat/InspectorRail";
import type { InvestigationResult } from "@/lib/contracts";
import { mockScenarios } from "@/test/fixtures/investigations";
import { structureMockScenarios } from "@/test/fixtures/structure-needs";

/**
 * CHAOS-12406: what `product-words.test.ts` cannot see, because it is a value at run time. Every
 * result the repo holds is rendered, and what a user can read must name no internal service and no
 * ticket in the render's own words.
 *
 * Two things pass by rule. What ACR served passes whatever it says: language is the engine's
 * (CHAOS-4690), so this takes every served string out first. What sits in a closed fold passes by
 * position: that is where a raw value belongs.
 */
const EXAMPLES_DIR = path.resolve(import.meta.dirname, "../contracts/examples");
const PRODUCER_FIXTURE = path.resolve(
    import.meta.dirname,
    "../../tests/fixtures/work-item-status-result.json",
);

const readResult = (file: string) => JSON.parse(readFileSync(file, "utf8")) as InvestigationResult;

const results: readonly (readonly [string, InvestigationResult])[] = [
    ...readdirSync(EXAMPLES_DIR)
        .filter((file) => file.includes("investigation_result") && file.endsWith(".json"))
        .map((file) => [file, readResult(path.join(EXAMPLES_DIR, file))] as const),
    ...mockScenarios().map((scenario) => [scenario.id, scenario.result] as const),
    ...structureMockScenarios().map((scenario) => [scenario.id, scenario.result] as const),
    ["work-item-status-result.json", readResult(PRODUCER_FIXTURE)],
];

const FORBIDDEN = [/\bACR\b/u, /Context Fabric/u, /Workbench/u, /CHAOS-\d+/u] as const;

/** Whether a closed fold hides `element`. A fold's summary stays on screen. */
function insideClosedFold(element: Element): boolean {
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
        if (node.tagName !== "DETAILS" || node.hasAttribute("open")) continue;
        const summary = node.querySelector(":scope > summary");
        if (summary === null || !summary.contains(element)) return true;
    }
    return false;
}

/** The strings a user can reach: text, and every attribute a browser shows, outside a closed fold. */
function reachableStrings(root: Element): readonly string[] {
    const found: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const parent = walker.currentNode.parentElement;
        const text = walker.currentNode.textContent ?? "";
        if (parent !== null && !insideClosedFold(parent) && text.trim() !== "") found.push(text);
    }
    for (const node of root.querySelectorAll("*")) {
        if (insideClosedFold(node)) continue;
        for (const name of ["title", "aria-label", "alt", "placeholder"]) {
            const value = node.getAttribute(name);
            if (value !== null) found.push(value);
        }
    }
    return found;
}

/** A pin that reads nothing did not measure, so it fails here. */
function readStrings(root: Element): readonly string[] {
    const strings = reachableStrings(root);
    if (strings.length === 0) throw new Error("the runtime pin read no text");
    return strings;
}

function allStrings(value: unknown): readonly string[] {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(allStrings);
    if (value !== null && typeof value === "object") {
        return Object.values(value).flatMap(allStrings);
    }
    return [];
}

/** The render's own words: `strings`, with every string of the result taken out. */
function ownWords(strings: readonly string[], result: unknown): readonly string[] {
    const served = [...new Set(allStrings(result))].sort((a, b) => b.length - a.length);
    return strings.map((text) => served.reduce((left, value) => left.replaceAll(value, " "), text));
}

function offending(strings: readonly string[]): readonly string[] {
    return strings.filter((text) => FORBIDDEN.some((pattern) => pattern.test(text)));
}

/** Every surface of one result, in both presentations. */
function renderedStrings(result: InvestigationResult): readonly string[] {
    const chosenSubject = result.subject_resolution.candidates[0]?.subject;
    const { container, unmount } = render(
        <>
            <DeterministicAnswerView chosenSubject={chosenSubject} result={result} />
            <DeterministicAnswerView
                chosenSubject={chosenSubject}
                offersPresentation="popup"
                result={result}
            />
            <InspectorRail result={result} />
        </>,
    );
    const strings = readStrings(container);
    unmount();
    return strings;
}

function fixture(html: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = html;
    return root;
}

afterEach(cleanup);

describe("the runtime pin", () => {
    it("holds results to read", () => {
        expect(results.length).toBeGreaterThan(10);
    });

    it.each(results)(
        "%s: the render's own words name no service and no ticket",
        (_name, result) => {
            expect(offending(ownWords(renderedStrings(result), result))).toEqual([]);
        },
    );
});

describe("the pin's own rules", () => {
    it("fails on a render that reads no text", () => {
        expect(() => readStrings(document.createElement("div"))).toThrow("read no text");
    });

    it("one word in a fold and one in visible text: only the visible one fires", () => {
        const root = fixture(
            "<p>ACR on the page</p><details><summary>Fold</summary><p>ACR in a fold</p></details>",
        );

        expect(offending(readStrings(root))).toEqual(["ACR on the page"]);
    });

    it("a fold's summary stays on screen", () => {
        const root = fixture("<details><summary>ACR</summary><p>body</p></details>");
        expect(offending(readStrings(root))).toEqual(["ACR"]);
    });

    it("an open fold is no fold", () => {
        const root = fixture("<details open><summary>Fold</summary><p>ACR</p></details>");
        expect(offending(readStrings(root))).toEqual(["ACR"]);
    });

    it("a fold inside a fold is folded", () => {
        const root = fixture(
            "<p>Text</p><details><summary>A</summary><details open><p>ACR</p></details></details>",
        );
        expect(offending(readStrings(root))).toEqual([]);
    });

    it("reads an attribute a browser shows, outside a fold only", () => {
        const root = fixture(
            '<p title="ACR">x</p><details><summary>A</summary><p title="ACR">y</p></details>',
        );
        expect(offending(readStrings(root))).toEqual(["ACR"]);
    });

    it("finds each word", () => {
        expect(
            offending(["the ACR", "a Context Fabric", "the Workbench", "CHAOS-12"]),
        ).toHaveLength(4);
        expect(offending(["Ask Dev", "chaos-12", "acreage"])).toEqual([]);
    });

    it("served text passes whatever it says, and the render's own does not", () => {
        const strings = ["The ACR said so", "ACR is the render's word here"];

        expect(offending(ownWords(strings, { answer: "The ACR said so" }))).toEqual([
            "ACR is the render's word here",
        ]);
    });
});
