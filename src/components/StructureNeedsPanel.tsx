"use client";

import { useId, useState } from "react";

import { Badge } from "@/components/Badge";
import type {
    AnchorOption,
    BoundStructureReceipt,
    CandidateOption,
    HandleOption,
    KindOption,
    StructureNeedKind,
    StructureNeeds,
    WindowOption,
} from "@/lib/contracts";
import {
    structureReceiptHasExpectedNamespace,
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
 *     window — §1.2 reading 1; `subject_candidate` (CHAOS-4012) is appended
 *     last, never reordering the other four);
 *   - never mints an offer the result did not carry;
 *   - never turns free text into a discriminator — every prompt here is a
 *     tap on a typed offer, carried back as ACR's own receipt, never a
 *     re-typed value (§2.1: "offers are typed and receipt-bound").
 *
 * Selections accumulate (accumulate-and-re-ask-ONCE, §2.2): picking a kind
 * and then a window does not re-ask after the kind pick. Only the "Ask
 * again with these selections" action calls `onConfirm` once, with every
 * pick made so far across every member.
 *
 * `batch` is a CONTROLLED prop, not local state (codex round 3): this panel
 * is rendered as two separate instances — one in the raw inspector view, one
 * inside `DeterministicAnswerView` — and a tester switching between them
 * mid-selection must not lose their picks the way `ClarificationPanel`'s own
 * "reachable from every view" rule already guards against for the subject
 * choice. The caller (page.tsx) owns the batch in shared state and passes
 * the SAME value to both instances.
 */
export type StructureNeedsPanelProps = {
    /** The issuing result's own id — every receipt below is bound to it, never to the option. */
    readonly resultId: string;
    readonly structureNeeds: StructureNeeds;
    /** The selections made so far for THIS result, owned by the caller. */
    readonly batch: StructureSelectionBatch;
    /** Called after the namespace guard passes; the caller applies the toggle. */
    readonly onToggle: (member: StructureNeedKind, receipt: BoundStructureReceipt) => void;
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
    /** Absent when the surrounding surface cannot re-ask, mirroring ClarificationPanel's own CandidateRecord. */
    onToggle,
}: {
    readonly optionId: string;
    readonly receiptId: string;
    readonly label: string;
    readonly selected: boolean;
    readonly pending: boolean;
    readonly onToggle: (() => void) | undefined;
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
            {onToggle === undefined ? null : (
                <button
                    aria-pressed={selected}
                    className="question-form__submit"
                    disabled={pending}
                    onClick={onToggle}
                    type="button"
                >
                    {selected ? `Unselect ${label}` : `Select ${label}`}
                </button>
            )}
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
    readonly onToggle: ((option: KindOption) => void) | undefined;
}) {
    return (
        <ul className="stack">
            {options.map((option) => (
                <OfferButton
                    key={option.option_id}
                    label={option.label}
                    onToggle={
                        onToggle === undefined
                            ? undefined
                            : () => {
                                  onToggle(option);
                              }
                    }
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
    readonly onToggle: ((option: AnchorOption) => void) | undefined;
}) {
    return (
        <ul className="stack">
            {options.map((option) => (
                <OfferButton
                    key={option.option_id}
                    label={option.label}
                    onToggle={
                        onToggle === undefined
                            ? undefined
                            : () => {
                                  onToggle(option);
                              }
                    }
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
    readonly onToggle: ((option: HandleOption) => void) | undefined;
}) {
    return (
        <ul className="stack">
            {options.map((option) => (
                <OfferButton
                    key={option.option_id}
                    label={option.label}
                    onToggle={
                        onToggle === undefined
                            ? undefined
                            : () => {
                                  onToggle(option);
                              }
                    }
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
    readonly onToggle: ((option: WindowOption) => void) | undefined;
}) {
    return (
        <ul className="stack">
            {options.map((option) => (
                <OfferButton
                    key={option.option_id}
                    label={option.label}
                    onToggle={
                        onToggle === undefined
                            ? undefined
                            : () => {
                                  onToggle(option);
                              }
                    }
                    optionId={option.option_id}
                    pending={pending}
                    receiptId={option.receipt_id}
                    selected={selectedReceiptId === option.receipt_id}
                />
            ))}
        </ul>
    );
}

function CandidateOptionsSection({
    options,
    selectedReceiptId,
    pending,
    onToggle,
}: {
    readonly options: readonly CandidateOption[];
    readonly selectedReceiptId: string | undefined;
    readonly pending: boolean;
    readonly onToggle: ((option: CandidateOption) => void) | undefined;
}) {
    return (
        <ul className="stack">
            {options.map((option) => (
                <OfferButton
                    key={option.option_id}
                    label={option.label}
                    onToggle={
                        onToggle === undefined
                            ? undefined
                            : () => {
                                  onToggle(option);
                              }
                    }
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
    subject_candidate: "Did you mean one of these?",
};

export function StructureNeedsPanel({
    resultId,
    structureNeeds,
    batch,
    onToggle,
    onConfirm,
    pending = false,
}: StructureNeedsPanelProps) {
    // Portability (team-lead): the panel must be safe to mount more than
    // once at a time (a future conversational surface can show this offer
    // set across several message turns), so every heading id is instance-
    // scoped via useId() rather than the hardcoded string ids an earlier
    // version used — those broke `aria-labelledby` the moment two
    // instances shared the DOM.
    const idPrefix = useId();
    // codex round 2: a rejected click must not look like nothing happened —
    // a click that silently does nothing is indistinguishable from the UI
    // being broken. Surfaced, not just logged. This is the only state this
    // component still owns locally (codex round 3: `batch` moved to the
    // caller so it survives a view switch; a namespace-mismatch message is
    // legitimately per-instance transient UI feedback, not selection data).
    const [namespaceError, setNamespaceError] = useState<string | undefined>(undefined);

    /**
     * Eagerly checked, not just documented: a receipt from the wrong
     * member's offer list (a wiring bug this component's own call sites
     * should make structurally unreachable, but "should" is not "is") is
     * rejected HERE — where the mistake was made — rather than reaching the
     * wire and being silently rejected by the engine's own validation
     * (§2.5). See `structureReceiptHasExpectedNamespace`'s own doc comment.
     */
    function toggle(member: StructureNeedKind, receipt: BoundStructureReceipt) {
        if (!structureReceiptHasExpectedNamespace(member, receipt)) {
            const message = `That offer's receipt is not valid for ${structureMemberLabel(member)} and could not be selected. This is a Workbench bug, not something you did — please report it.`;
            console.error(
                `StructureNeedsPanel: receipt ${receipt.receipt_id} is not in the ${member} namespace; ignoring the selection.`,
            );
            setNamespaceError(message);
            return;
        }
        setNamespaceError(undefined);
        onToggle(member, receipt);
    }

    const kindOptions = structureNeeds.kind_options ?? [];
    const anchorOptions = structureNeeds.anchor_options ?? [];
    const handleOptions = structureNeeds.handle_options ?? [];
    const windowOptions = structureNeeds.window_options ?? [];
    const candidateOptions = structureNeeds.candidate_options ?? [];

    return (
        <section aria-labelledby={`${idPrefix}-needs-title`} className="panel">
            <h2 className="panel__title" id={`${idPrefix}-needs-title`}>
                More structure would narrow this
            </h2>
            <p className="record__meta">
                ACR named {structureNeeds.missing.length}{" "}
                {structureNeeds.missing.length === 1 ? "thing" : "things"} it needs to answer
                decisively:{" "}
                {structureNeeds.missing.map((member) => structureMemberLabel(member)).join(", ")}.
            </p>

            {structureNeeds.missing.includes("expected_kind") ? (
                <section aria-labelledby={`${idPrefix}-kind-title`}>
                    <h3 className="panel__title" id={`${idPrefix}-kind-title`}>
                        {PROMPT_TITLE.expected_kind}
                    </h3>
                    {kindOptions.length === 0 ? (
                        <p className="panel__empty">No kind offers were provided.</p>
                    ) : (
                        <KindOptionsSection
                            onToggle={
                                onConfirm === undefined
                                    ? undefined
                                    : (option) => {
                                          toggle("expected_kind", {
                                              result_id: resultId,
                                              receipt_id: option.receipt_id,
                                          });
                                      }
                            }
                            options={kindOptions}
                            pending={pending}
                            selectedReceiptId={batch.expected_kind?.receipt_id}
                        />
                    )}
                </section>
            ) : null}

            {structureNeeds.missing.includes("subject_anchor") ? (
                <section aria-labelledby={`${idPrefix}-anchor-title`}>
                    <h3 className="panel__title" id={`${idPrefix}-anchor-title`}>
                        {PROMPT_TITLE.subject_anchor}
                    </h3>
                    {anchorOptions.length === 0 ? (
                        <p className="panel__empty">No anchor offers were provided.</p>
                    ) : (
                        <AnchorOptionsSection
                            onToggle={
                                onConfirm === undefined
                                    ? undefined
                                    : (option) => {
                                          toggle("subject_anchor", {
                                              result_id: resultId,
                                              receipt_id: option.receipt_id,
                                          });
                                      }
                            }
                            options={anchorOptions}
                            pending={pending}
                            selectedReceiptId={batch.subject_anchor?.receipt_id}
                        />
                    )}
                </section>
            ) : null}

            {structureNeeds.missing.includes("subject_handle") ? (
                <section aria-labelledby={`${idPrefix}-handle-title`}>
                    <h3 className="panel__title" id={`${idPrefix}-handle-title`}>
                        {PROMPT_TITLE.subject_handle}
                    </h3>
                    {handleOptions.length === 0 ? (
                        <p className="panel__empty">No handle offers were provided.</p>
                    ) : (
                        <HandleOptionsSection
                            onToggle={
                                onConfirm === undefined
                                    ? undefined
                                    : (option) => {
                                          toggle("subject_handle", {
                                              result_id: resultId,
                                              receipt_id: option.receipt_id,
                                          });
                                      }
                            }
                            options={handleOptions}
                            pending={pending}
                            selectedReceiptId={batch.subject_handle?.receipt_id}
                        />
                    )}
                </section>
            ) : null}

            {structureNeeds.missing.includes("window") ? (
                <section aria-labelledby={`${idPrefix}-window-title`}>
                    <h3 className="panel__title" id={`${idPrefix}-window-title`}>
                        {PROMPT_TITLE.window}
                    </h3>
                    {windowOptions.length === 0 ? (
                        <p className="panel__empty">No window offers were provided.</p>
                    ) : (
                        <WindowOptionsSection
                            onToggle={
                                onConfirm === undefined
                                    ? undefined
                                    : (option) => {
                                          toggle("window", {
                                              result_id: resultId,
                                              receipt_id: option.receipt_id,
                                          });
                                      }
                            }
                            options={windowOptions}
                            pending={pending}
                            selectedReceiptId={batch.window?.receipt_id}
                        />
                    )}
                </section>
            ) : null}

            {structureNeeds.missing.includes("subject_candidate") ? (
                <section aria-labelledby={`${idPrefix}-candidate-title`}>
                    <h3 className="panel__title" id={`${idPrefix}-candidate-title`}>
                        {PROMPT_TITLE.subject_candidate}
                    </h3>
                    {candidateOptions.length === 0 ? (
                        <p className="panel__empty">No candidate offers were provided.</p>
                    ) : (
                        <CandidateOptionsSection
                            onToggle={
                                onConfirm === undefined
                                    ? undefined
                                    : (option) => {
                                          toggle("subject_candidate", {
                                              result_id: resultId,
                                              receipt_id: option.receipt_id,
                                          });
                                      }
                            }
                            options={candidateOptions}
                            pending={pending}
                            selectedReceiptId={batch.subject_candidate?.receipt_id}
                        />
                    )}
                </section>
            ) : null}

            {namespaceError === undefined ? null : (
                <p className="record__meta" role="alert">
                    {namespaceError}
                </p>
            )}

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
