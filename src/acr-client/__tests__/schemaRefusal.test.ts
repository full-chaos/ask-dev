import { describe, expect, it } from "vitest";

import { schemaRefusal } from "../schemaRefusal";

// CHAOS-12593: the place and the rule of a refusal, from the validator's own first error. Never a
// value of the refused document.

const refused = (errors: unknown) => Object.assign(() => false, { errors });

describe("schemaRefusal", () => {
    it("names the property an additionalProperties refusal does not allow", () => {
        expect(
            schemaRefusal(
                refused([
                    {
                        instancePath: "/claimed_facts/0/table",
                        schemaPath: "#/additionalProperties",
                        keyword: "additionalProperties",
                        params: { additionalProperty: "measure_units" },
                    },
                    { instancePath: "/claimed_facts/1/table", keyword: "additionalProperties" },
                ]),
            ),
        ).toEqual({
            path: "/claimed_facts/0/table",
            keyword: "additionalProperties",
            schema_path: "#/additionalProperties",
            additional_property: "measure_units",
            error_count: 2,
        });
    });

    it("names no property for another keyword, whatever its params hold", () => {
        expect(
            schemaRefusal(
                refused([
                    {
                        instancePath: "/status",
                        schemaPath: "#/properties/status/enum",
                        keyword: "enum",
                        params: { additionalProperty: "not this", allowedValues: ["complete"] },
                    },
                ]),
            ),
        ).toEqual({
            path: "/status",
            keyword: "enum",
            schema_path: "#/properties/status/enum",
            error_count: 1,
        });
    });

    it("is an empty refusal for a validator that kept no errors", () => {
        expect(schemaRefusal(() => false)).toEqual({
            path: "",
            keyword: "",
            schema_path: "",
            error_count: 0,
        });
        expect(schemaRefusal(refused("not a list"))).toEqual({
            path: "",
            keyword: "",
            schema_path: "",
            error_count: 0,
        });
    });
});
