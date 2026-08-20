"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type ChatComposerProps = {
    readonly pending: boolean;
    /**
     * Returns whether the ask settled as an answer (`true`) or a failure
     * (`false`). The composer uses this ONLY to decide whether to clear the
     * draft — never to inspect or re-derive what was sent.
     */
    readonly onAsk: (question: string) => Promise<boolean>;
};

export type ChatComposerHandle = {
    /**
     * Sends `question` through the EXACT SAME path a manual Send takes —
     * same draft-clear-on-success, same preserve-and-select-on-failure, same
     * focus handling. A failure turn's own Retry action calls this (rather
     * than asking the page to call `onAsk` directly) so a retry can never
     * leave the composer showing stale, already-answered text (codex review
     * round 2, finding: a direct `ask()` call from the page bypassed this
     * component's own clearing logic entirely).
     */
    retry: (question: string) => void;
};

/**
 * The chat surface's bottom composer (Phase 1, chat pivot).
 *
 * Deliberately its own component rather than a reuse of the Workbench's
 * `QuestionForm`: that component's copy and layout are Workbench-flavored
 * ("Investigate", a full-width row above the result). This surface keeps the
 * same submit discipline — trim, reject empty/pending, one interaction — but
 * in the sticky bottom-bar shape a conversational surface needs.
 *
 * UX-equivalence pass: autosizing textarea (grows with content up to the
 * stylesheet's max-height, then scrolls), focus returns to the composer the
 * moment the surrounding surface stops being pending (any turn settling, not
 * just this one — the same behavior a Claude/ChatGPT-class composer gives),
 * and a failed ask leaves the question in the box instead of discarding it,
 * so a retry never means retyping. `ChatComposerHandle.retry` is the ONE
 * escape hatch into that logic from outside — see its own doc comment.
 */
export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposer(
    { pending, onAsk },
    ref,
) {
    const [question, setQuestion] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const wasPending = useRef(pending);

    // Autosize: grows with content, capped by the stylesheet's max-height
    // (which then scrolls) — never taller than that on its own.
    useEffect(() => {
        const el = textareaRef.current;
        if (el === null) return;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
    }, [question]);

    // Focus the composer on first mount — the primary entry point of a
    // chat surface should be ready to type into immediately, the same way
    // Claude/ChatGPT-class composers behave.
    useEffect(() => {
        textareaRef.current?.focus();
    }, []);

    // Focus returns to the composer the instant ANY turn stops being
    // pending — not just a submit this instance made (a clarification or
    // structure-need re-ask also settles here), matching how a
    // Claude/ChatGPT-class composer keeps typing frictionless turn to
    // turn.
    useEffect(() => {
        if (wasPending.current && !pending) {
            textareaRef.current?.focus();
        }
        wasPending.current = pending;
    }, [pending]);

    // Takes the question EXPLICITLY rather than re-reading `question`
    // state, so `retry` below can drive this with a value that hasn't
    // (and, mid-call, still won't have) landed in state yet — state
    // updates don't apply synchronously, so reading the state variable
    // right after `setQuestion(x)` would still see the OLD value.
    async function submitQuestion(trimmed: string) {
        if (trimmed === "" || pending) return;
        const answered = await onAsk(trimmed);
        // Draft preserved on error: a failed ask leaves the question in
        // the box, selected, so editing and resending never means
        // retyping from scratch. Cleared only once the ask actually
        // answered.
        if (answered) {
            setQuestion("");
        } else {
            setQuestion(trimmed);
            textareaRef.current?.select();
        }
    }

    useImperativeHandle(ref, () => ({
        retry: (retryQuestion: string) => {
            setQuestion(retryQuestion);
            void submitQuestion(retryQuestion);
        },
    }));

    return (
        <form
            className="chat-composer"
            onSubmit={(event) => {
                event.preventDefault();
                void submitQuestion(question.trim());
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
                    ref={textareaRef}
                    rows={1}
                    autoComplete="off"
                    disabled={pending}
                    value={question}
                    placeholder="Ask about a project, a repository, a team…"
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            void submitQuestion(question.trim());
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
});
