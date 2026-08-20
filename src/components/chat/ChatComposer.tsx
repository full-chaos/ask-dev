"use client";

import { useState } from "react";

export type ChatComposerProps = {
    readonly pending: boolean;
    readonly onAsk: (question: string) => void;
};

/**
 * The chat surface's bottom composer (Phase 1, chat pivot).
 *
 * Deliberately its own component rather than a reuse of the Workbench's
 * `QuestionForm`: that component's copy and layout are Workbench-flavored
 * ("Investigate", a full-width row above the result). This surface keeps the
 * same submit discipline — trim, reject empty/pending, one interaction — but
 * in the sticky bottom-bar shape a conversational surface needs.
 */
export function ChatComposer({ pending, onAsk }: ChatComposerProps) {
    const [question, setQuestion] = useState("");

    function submit() {
        const trimmed = question.trim();
        if (trimmed === "" || pending) return;
        onAsk(trimmed);
        setQuestion("");
    }

    return (
        <form
            className="chat-composer"
            onSubmit={(event) => {
                event.preventDefault();
                submit();
            }}
        >
            <label className="chat-composer__label" htmlFor="chat-question">
                Ask a question
            </label>
            <div className="chat-composer__row">
                <textarea
                    className="chat-composer__input"
                    id="chat-question"
                    name="question"
                    rows={1}
                    autoComplete="off"
                    disabled={pending}
                    value={question}
                    placeholder="Ask about a project, a repository, a team…"
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            submit();
                        }
                    }}
                />
                <button
                    className="chat-composer__submit"
                    type="submit"
                    disabled={pending || question.trim() === ""}
                    aria-label="Send"
                >
                    {pending ? "Asking…" : "Ask"}
                </button>
            </div>
            <p className="chat-composer__hint">
                Every answer comes from a real ACR investigation — Ask Dev never renders a mock
                result.
            </p>
        </form>
    );
}
