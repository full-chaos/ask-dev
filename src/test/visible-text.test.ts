import { describe, expect, it } from "vitest";

import { isVisibleText, visibleText } from "@/test/visible-text";

function el(html: string): Element {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div;
}

describe("visibleText / isVisibleText", () => {
    it("includes text outside any <details>", () => {
        const root = el("<p>on screen</p>");
        expect(visibleText(root)).toContain("on screen");
        expect(isVisibleText(root, "on screen")).toBe(true);
    });

    it("drops the body of a closed <details> but keeps its summary", () => {
        const root = el("<details><summary>label</summary><p>hidden body</p></details>");
        expect(visibleText(root)).toContain("label");
        expect(visibleText(root)).not.toContain("hidden body");
        expect(isVisibleText(root, "label")).toBe(true);
        expect(isVisibleText(root, "hidden body")).toBe(false);
    });

    it("keeps the body of an open <details>", () => {
        const root = el("<details open><summary>label</summary><p>shown body</p></details>");
        expect(isVisibleText(root, "shown body")).toBe(true);
    });

    // CHAOS-5622: a blank expected value made isVisibleText trivially true
    // for ANY element -- "".includes("") is true in JS regardless of the
    // left side -- so it asserted nothing about what is actually on screen.
    // It must now reject a blank (or whitespace-only) expected value outright
    // rather than silently returning a result that means nothing.
    it("rejects a blank expected value", () => {
        const root = el("<p>anything</p>");
        expect(() => isVisibleText(root, "")).toThrow(/blank/);
    });

    it("rejects a whitespace-only expected value", () => {
        const root = el("<p>anything</p>");
        expect(() => isVisibleText(root, "   \n\t")).toThrow(/blank/);
    });

    it("still rejects blank even against a fully collapsed element", () => {
        // The degenerate case the bug hid best: a blank expected value used
        // to read as "visible" even when NOTHING in the element is visible.
        const root = el("<details><summary></summary><p>hidden</p></details>");
        expect(() => isVisibleText(root, "")).toThrow(/blank/);
    });
});
