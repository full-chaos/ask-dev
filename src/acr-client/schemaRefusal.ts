/**
 * Where and by which rule a pinned contract refused a frame (CHAOS-12593, CHAOS-12590). It is read
 * from the validator's own `errors` (Ajv sets them beside a compiled validator after a refusal) and
 * names only the place and the rule: never a value of the refused document.
 */
export type SchemaRefusal = {
    readonly path: string;
    readonly keyword: string;
    readonly schema_path: string;
    /** The property name the schema does not allow, for `additionalProperties` only. */
    readonly additional_property?: string;
    readonly error_count: number;
};

type ValidatorError = {
    readonly instancePath?: unknown;
    readonly keyword?: unknown;
    readonly schemaPath?: unknown;
    readonly params?: { readonly additionalProperty?: unknown };
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The first error of a validator that just refused, or a refusal with no detail. */
export function schemaRefusal(validate: unknown): SchemaRefusal {
    const errors = (validate as { readonly errors?: unknown } | undefined)?.errors;
    const list: readonly ValidatorError[] = Array.isArray(errors)
        ? (errors as ValidatorError[])
        : [];
    const first = list[0];
    const property =
        first?.keyword === "additionalProperties" ? first.params?.additionalProperty : undefined;
    return {
        path: text(first?.instancePath),
        keyword: text(first?.keyword),
        schema_path: text(first?.schemaPath),
        ...(typeof property === "string" ? { additional_property: property } : {}),
        error_count: list.length,
    };
}
