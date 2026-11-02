import { useVocabularyWord } from "./VocabularyWordContext";
import type { ClaimedFact } from "../lib/contracts";
import { rawText } from "../lib/presentation";

/**
 * How a derived number was made (CHAOS-12516): its operation and each input. ACR's rule attaches no
 * rows to a derived claim, so this is the only trace of its inputs. An input reads ACR's word for
 * its field. ACR serves no word for the operation, so it stays raw, and this line stays in a fold.
 */
export function DerivationInputs({ claim }: { readonly claim: ClaimedFact }) {
    const word = useVocabularyWord();
    const inputs: unknown = claim.derived_from;
    if (!Array.isArray(inputs)) return null;
    const fields = inputs
        .map((input: { readonly field?: unknown } | null) => input?.field)
        .filter((field): field is string => typeof field === "string");
    if (fields.length === 0) return null;
    return (
        <span data-testid="claim-derivation">
            {" "}
            <code>
                {claim.operation === undefined ? null : (
                    <>operation: {rawText(claim.operation)}; </>
                )}
                derived_from: {fields.map((field) => word("fact_field", field)).join(", ")}
            </code>
        </span>
    );
}
