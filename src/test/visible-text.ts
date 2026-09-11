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
 * Deliberately narrow: a closed `<details>` is the one collapsed-but-present
 * pattern this UI uses. It is not a general visibility oracle — it says nothing
 * about `display: none`, `hidden`, clipping or scroll position (jsdom does not
 * lay out, so no helper here could). Use `toBeVisible()` for those.
 */
export function visibleText(element: Element): string {
    const clone = element.cloneNode(true) as Element;
    for (const details of Array.from(clone.querySelectorAll("details"))) {
        if (!details.hasAttribute("open")) details.remove();
    }
    return (clone.textContent ?? "").replace(/\s+/gu, " ").trim();
}

/** True when `text` is on screen rather than collapsed behind a summary. */
export function isVisibleText(element: Element, text: string): boolean {
    return visibleText(element).includes(text.replace(/\s+/gu, " ").trim());
}
