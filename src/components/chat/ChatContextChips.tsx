"use client";

import { CONTEXT_CHIPS_COPY, removeLabel, SCOPE_KIND_LABEL } from "../../render/chat-copy";
import type { ChatContextRef } from "../../render/source";

export type ChatContextChipsProps = {
    readonly refs: readonly ChatContextRef[];
    readonly onRemove: (ref: ChatContextRef) => void;
};

/**
 * The page context offered with the next question, as removable chips. It shows only what the
 * snapshot lists, and renders nothing for an empty list. Labels are the page's own text, drawn as
 * inert React text. Ported from web's `AskDevContextChips`, with its words and test ids.
 */
export function ChatContextChips({ refs, onRemove }: ChatContextChipsProps) {
    if (refs.length === 0) return null;
    return (
        <div
            aria-label={CONTEXT_CHIPS_COPY.title}
            className="chat-context"
            data-testid="ask-dev-context"
            role="group"
        >
            <p className="chat-context__note">
                <span className="chat-context__title">{CONTEXT_CHIPS_COPY.title}</span>
                {" · "}
                {CONTEXT_CHIPS_COPY.note}
            </p>
            <ul className="chat-context__list">
                {refs.map((ref) => (
                    <li
                        className="chat-context__chip"
                        data-kind={ref.kind}
                        data-testid="ask-dev-context-chip"
                        key={JSON.stringify([ref.kind, ref.id])}
                    >
                        <span className="chat-context__kind">{SCOPE_KIND_LABEL[ref.kind]}:</span>
                        <span className="chat-context__label">{ref.label}</span>
                        <button
                            aria-label={removeLabel(ref)}
                            className="chat-context__remove"
                            data-testid="ask-dev-context-remove"
                            onClick={() => {
                                onRemove(ref);
                            }}
                            type="button"
                        >
                            <svg
                                aria-hidden="true"
                                fill="none"
                                height="12"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeWidth="2.5"
                                viewBox="0 0 24 24"
                                width="12"
                            >
                                <path d="M18 6 6 18M6 6l12 12" />
                            </svg>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}
