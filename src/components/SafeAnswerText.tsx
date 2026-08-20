import { Fragment } from "react";

export type SafeAnswerTextProps = {
    readonly text: string;
};

// Bare URLs only. The pinned contract's prose fields (deterministic_answer,
// direct_judgment, current_state, driver/finding summaries) are plain
// sentences today — verified against the pinned canonical example and every
// test fixture in src/test/fixtures/. No code fence, list marker, or table
// syntax appears anywhere in them, so this stays a plain-text-plus-links
// renderer instead of a markdown parser that would be guessing at a syntax
// the service has never emitted.
const URL_PATTERN = /https?:\/\/[^\s<>")]+/g;
// Trailing sentence punctuation a URL regex has no way to know isn't part of
// the URL — "https://x.example/y." ends a sentence, not a path segment.
// Stripped from the match and put back as ordinary trailing text.
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

function linkifyLine(line: string, keyPrefix: string) {
    const nodes: React.ReactNode[] = [];
    let lastIndex = 0;
    let matchIndex = 0;
    for (const match of line.matchAll(URL_PATTERN)) {
        const start = match.index;
        if (start > lastIndex) {
            nodes.push(
                <Fragment key={`${keyPrefix}-t${matchIndex}`}>
                    {line.slice(lastIndex, start)}
                </Fragment>,
            );
        }
        const trailingPunctuation = TRAILING_PUNCTUATION.exec(match[0])?.[0] ?? "";
        const url = match[0].slice(0, match[0].length - trailingPunctuation.length);
        nodes.push(
            <a
                href={url}
                key={`${keyPrefix}-l${matchIndex}`}
                rel="noreferrer noopener"
                target="_blank"
            >
                {url}
            </a>,
        );
        if (trailingPunctuation !== "") {
            nodes.push(
                <Fragment key={`${keyPrefix}-p${matchIndex}`}>{trailingPunctuation}</Fragment>,
            );
        }
        lastIndex = start + match[0].length;
        matchIndex += 1;
    }
    if (lastIndex < line.length) {
        nodes.push(<Fragment key={`${keyPrefix}-tail`}>{line.slice(lastIndex)}</Fragment>);
    }
    return nodes;
}

/**
 * Renders service-authored prose as safe inline React nodes: a real line
 * break for each `\n` the service sends, and a bare URL turned into a real,
 * `noreferrer noopener` link — never `dangerouslySetInnerHTML` (the same
 * boundary the M3 enrichment library holds, applied here to text that is
 * live today). See the module comment above for why no markdown syntax is
 * parsed.
 *
 * Embed this INSIDE an existing block element (a `<p>`); it renders no
 * block element of its own, so it never produces invalid `<p>`-in-`<p>`
 * nesting at a call site that already wraps it in one.
 */
export function SafeAnswerText({ text }: SafeAnswerTextProps) {
    const lines = text.split("\n");
    return (
        <>
            {lines.map((line, index) => (
                <Fragment key={index}>
                    {index > 0 ? <br /> : null}
                    {linkifyLine(line, String(index))}
                </Fragment>
            ))}
        </>
    );
}
