import type { InvestigationResult } from "@/lib/contracts";

/**
 * CHAOS-5672: renders ACR's `semantic_reading` disclosure on a STORED
 * clarification read back by id.
 *
 * ACR checks a stored clarification against the reading of the question it was
 * produced under. When that reading cannot be loaded, the row is served as it
 * was stored and the check could not be made, so this workbench says so beside
 * the options: they may not answer the question, and asking again starts a
 * fresh investigation. Absent field, no notice -- ACR sets it only when the
 * check was needed and could not run.
 */
export function SemanticReadingNotice({
    semanticReading,
}: {
    semanticReading: InvestigationResult["semantic_reading"];
}) {
    if (semanticReading === undefined || semanticReading.status !== "unavailable") return null;
    const cause =
        semanticReading.reason === "semantic_state_absent"
            ? "no stored reading of the question is available for it"
            : "its stored reading of the question could not be read";
    return (
        <p role="note" data-semantic-reading={semanticReading.reason}>
            This clarification was stored earlier, and {cause}, so the service could not check
            whether these options still answer the question. Ask the question again to start a fresh
            investigation.
        </p>
    );
}
