import { describe, expect, it } from "vitest";

import {
    EMPTY_STRUCTURE_SELECTION_BATCH,
    buildStructureReceiptFields,
    deselectStructureOffer,
    selectStructureOffer,
    structureReceiptHasExpectedNamespace,
    structureSelectionCount,
} from "@/lib/structure-selections";

const KIND_RECEIPT = {
    result_id: "result_0000000000000001",
    receipt_id: "kindr_pull_request_0001",
};
const ANCHOR_RECEIPT = { result_id: "result_0000000000000001", receipt_id: "ancr_repo_atlas_0001" };

describe("selectStructureOffer / deselectStructureOffer", () => {
    it("records a pick per member without disturbing other members", () => {
        const batch = selectStructureOffer(
            selectStructureOffer(EMPTY_STRUCTURE_SELECTION_BATCH, "expected_kind", KIND_RECEIPT),
            "subject_anchor",
            ANCHOR_RECEIPT,
        );

        expect(batch).toEqual({ expected_kind: KIND_RECEIPT, subject_anchor: ANCHOR_RECEIPT });
        expect(structureSelectionCount(batch)).toBe(2);
    });

    it("replaces a member's prior pick rather than accumulating a second one", () => {
        const other = {
            result_id: "result_0000000000000001",
            receipt_id: "kindr_ci_pipeline_run_0001",
        };
        const batch = selectStructureOffer(
            selectStructureOffer(EMPTY_STRUCTURE_SELECTION_BATCH, "expected_kind", KIND_RECEIPT),
            "expected_kind",
            other,
        );

        expect(batch).toEqual({ expected_kind: other });
        expect(structureSelectionCount(batch)).toBe(1);
    });

    it("withdraws a member's pick, and no-ops when there was none", () => {
        const withPick = selectStructureOffer(
            EMPTY_STRUCTURE_SELECTION_BATCH,
            "expected_kind",
            KIND_RECEIPT,
        );

        expect(deselectStructureOffer(withPick, "expected_kind")).toEqual({});
        expect(deselectStructureOffer(EMPTY_STRUCTURE_SELECTION_BATCH, "window")).toBe(
            EMPTY_STRUCTURE_SELECTION_BATCH,
        );
    });
});

describe("structureReceiptHasExpectedNamespace", () => {
    it("accepts a receipt in its member's own namespace", () => {
        expect(structureReceiptHasExpectedNamespace("expected_kind", KIND_RECEIPT)).toBe(true);
        expect(structureReceiptHasExpectedNamespace("subject_anchor", ANCHOR_RECEIPT)).toBe(true);
    });

    it("rejects a receipt namespaced for a different member", () => {
        expect(structureReceiptHasExpectedNamespace("subject_anchor", KIND_RECEIPT)).toBe(false);
        expect(structureReceiptHasExpectedNamespace("expected_kind", ANCHOR_RECEIPT)).toBe(false);
    });
});

describe("buildStructureReceiptFields", () => {
    it("builds an empty field for every member with no selection", () => {
        expect(buildStructureReceiptFields(EMPTY_STRUCTURE_SELECTION_BATCH)).toEqual({
            priorKindReceipts: [],
            priorAnchorReceipts: [],
            priorHandleReceipts: [],
            priorWindowReceipts: [],
        });
    });

    it("routes each member's pick to its own field, leaving the others empty", () => {
        const batch = selectStructureOffer(
            EMPTY_STRUCTURE_SELECTION_BATCH,
            "expected_kind",
            KIND_RECEIPT,
        );

        expect(buildStructureReceiptFields(batch)).toEqual({
            priorKindReceipts: [KIND_RECEIPT],
            priorAnchorReceipts: [],
            priorHandleReceipts: [],
            priorWindowReceipts: [],
        });
    });

    it("carries every member's pick at once (accumulate-and-re-ask-ONCE, §2.2)", () => {
        const batch = selectStructureOffer(
            selectStructureOffer(EMPTY_STRUCTURE_SELECTION_BATCH, "expected_kind", KIND_RECEIPT),
            "subject_anchor",
            ANCHOR_RECEIPT,
        );

        const fields = buildStructureReceiptFields(batch);
        expect(fields.priorKindReceipts).toEqual([KIND_RECEIPT]);
        expect(fields.priorAnchorReceipts).toEqual([ANCHOR_RECEIPT]);
    });
});
