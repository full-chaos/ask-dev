"use client";

import { useState } from "react";

import { Badge } from "@/components/Badge";
import type {
    AcceptedGrammar,
    AnchorOption,
    BoundStructureReceipt,
    HandleOption,
    KindOption,
    StructureNeedKind,
    StructureNeeds,
    WindowOption,
} from "@/lib/contracts";
import { humanizeTerm } from "@/lib/presentation";
import {
    EMPTY_STRUCTURE_SELECTION_BATCH,
    deselectStructureOffer,
    selectStructureOffer,
    structureSelectionCount,
    type StructureSelectionBatch,
} from "@/lib/structure-selections";
import { structureMemberLabel } from "@/lib/structure-disposition";

/**
 * Guided structure-elicitation prompts (CHAOS-3927 P2, design brief §2.2).
 *
 * When an investigation ends short of decisive, ACR may name which
 * intent-frame members are missing (`structure_needs.missing`) and offer
 * typed, receipt-bound completions for each: which kind of thing, which
 * repository/project/team, which handle, which time period. This panel
 * renders EXACTLY what the result carries — same rule ClarificationPanel
 * already holds for subject candidates:
 *
 *   - never re-ranks or filters offers (rendered in the result's own order,
 *     `missing`'s own elicitation-priority ordering: kind, anchor, handle,
 *     window — §1.2 reading 1);
 *   - never mints an offer the result did not carry;
 *   - never turns free text into a discriminator — every prompt here is a
 *     tap on a typed offer, carried back as ACR's own receipt, never a
 *     re-typed value (§2.1: "offers are typed and receipt-bound").
 *
 * Selections accumulate LOCALLY (accumulate-and-re-ask-ONCE, §2.2): picking
 * a kind and then a window does not re-ask after the kind pick. Only the
 * "Confirm selections" action calls `onConfirm` once, with every pick made
 * so far across every member.
 */
export type StructureNeedsPanelProps = {
    /** The issuing result's own id — every receipt below is bound to it, never to the option. */
    readonly resultId: string;
    readonly structureNeeds: StructureNeeds;
    /** Absent when the surrounding surface cannot re-ask, mirroring ClarificationPanel. */
    readonly onConfirm?: ((batch: StructureSelectionBatch) => void) | undefined;
    readonly pending?: boolean | undefined;
};

function OfferButton({
    optionId,
    receiptId,
    label,
    selected,
    pending,
    onToggle,
}: {
    readonly optionId: string;
    readonly receiptId: string;
    readonly label: string;
    readonly selected: boolean;
    readonly pending: boolean;
    readonly onToggle: () => void;
}) {
    return (
        <li className="record" key={optionId}>
            <div className="record__head">
                <span className="record__title">{label}</span>
                {selected ? (
                    <Badge tone="ok" title="selected">
                        selected
                    </Badge>
                ) : null}
            </div>
            <p className="record__meta">
                receipt <code>{receiptId}</code>
            </p>
            <button
                aria-pressed={selected}
                className="question-form__submit"
                disabled={pending}
                onClick={onToggle}
                type="button"
            >
                {selected ? `Unselect ${label}` : `Select ${label}`}
            </button>
        </li>
    );
}

function KindOptionsSection({
    options,
    selectedReceiptId,
    pending,
    onToggle,
}: {
    readonly options: readonly KindOption[];
    readonly selectedReceiptId: string | undefined;
    readonly pending: boolean;
    readonly onToggle: (option: KindOption) => void;
}) {
    return (
        <ul className="stack">
            {options.map((option) => (
                <OfferButton
                    key={option.option_id}
                    label={option.label}
                    onToggle={() => {
                        onToggle(option);
                    }}
                    optionId={option.option_id}
                    pending={pending}
                    receiptId={option.receipt_id}
                    selected={selectedReceiptId === option.receipt_id}
                />
            ))}
        </ul>
    );
}

function AnchorOptionsSection({
    options,
    selectedReceiptId,
    pending,
    onToggle,
}: {
    readonly options: readonly AnchorOption[];
    readonly selectedReceiptId: string | undefined;
    readonly pending: boolean;
    readonly onToggle: (option: AnchorOption) => void;
}) {
    return (
        <ul className="stack">
            {options.map((option) => (
                <OfferButton
                    key={option.option_id}
                    label={option.label}
                    onToggle={() => {
                        onToggle(option);
                    }}
                    optionId={option.option_id}
                    pending={pending}
                    receiptId={option.receipt_id}
                    selected={selectedReceiptId === option.receipt_id}
                />
            ))}
        </ul>
    );
}

function HandleOptionsSection({
    options,
    selectedReceiptId,
    pending,
    onToggle,
}: {
    readonly options: readonly HandleOption[];
    readonly selectedReceiptId: string | undefined;
    readonly pending: boolean;
    readonly onToggle: (option: HandleOption) => void;
}) {
    return (
        <ul className="stack">
            {options.map((option) => (
                <OfferButton
                    key={option.option_id}
                    label={option.label}
                    onToggle={() => {
                        onToggle(option);
                    }}
                    optionId={option.option_id}
                    pending={pending}
                    receiptId={option.receipt_id}
                    selected={selectedReceiptId === option.receipt_id}
                />
            ))}
        </ul>
    );
}

function WindowOptionsSection({
    options,
    selectedReceiptId,
    pending,
    onToggle,
}: {
    readonly options: readonly WindowOption[];
    readonly selectedReceiptId: string | undefined;
    readonly pending: boolean;
    readonly onToggle: (option: WindowOption) => void;
}) {
    return (
        <ul className="stack">
            {options.map((option) => (
                <OfferButton
                    key={option.option_id}
                    label={option.label}
                    onToggle={() => {
                        onToggle(option);
                    }}
                    optionId={option.option_id}
                    pending={pending}
                    receiptId={option.receipt_id}
                    selected={selectedReceiptId === option.receipt_id}
                />
            ))}
        </ul>
    );
}

const PROMPT_TITLE: Record<StructureNeedKind, string> = {
    expected_kind: "Which kind of thing is this about?",
    subject_anchor: "Which repository, project, or team?",
    subject_handle: "Which specific item?",
    window: "Over what period?",
};

function AcceptedGrammarsDisclosure({
    grammars,
}: {
    readonly grammars: readonly AcceptedGrammar[];
}) {
    if (grammars.length === 0) return null;
    return (
        <section aria-labelledby="structure-grammars-title" className="panel">
            <h3 className="panel__title" id="structure-grammars-title">
                Accepted for direct supply
            </h3>
            <p className="record__meta">
                ACR also accepts these typed values directly on the next question, instead of
                picking an offer above:
            </p>
            <ul className="stack stack--tight">
                {grammars.map((grammar) => (
                    <li className="record__meta" key={`${grammar.member}-${grammar.pattern_id}`}>
                        {humanizeTerm(grammar.member)}
                        {grammar.kind === undefined ? "" : ` (${grammar.kind})`}:{" "}
                        {grammar.pattern_id}
                    </li>
                ))}
            </ul>
        </section>
    );
}

export function StructureNeedsPanel({
    resultId,
    structureNeeds,
    onConfirm,
    pending = false,
}: StructureNeedsPanelProps) {
    const [batch, setBatch] = useState<StructureSelectionBatch>(EMPTY_STRUCTURE_SELECTION_BATCH);

    function toggle(member: StructureNeedKind, receipt: BoundStructureReceipt) {
        setBatch((current) =>
            current[member]?.receipt_id === receipt.receipt_id
                ? deselectStructureOffer(current, member)
                : selectStructureOffer(current, member, receipt),
        );
    }

    const kindOptions = structureNeeds.kind_options ?? [];
    const anchorOptions = structureNeeds.anchor_options ?? [];
    const handleOptions = structureNeeds.handle_options ?? [];
    const windowOptions = structureNeeds.window_options ?? [];
    const acceptedGrammars = structureNeeds.accepted_grammars ?? [];

    return (
        <section aria-labelledby="structure-needs-title" className="panel">
            <h2 className="panel__title" id="structure-needs-title">
                More structure would narrow this
            </h2>
            <p className="record__meta">
                ACR named {structureNeeds.missing.length}{" "}
                {structureNeeds.missing.length === 1 ? "thing" : "things"} it needs to answer
                decisively:{" "}
                {structureNeeds.missing.map((member) => structureMemberLabel(member)).join(", ")}.
            </p>

            {structureNeeds.missing.includes("expected_kind") ? (
                <section aria-labelledby="structure-kind-title">
                    <h3 className="panel__title" id="structure-kind-title">
                        {PROMPT_TITLE.expected_kind}
                    </h3>
                    {kindOptions.length === 0 ? (
                        <p className="panel__empty">No kind offers were provided.</p>
                    ) : (
                        <KindOptionsSection
                            onToggle={(option) => {
                                toggle("expected_kind", {
                                    result_id: resultId,
                                    receipt_id: option.receipt_id,
                                });
                            }}
                            options={kindOptions}
                            pending={pending}
                            selectedReceiptId={batch.expected_kind?.receipt_id}
                        />
                    )}
                </section>
            ) : null}

            {structureNeeds.missing.includes("subject_anchor") ? (
                <section aria-labelledby="structure-anchor-title">
                    <h3 className="panel__title" id="structure-anchor-title">
                        {PROMPT_TITLE.subject_anchor}
                    </h3>
                    {anchorOptions.length === 0 ? (
                        <p className="panel__empty">No anchor offers were provided.</p>
                    ) : (
                        <AnchorOptionsSection
                            onToggle={(option) => {
                                toggle("subject_anchor", {
                                    result_id: resultId,
                                    receipt_id: option.receipt_id,
                                });
                            }}
                            options={anchorOptions}
                            pending={pending}
                            selectedReceiptId={batch.subject_anchor?.receipt_id}
                        />
                    )}
                </section>
            ) : null}

            {structureNeeds.missing.includes("subject_handle") ? (
                <section aria-labelledby="structure-handle-title">
                    <h3 className="panel__title" id="structure-handle-title">
                        {PROMPT_TITLE.subject_handle}
                    </h3>
                    {handleOptions.length === 0 ? (
                        <p className="panel__empty">No handle offers were provided.</p>
                    ) : (
                        <HandleOptionsSection
                            onToggle={(option) => {
                                toggle("subject_handle", {
                                    result_id: resultId,
                                    receipt_id: option.receipt_id,
                                });
                            }}
                            options={handleOptions}
                            pending={pending}
                            selectedReceiptId={batch.subject_handle?.receipt_id}
                        />
                    )}
                </section>
            ) : null}

            {structureNeeds.missing.includes("window") ? (
                <section aria-labelledby="structure-window-title">
                    <h3 className="panel__title" id="structure-window-title">
                        {PROMPT_TITLE.window}
                    </h3>
                    {windowOptions.length === 0 ? (
                        <p className="panel__empty">No window offers were provided.</p>
                    ) : (
                        <WindowOptionsSection
                            onToggle={(option) => {
                                toggle("window", {
                                    result_id: resultId,
                                    receipt_id: option.receipt_id,
                                });
                            }}
                            options={windowOptions}
                            pending={pending}
                            selectedReceiptId={batch.window?.receipt_id}
                        />
                    )}
                </section>
            ) : null}

            <AcceptedGrammarsDisclosure grammars={acceptedGrammars} />

            {onConfirm === undefined ? (
                <p className="record__meta" data-testid="cannot-confirm-structure-here">
                    This context cannot re-ask, so the offers above are shown for inspection only.
                </p>
            ) : (
                <button
                    className="question-form__submit"
                    disabled={pending || structureSelectionCount(batch) === 0}
                    onClick={() => {
                        onConfirm(batch);
                    }}
                    type="button"
                >
                    Ask again with these selections
                </button>
            )}
        </section>
    );
}
