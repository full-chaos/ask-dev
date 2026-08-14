import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The composition-producer inventory (X3).
 *
 * The closure table records that the "model omits a non-mandatory section" seam
 * does not exist yet, because the only producer of a composition is
 * `buildComposition`. That claim was PROSE — an inventory nothing enforced, of
 * exactly the kind that goes stale silently while the row still reads
 * "structurally impossible".
 *
 * This enumerates producers from the source and asserts the inventory is
 * exactly `[buildComposition]`. Adding a model-authored producer fails HERE,
 * which is the re-verdict trigger the precondition promises rather than a
 * reminder someone has to remember.
 *
 * It is a source scan, so it is a heuristic, and worth being honest about what
 * it can and cannot see: it detects a new producer that either declares itself
 * as one (a `build*Composition` export) or embeds a literal OpenUI Lang program.
 * A producer that did neither — assembling a composition from fragments under
 * an unrelated name — would evade it. That is the residual, named rather than
 * papered over; the exact-inventory assertion still forces a deliberate change
 * for every ordinary way of adding one.
 */

const SOURCE_ROOT = path.resolve(import.meta.dirname, "../..");

/** Test scope is exempt: the R6 test-scope library and fixtures build compositions. */
function isTestFile(file: string): boolean {
    return /\.test\.[cm]?tsx?$/u.test(file);
}

function sourceFiles(directory: string): readonly string[] {
    return readdirSync(directory).flatMap((entry) => {
        const full = path.join(directory, entry);
        if (statSync(full).isDirectory()) {
            // Generated contract artifacts are copied wire data, never code.
            return entry === "contracts" ? [] : sourceFiles(full);
        }
        return /\.[cm]?tsx?$/u.test(entry) && !isTestFile(entry) ? [full] : [];
    });
}

/** A literal OpenUI Lang program: `root = <Component>(`. */
const LITERAL_COMPOSITION = /\broot\s*=\s*[A-Z][A-Za-z0-9]*\(/u;
/**
 * A self-declared producer: `export function build...Composition(`.
 *
 * GLOBAL, deliberately. A non-global `exec` returns only the FIRST match per
 * file, so a second producer added to the SAME module was invisible — the
 * inventory would have kept reporting one producer while two existed. Found by
 * mutation: adding a second producer to compose.ts passed until this was fixed.
 */
const PRODUCER_EXPORT = /export\s+(?:async\s+)?function\s+(build[A-Za-z0-9]*Composition)\b/gu;

describe("composition producers", () => {
    const files = sourceFiles(SOURCE_ROOT);

    it("finds source to scan, so an empty sweep cannot pass vacuously", () => {
        expect(files.length).toBeGreaterThan(10);
    });

    it("has exactly one producer, and it is buildComposition", () => {
        const producers = files.flatMap((file) =>
            [...readFileSync(file, "utf8").matchAll(PRODUCER_EXPORT)].map(
                (match) => `${path.relative(SOURCE_ROOT, file)}:${match[1]!}`,
            ),
        );

        expect(producers).toEqual(["lib/enrichment/compose.ts:buildComposition"]);
    });

    /**
     * A literal program in product code would be a composition nobody built —
     * the same seam by another route, and invisible to the export check above.
     */
    it("embeds no literal composition in product code", () => {
        const offenders = files
            .filter((file) => LITERAL_COMPOSITION.test(readFileSync(file, "utf8")))
            .map((file) => path.relative(SOURCE_ROOT, file));

        expect(offenders).toEqual([]);
    });

    /**
     * The scan must be able to SEE a producer, or the two assertions above
     * would pass just as happily against a broken regex. Both patterns are
     * exercised against known-positive text.
     */
    it("detects both producer shapes when they are present", () => {
        const matches = (source: string) => [...source.matchAll(PRODUCER_EXPORT)].length;

        expect(matches("export function buildAnswerComposition(x: string) {")).toBe(1);
        expect(matches("export function unrelatedHelper() {")).toBe(0);
        // TWO producers in one module must count as two — the hole mutation
        // testing exposed.
        expect(
            matches(
                "export function buildAComposition() {}\nexport function buildBComposition() {}",
            ),
        ).toBe(2);
        expect(LITERAL_COMPOSITION.test('const c = `root = Answer("@result.x", [])`;')).toBe(true);
    });
});
