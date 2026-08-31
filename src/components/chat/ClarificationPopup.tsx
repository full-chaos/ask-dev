"use client";

import { useEffect, useRef, useState } from "react";

import type { PopupOption, PopupOptionSource, PopupPage } from "@/lib/clarification-popup";

/**
 * CHAOS-4671: the clarification/offer workflow as a floating popup anchored
 * above the chat input — the Claude app/web pattern — replacing the old
 * full-width inline transcript panels (`StructureNeedsPanel`/
 * `ClarificationPanel`, still used verbatim by `/workbench`, which this
 * component does not touch).
 *
 * Ownership split (see `page.tsx`'s own wiring): this component is PURELY
 * presentation and page-sequencing — it never calls the wire itself. Every
 * pick round-trips through the SAME `toggle`/`chooseStructure` functions the
 * old inline panels already called (`onSelect`/`onComplete` below), so the
 * request shape and every existing selection-hook invariant are unchanged.
 *
 * Keyboard scope: hotkeys (number keys, ↑↓, Enter) are wired on THIS
 * component's own container, not `window` — the chat composer is a DOM
 * sibling, never a descendant, so typing there never reaches this handler
 * and "typing a normal reply is always allowed" holds without any special
 * casing. The container is focused on mount and on every page change so the
 * hotkeys are live the instant the popup (or a new page within it) appears.
 */

export type ClarificationPopupProps = {
    readonly pages: readonly PopupPage[];
    readonly pending: boolean;
    /** Applies one pick to the underlying selection hook — never advances/fires on its own. */
    readonly onSelect: (source: PopupOptionSource) => void;
    /**
     * Fires the SAME re-ask the old "Ask again with these selections"/"Ask
     * about the selected candidates" buttons already called. Called only
     * once the flow reaches the end of every page — see this component's
     * own page-advance logic for exactly when.
     */
    readonly onComplete: () => void;
    /** Closes the popup with no re-ask — "today's default path" (CHAOS-4671 ticket). */
    readonly onDismiss: () => void;
    /** The free-text row: a plain new ask, same as typing in the composer. */
    readonly onFreeText: (text: string) => void;
};

function anySelected(pages: readonly PopupPage[]): boolean {
    return pages.some((page) => page.options.some((option) => option.selected));
}

/**
 * The digit that activates position `index` (0-based) via `handleKeyDown`'s
 * own number-key branch below — "0" for the 10th item (index 9), matching
 * the contract's own `maxItems: 10` bound on subject candidates (codex
 * round 2 finding 3: showing "10" on a badge that only a TWO-keystroke
 * sequence could match was a false affordance — single keystrokes only go
 * up to 9, so "0" stands in for the 10th, the same convention browser
 * tab-switch shortcuts use). Empty beyond that — no popup page is expected
 * to carry more than 10 real options, and an option with no single-key
 * hotkey is still reachable by click or ↑↓+Enter regardless.
 */
function hotkeyLabel(index: number): string {
    if (index < 9) return String(index + 1);
    if (index === 9) return "0";
    return "";
}

function OptionRow({
    option,
    number,
    focused,
    pending,
    onPick,
}: {
    readonly option: PopupOption;
    readonly number: string;
    readonly focused: boolean;
    readonly pending: boolean;
    readonly onPick: () => void;
}) {
    return (
        <li className="clarification-popup__option">
            <button
                aria-pressed={option.selected}
                className={
                    focused
                        ? "clarification-popup__option-button clarification-popup__option-button--focused"
                        : "clarification-popup__option-button"
                }
                disabled={pending}
                onClick={onPick}
                type="button"
            >
                <span className="clarification-popup__option-number" aria-hidden="true">
                    {number}
                </span>
                <span className="clarification-popup__option-text">
                    {option.displayText}
                    {
                        // codex round 1 finding 3: offer VALUES stay
                        // structural (chris 2026-08-24 10:04) — `label` is
                        // what is actually bound to the receipt, so it is
                        // always shown too, never hidden behind the
                        // model's `phrasing`. Mirrors `StructureNeedsPanel`'s
                        // own `OfferButton` "structural: {label}" line.
                        option.displayText === option.label ? null : (
                            <span className="clarification-popup__option-structural">
                                structural: {option.label}
                            </span>
                        )
                    }
                </span>
                {option.selected ? (
                    <span className="clarification-popup__option-check" aria-hidden="true">
                        ✓
                    </span>
                ) : null}
            </button>
        </li>
    );
}

export function ClarificationPopup({
    pages,
    pending,
    onSelect,
    onComplete,
    onDismiss,
    onFreeText,
}: ClarificationPopupProps) {
    const [pageIndex, setPageIndex] = useState(0);
    const [focusedOption, setFocusedOption] = useState(0);
    const [freeText, setFreeText] = useState("");
    const [freeTextOpen, setFreeTextOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const freeTextRef = useRef<HTMLInputElement>(null);

    const clampedIndex = Math.min(pageIndex, Math.max(pages.length - 1, 0));
    const page = pages[clampedIndex];

    // Refocus the container on every page change so the number/arrow/Enter
    // hotkeys stay live without the tester having to click back into the
    // popup — mirrors how a native modal/menu keeps focus internally.
    useEffect(() => {
        if (!freeTextOpen) containerRef.current?.focus();
    }, [clampedIndex, freeTextOpen]);

    // Reset per-page UI state whenever the page changes, adjusted DURING
    // RENDER (React's own documented escape hatch — see `page.tsx`'s
    // `syncedTurns`/`hasUnseenBelow` for the same idiom) rather than in an
    // effect: `react-hooks/set-state-in-effect` flags a bare `setState`
    // call inside an effect body, and this is exactly "derived state
    // changed" with nothing external to synchronize with.
    //
    // `freeText`/`freeTextOpen` reset here too (codex round 2 finding 1): a
    // free-text DRAFT is per-question, so it must not survive Skip/Continue
    // onto the NEXT page — and critically, a non-empty draft otherwise left
    // `freeTextOpen` `true` forever (the `onBlur` handler below only clears
    // it when the draft is EMPTY), which permanently suppressed the
    // container-refocus effect above and, with it, every number/arrow/Enter
    // hotkey on every page from that point on.
    const [lastPageIndex, setLastPageIndex] = useState(clampedIndex);
    if (clampedIndex !== lastPageIndex) {
        setLastPageIndex(clampedIndex);
        setFocusedOption(0);
        setFreeText("");
        setFreeTextOpen(false);
    }

    if (page === undefined) return null;
    // Re-bound so every nested closure below sees a type TS can prove is
    // defined — narrowing a captured outer `const` does not cross a nested
    // function declaration's boundary, even though `page` itself never
    // changes between this guard and any of those closures actually running.
    const currentPage = page;

    const isLastPage = clampedIndex === pages.length - 1;
    const selectedOnCurrentPage = currentPage.options.filter((option) => option.selected).length;

    /**
     * `pick()`'s own advance, single-select pages only: the pick just made
     * IS the selection event, so reaching the end must always complete —
     * NEVER gated by `anySelected(pages)`, which would still read the
     * STALE pre-toggle `pages` prop in the very same synchronous click
     * that makes this the first selection of the whole flow (`onSelect`
     * only schedules the parent's state update; `pages` itself does not
     * reflect it until the next render). Contrast `continuePastPage`
     * below, which is never called synchronously with a fresh `onSelect`.
     */
    function goToNextOrComplete() {
        if (isLastPage) {
            onComplete();
        } else {
            setPageIndex((current) => current + 1);
        }
    }

    function pick(option: PopupOption) {
        if (pending) return;
        if (currentPage.selectMode === "single") {
            // Re-picking the option already selected on this page is a
            // no-op confirm, not a deselect — `toggle` would otherwise
            // remove the pick on a revisit via ‹, which reads as the popup
            // losing the answer it just showed as selected.
            if (!option.selected) onSelect(option.source);
            goToNextOrComplete();
            return;
        }
        onSelect(option.source);
    }

    /**
     * The multi-select page's own explicit "Continue"/Skip — unlike
     * `pick()` above, NEITHER of these is itself a selection event (every
     * toggle that led here was its own earlier, already-flushed click), so
     * `pages` correctly reflects every pick made so far. Reaching the end
     * with NOTHING selected on ANY page must not fire a receipt-less
     * re-ask of the identical question — that would be a silent, pointless
     * round trip (codex round 1 finding 1: "Continue without selecting"
     * on the last page used to call `onComplete()` unconditionally).
     * Something picked on an EARLIER page still gets submitted.
     */
    function continuePastPage() {
        if (isLastPage) {
            if (anySelected(pages)) onComplete();
            else onDismiss();
        } else {
            setPageIndex((current) => current + 1);
        }
    }

    function skip() {
        if (pending) return;
        continuePastPage();
    }

    function submitFreeText() {
        const trimmed = freeText.trim();
        if (trimmed === "" || pending) return;
        onFreeText(trimmed);
    }

    function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
        if (pending) return;
        if (event.key === "Escape") {
            // Dismiss works from anywhere inside the popup, including a
            // focused child control — the one hotkey that should.
            event.preventDefault();
            onDismiss();
            return;
        }
        // codex round 1 finding 2: the number/arrow/Enter hotkeys below
        // must NOT fire when a keydown bubbled up from a descendant
        // control — the free-text `<input>` (typing "1" or pressing Enter
        // there must reach the input, not hijack an option pick) and every
        // native `<button>` in the popup (Dismiss/Skip/Continue/an option
        // reached via Tab already get correct Enter/Space activation from
        // the browser itself; re-intercepting it here doubles up and, for
        // Dismiss, silently substitutes a wrong action). `event.target !==
        // event.currentTarget` is exactly "this event originated on the
        // container div itself" — true only right after mount/page-change,
        // when nothing else has taken focus.
        if (event.target !== event.currentTarget) return;
        if ((event.key >= "1" && event.key <= "9") || event.key === "0") {
            // codex round 2 finding 3: the contract allows up to 10 subject
            // candidates, but a single keystroke can only carry ONE digit —
            // "0" conventionally stands for the 10th item (same convention
            // as browser tab-switch shortcuts, Ctrl+1..9,0). `OptionRow`
            // below renders the SAME mapping on the number badge, so the
            // displayed key always matches what actually activates it.
            const index = event.key === "0" ? 9 : Number(event.key) - 1;
            const option = currentPage.options[index];
            if (option !== undefined) {
                event.preventDefault();
                pick(option);
            }
            return;
        }
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setFocusedOption((current) => Math.min(current + 1, currentPage.options.length - 1));
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            setFocusedOption((current) => Math.max(current - 1, 0));
            return;
        }
        if (event.key === "Enter") {
            const option = currentPage.options[focusedOption];
            if (option !== undefined) {
                event.preventDefault();
                pick(option);
            }
        }
    }

    return (
        <div
            aria-label={currentPage.title}
            className="clarification-popup"
            onKeyDown={handleKeyDown}
            ref={containerRef}
            role="dialog"
            tabIndex={-1}
        >
            <div className="clarification-popup__head">
                {pages.length > 1 ? (
                    <div className="clarification-popup__stepper">
                        <button
                            aria-label="Previous question"
                            className="clarification-popup__stepper-nav"
                            disabled={clampedIndex === 0 || pending}
                            onClick={() => setPageIndex((current) => Math.max(current - 1, 0))}
                            type="button"
                        >
                            ‹
                        </button>
                        <span className="clarification-popup__stepper-count">
                            {clampedIndex + 1} of {pages.length}
                        </span>
                        <button
                            aria-label="Next question"
                            className="clarification-popup__stepper-nav"
                            disabled={isLastPage || pending}
                            onClick={() => setPageIndex((current) => current + 1)}
                            type="button"
                        >
                            ›
                        </button>
                    </div>
                ) : null}
                <button
                    aria-label="Dismiss"
                    className="clarification-popup__dismiss"
                    onClick={onDismiss}
                    type="button"
                >
                    ×
                </button>
            </div>
            <h2 className="clarification-popup__title">{currentPage.title}</h2>
            <ul className="clarification-popup__options">
                {currentPage.options.map((option, index) => (
                    <OptionRow
                        focused={index === focusedOption}
                        key={option.id}
                        number={hotkeyLabel(index)}
                        onPick={() => pick(option)}
                        option={option}
                        pending={pending}
                    />
                ))}
                <li className="clarification-popup__option">
                    <button
                        className="clarification-popup__option-button clarification-popup__option-button--other"
                        disabled={pending}
                        onClick={() => {
                            setFreeTextOpen(true);
                            freeTextRef.current?.focus();
                        }}
                        type="button"
                    >
                        <span className="clarification-popup__option-number" aria-hidden="true">
                            {currentPage.options.length + 1}
                        </span>
                        <span className="clarification-popup__option-text">Other</span>
                    </button>
                </li>
            </ul>
            {currentPage.selectMode === "multi" ? (
                // Multi-select pages (either candidate axis, CHAOS-4343) need
                // an EXPLICIT confirm — picking toggles in place rather than
                // auto-advancing, so there is no single "the pick" moment
                // `goToNextOrComplete` can hang off implicitly the way a
                // single-select page's own click already does. Uses
                // `continuePastPage`, NOT `goToNextOrComplete` — see that
                // function's own header for why only THIS call site needs
                // the "was anything ever selected" guard.
                <button
                    className="clarification-popup__continue"
                    disabled={pending}
                    onClick={continuePastPage}
                    type="button"
                >
                    {selectedOnCurrentPage === 0
                        ? isLastPage
                            ? "Continue without selecting"
                            : "Continue"
                        : `Continue with ${selectedOnCurrentPage} selected`}
                </button>
            ) : null}
            <form
                className="clarification-popup__free-text"
                onSubmit={(event) => {
                    event.preventDefault();
                    submitFreeText();
                }}
            >
                <span className="clarification-popup__free-text-icon" aria-hidden="true">
                    ✎
                </span>
                <input
                    aria-label="Something else"
                    className="clarification-popup__free-text-input"
                    disabled={pending}
                    onBlur={() => {
                        if (freeText.trim() === "") setFreeTextOpen(false);
                    }}
                    onChange={(event) => setFreeText(event.target.value)}
                    onFocus={() => setFreeTextOpen(true)}
                    placeholder="Something else…"
                    ref={freeTextRef}
                    type="text"
                    value={freeText}
                />
                <button
                    className="clarification-popup__skip"
                    disabled={pending}
                    onClick={skip}
                    type="button"
                >
                    Skip
                </button>
            </form>
            <p className="clarification-popup__hint">
                ↑↓ to navigate · Enter to select · or type below
            </p>
        </div>
    );
}
