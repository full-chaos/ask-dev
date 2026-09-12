/**
 * The text a reader actually SEES, with collapsed `<details>` content removed.
 *
 * Exists because `toHaveTextContent` / `getByText` read the DOM, and jsdom's
 * `textContent` includes the body of a closed `<details>` — so an assertion
 * written to prove "the panel discloses X" passes just as happily when X is
 * one click away behind a summary as when it is on screen — so such a test
 * cannot fail on the very thing it claims. A visibility claim must therefore
 * be asserted against visible text, and reachability-behind-a-disclosure
 * asserted separately as itself.
 *
 * This repo puts real content behind `<Details>` deliberately and in many
 * places (per-source coverage breakdowns, raw reasons, structure evidence), so
 * the distinction belongs in ONE shared helper every visibility claim can use,
 * not in a per-file re-implementation the next test will forget.
 *
 * A closed `<details>` still shows its `<summary>`, so the summary is KEPT and
 * only the body is dropped — removing the whole element would under-report and
 * let "the summary is on screen" fail. The element passed in is itself subject
 * to the rule: `querySelectorAll` matches descendants only, so a closed
 * `<details>` handed in as the root would otherwise have its hidden body
 * reported as visible, which is the exact inversion this helper exists to
 * prevent.
 *
 * Deliberately narrow: a closed `<details>` is the one collapsed-but-present
 * pattern this UI uses. It is not a general visibility oracle — it says nothing
 * about `display: none`, `hidden`, clipping or scroll position (jsdom does not
 * lay out, so no helper here could). Use `toBeVisible()` for those.
 */
export function visibleText(element: Element): string {
    if (isCollapsedByAncestor(element)) return "";
    const clone = element.cloneNode(true) as Element;
    const collapse = (details: Element): void => {
        if (details.hasAttribute("open")) return;
        const summary = details.querySelector(":scope > summary");
        details.replaceChildren(...(summary === null ? [] : [summary]));
    };
    // The element itself first, then every descendant — a closed `<details>`
    // shows its summary, so collapsing keeps that and drops only the body.
    if (clone.tagName.toLowerCase() === "details") collapse(clone);
    for (const details of Array.from(clone.querySelectorAll("details"))) collapse(details);
    return (clone.textContent ?? "").replace(/\s+/gu, " ").trim();
}

/**
 * True when an ANCESTOR hides this element: the element sits in the body of a
 * closed `<details>` somewhere above it, so nothing it contains is on screen
 * no matter what it contains. Without this, handing in an inner element — the
 * `<code>` inside a closed "Raw reason" disclosure, say — reports hidden text
 * as visible, since it has no `<details>` of its own at or below it. Content
 * inside that `<details>`'s own `<summary>` IS on screen and is not hidden.
 */
function isCollapsedByAncestor(element: Element): boolean {
    for (let node = element.parentElement; node !== null; node = node.parentElement) {
        if (node.tagName.toLowerCase() !== "details" || node.hasAttribute("open")) continue;
        const summary = node.querySelector(":scope > summary");
        if (summary === null || !summary.contains(element)) return true;
    }
    return false;
}

/** True when `text` is on screen rather than collapsed behind a summary. */
export function isVisibleText(element: Element, text: string): boolean {
    return visibleText(element).includes(text.replace(/\s+/gu, " ").trim());
}
