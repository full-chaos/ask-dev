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

function OptionRow({
    option,
    number,
    focused,
    pending,
    onPick,
}: {
    readonly option: PopupOption;
    readonly number: number;
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
                <span className="clarification-popup__option-text">{option.displayText}</span>
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

    // Reset the focused option whenever the page changes, adjusted DURING
    // RENDER (React's own documented escape hatch — see `page.tsx`'s
    // `syncedTurns`/`hasUnseenBelow` for the same idiom) rather than in an
    // effect: `react-hooks/set-state-in-effect` flags a bare `setState`
    // call inside an effect body, and this is exactly "derived state
    // changed" with nothing external to synchronize with.
    const [lastPageIndex, setLastPageIndex] = useState(clampedIndex);
    if (clampedIndex !== lastPageIndex) {
        setLastPageIndex(clampedIndex);
        setFocusedOption(0);
    }

    if (page === undefined) return null;
    // Re-bound so every nested closure below sees a type TS can prove is
    // defined — narrowing a captured outer `const` does not cross a nested
    // function declaration's boundary, even though `page` itself never
    // changes between this guard and any of those closures actually running.
    const currentPage = page;

    const isLastPage = clampedIndex === pages.length - 1;
    const selectedOnCurrentPage = currentPage.options.filter((option) => option.selected).length;

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

    function skip() {
        if (pending) return;
        if (isLastPage) {
            // Reaching the end via Skip with nothing picked on ANY page
            // must not fire a receipt-less re-ask of the identical
            // question — that would be a silent, pointless round trip.
            // Something picked on an EARLIER page still gets submitted.
            if (anySelected(pages)) onComplete();
            else onDismiss();
            return;
        }
        setPageIndex((current) => current + 1);
    }

    function submitFreeText() {
        const trimmed = freeText.trim();
        if (trimmed === "" || pending) return;
        onFreeText(trimmed);
    }

    function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
        if (pending) return;
        if (event.key >= "1" && event.key <= "9") {
            const index = Number(event.key) - 1;
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
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            onDismiss();
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
                        number={index + 1}
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
                // single-select page's own click already does.
                <button
                    className="clarification-popup__continue"
                    disabled={pending}
                    onClick={goToNextOrComplete}
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
