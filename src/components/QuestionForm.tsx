import { useState } from "react";

export type QuestionFormProps = {
    readonly initialQuestion: string;
    readonly suggestions: readonly { readonly id: string; readonly question: string }[];
    readonly onAsk: (question: string) => void;
};

export function QuestionForm({ initialQuestion, suggestions, onAsk }: QuestionFormProps) {
    const [question, setQuestion] = useState(initialQuestion);

    function submit(value: string) {
        const trimmed = value.trim();
        if (trimmed === "") return;
        setQuestion(trimmed);
        onAsk(trimmed);
    }

    return (
        <form
            className="question-form"
            onSubmit={(event) => {
                event.preventDefault();
                submit(question);
            }}
        >
            <label className="question-form__label" htmlFor="ask-dev-question">
                Ask a question
            </label>
            <div className="question-form__row">
                <input
                    className="question-form__input"
                    id="ask-dev-question"
                    name="question"
                    type="text"
                    autoComplete="off"
                    value={question}
                    placeholder="Why is Ask Dev still not ready to ship?"
                    onChange={(event) => setQuestion(event.target.value)}
                />
                <button className="question-form__submit" type="submit">
                    Investigate
                </button>
            </div>
            <p className="question-form__hint">
                Answers come from committed mock fixtures derived from the pinned ACR contract
                examples. Nothing here reaches a live service.
            </p>
            <ul className="suggestions">
                {suggestions.map((suggestion) => (
                    <li key={suggestion.id}>
                        <button
                            className="suggestions__button"
                            type="button"
                            onClick={() => submit(suggestion.question)}
                        >
                            {suggestion.question}
                        </button>
                    </li>
                ))}
            </ul>
        </form>
    );
}
