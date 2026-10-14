/**
 * A part of the answer the Workbench withheld (typed `rankingWithheld`
 * marker). Distinct from an empty part: "withheld" is unknown to this view,
 * never "none reported" and never healthy.
 */
export function WithheldPart({ label }: { readonly label: string }) {
    return (
        <p className="panel__empty" data-testid="withheld-part">
            {`${label} withheld by the Workbench: this answer covers subjects of a kind this view does not rank. It is not reported as none.`}
        </p>
    );
}
