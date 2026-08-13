"use client";

import { useState } from "react";

export type QuestionFormProps = {
    readonly initialQuestion: string;
    readonly pending: boolean;
    readonly onAsk: (question: string) => void;
};

/**
 * Submitting a question is the Workbench's primary interaction — and, alongside
 * choosing a clarification candidate and switching views, close to its only one
 * (CHAOS-3738). There is no product mutation here and no agent action.
 */
export function QuestionForm({ initialQuestion, pending, onAsk }: QuestionFormProps) {
    const [question, setQuestion] = useState(initialQuestion);

    return (
        <form
            className="question-form"
            onSubmit={(event) => {
                event.preventDefault();
                const trimmed = question.trim();
                if (trimmed === "" || pending) return;
                onAsk(trimmed);
            }}
        >
            <label className="question-form__label" htmlFor="workbench-question">
                Ask Context Fabric
            </label>
            <div className="question-form__row">
                <input
                    className="question-form__input"
                    id="workbench-question"
                    name="question"
                    type="text"
                    autoComplete="off"
                    disabled={pending}
                    value={question}
                    placeholder="What is the actual status of the dev-health-ops project, and what are the current drivers?"
                    onChange={(event) => setQuestion(event.target.value)}
                />
                <button className="question-form__submit" type="submit" disabled={pending}>
                    {pending ? "Investigating…" : "Investigate"}
                </button>
            </div>
            <p className="question-form__hint">
                Every answer comes from a real ACR investigation. The Workbench never renders a mock
                result.
            </p>
        </form>
    );
}
