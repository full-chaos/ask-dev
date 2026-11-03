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
// `)` is allowed in the match itself (stripped back out below only when it's
// NOT balanced by a `(` inside the same match) — excluding it outright would
// truncate a real URL like a Wikipedia "_(disambiguator)" path (codex review
// round 1, finding 1).
const URL_PATTERN = /https?:\/\/[^\s<>"]+/g;
// Unambiguous sentence-enders only. `!` and `?` are deliberately EXCLUDED —
// both are common, meaningful trailing URL characters (a query flag, a path
// segment), and stripping them on the strength of a regex guess broke a URL
// that legitimately ended in `!` (codex review round 1, finding 2). `.` `,`
// `;` `:` essentially never end a real URL, so those stay safe to strip.
const TRAILING_PUNCTUATION = ".,;:";

/**
 * Peels sentence-level noise off the end of a matched URL: an unbalanced
 * trailing `)` (closing a sentence's own parenthetical, not the URL's own),
 * then unambiguous trailing punctuation — repeated, since either can expose
 * the other (`"...(mathematics))."` needs both peeled, more than once).
 */
function stripTrailingNoise(matchedUrl: string): string {
    // One pass to count the parentheses, then one step back per peeled character, so the work is
    // linear in the URL's length. Recounting per peeled `)`, or the regex `/[.,;:]+$/`, is
    // quadratic on a long run inside a URL (CodeQL js/polynomial-redos, CHAOS-12559).
    let opens = 0;
    let closes = 0;
    for (let index = 0; index < matchedUrl.length; index += 1) {
        const char = matchedUrl.charAt(index);
        if (char === "(") opens += 1;
        else if (char === ")") closes += 1;
    }
    let end = matchedUrl.length;
    while (end > 0) {
        const last = matchedUrl.charAt(end - 1);
        if (last === ")" && closes > opens) {
            closes -= 1;
        } else if (!TRAILING_PUNCTUATION.includes(last)) {
            break;
        }
        end -= 1;
    }
    return matchedUrl.slice(0, end);
}

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
        const url = stripTrailingNoise(match[0]);
        const trailingNoise = match[0].slice(url.length);
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
        if (trailingNoise !== "") {
            nodes.push(<Fragment key={`${keyPrefix}-p${matchIndex}`}>{trailingNoise}</Fragment>);
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
