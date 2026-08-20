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
const TRAILING_PUNCTUATION = /[.,;:]+$/;

/**
 * Peels sentence-level noise off the end of a matched URL: an unbalanced
 * trailing `)` (closing a sentence's own parenthetical, not the URL's own),
 * then unambiguous trailing punctuation — repeated, since either can expose
 * the other (`"...(mathematics))."` needs both peeled, more than once).
 */
function stripTrailingNoise(matchedUrl: string): string {
    let url = matchedUrl;
    for (;;) {
        if (url.endsWith(")")) {
            const opens = (url.match(/\(/g) ?? []).length;
            const closes = (url.match(/\)/g) ?? []).length;
            if (closes > opens) {
                url = url.slice(0, -1);
                continue;
            }
        }
        const trailing = TRAILING_PUNCTUATION.exec(url);
        if (trailing !== null) {
            url = url.slice(0, url.length - trailing[0].length);
            continue;
        }
        break;
    }
    return url;
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
