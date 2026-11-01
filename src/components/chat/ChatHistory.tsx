"use client";

import { useState, type ReactNode } from "react";

import {
    CTA_LABELS,
    HISTORY_COPY,
    historyRowLabel,
    historyRowMeta,
    historyRowTitle,
} from "../../render/chat-copy";
import type { ChatHistoryRow, ChatHistorySnapshot, ChatHistorySource } from "../../render/source";

export type ChatHistoryProps = {
    readonly history: ChatHistorySnapshot;
    readonly source: ChatHistorySource;
    /** Opens a row: the caller also decides what the surface shows next. */
    readonly onOpen: (id: string) => void;
    /** The host's Connect affordance, called for the `connect` state only. */
    readonly renderConnect: () => ReactNode;
    /** Present where `rail__new` is not: draws web's "New conversation" button. */
    readonly onNew?: (() => void) | undefined;
};

function HistoryRow({
    history,
    row,
    source,
    onOpen,
}: Pick<ChatHistoryProps, "history" | "source" | "onOpen"> & { readonly row: ChatHistoryRow }) {
    const [confirming, setConfirming] = useState(false);
    const current = row.id === history.currentId;
    const title = historyRowTitle(row);
    const currentMark = current ? (
        <span className="rail__history-current">{HISTORY_COPY.current}</span>
    ) : null;
    return (
        <li
            className="rail__history-row"
            data-current={current ? "true" : undefined}
            data-testid="ask-dev-history-row"
            data-thread-id={row.id}
        >
            <div className="rail__history-line">
                <button
                    aria-current={current ? "true" : undefined}
                    className={current ? "rail__item rail__item--current" : "rail__item"}
                    data-testid="ask-dev-history-open"
                    onClick={() => {
                        onOpen(row.id);
                    }}
                    type="button"
                >
                    {title === null ? (
                        <>
                            {historyRowLabel(row)}
                            {currentMark}
                        </>
                    ) : (
                        <>
                            {/* Inert text, one line; the full question on hover or focus. */}
                            <span
                                className="rail__history-question"
                                data-testid="ask-dev-history-question"
                                title={title}
                            >
                                {title}
                            </span>
                            <span className="rail__item-meta" data-testid="ask-dev-history-meta">
                                {historyRowMeta(row)}
                                {currentMark}
                            </span>
                        </>
                    )}
                </button>
                {confirming ? null : (
                    <button
                        aria-label={CTA_LABELS.askDevDeleteConversation}
                        className="rail__icon-button"
                        data-testid="ask-dev-history-delete"
                        disabled={history.deleting.includes(row.id)}
                        onClick={() => {
                            setConfirming(true);
                        }}
                        title={CTA_LABELS.askDevDeleteConversation}
                        type="button"
                    >
                        <svg
                            aria-hidden="true"
                            fill="none"
                            height="16"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            viewBox="0 0 24 24"
                            width="16"
                        >
                            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6M10 11v6M14 11v6" />
                        </svg>
                    </button>
                )}
            </div>
            {confirming ? (
                <div className="rail__history-confirm" data-testid="ask-dev-history-confirm">
                    <p className="rail__note">{HISTORY_COPY.confirm}</p>
                    {current && history.running ? (
                        <p className="rail__note" data-testid="ask-dev-history-confirm-running">
                            {HISTORY_COPY.confirmRunning}
                        </p>
                    ) : null}
                    <div className="rail__history-actions">
                        <button
                            className="rail__button"
                            data-testid="ask-dev-history-confirm-delete"
                            onClick={() => {
                                setConfirming(false);
                                source.remove(row.id);
                            }}
                            type="button"
                        >
                            {CTA_LABELS.confirmDelete}
                        </button>
                        <button
                            className="rail__button"
                            data-testid="ask-dev-history-confirm-cancel"
                            onClick={() => {
                                setConfirming(false);
                            }}
                            type="button"
                        >
                            {CTA_LABELS.cancel}
                        </button>
                    </div>
                </div>
            ) : null}
            {history.deleteFailed === row.id ? (
                <p className="rail__note" data-testid="ask-dev-history-delete-failed">
                    {HISTORY_COPY.deleteFailed}
                </p>
            ) : null}
        </li>
    );
}

/**
 * The saved conversations: one component, drawn in the left rail and, where that rail is hidden, in
 * the chat column. It holds only a row's delete confirm: `ChatSurface` calls `load`, so drawing it
 * in another place does not read again. Ported from web's `AskDevHistory`, with its words, states
 * and test ids.
 */
export function ChatHistory({ history, source, onOpen, renderConnect, onNew }: ChatHistoryProps) {
    return (
        <section className="rail__section" data-testid="ask-dev-history">
            <div className="rail__history-head">
                <h2 className="rail__label">{HISTORY_COPY.title}</h2>
                {onNew === undefined ? null : (
                    <button
                        className="rail__button"
                        data-testid="ask-dev-history-new"
                        onClick={onNew}
                        type="button"
                    >
                        {CTA_LABELS.askDevNewConversation}
                    </button>
                )}
            </div>
            {history.status === "connect" ? (
                <div className="rail__history-block" data-testid="ask-dev-history-connect">
                    <p className="rail__note">{HISTORY_COPY.connect}</p>
                    {renderConnect()}
                </div>
            ) : null}
            {history.status === "read_failed" ? (
                <div className="rail__history-block" data-testid="ask-dev-history-read-failed">
                    <p className="rail__note">{HISTORY_COPY.readFailed}</p>
                    <button
                        className="rail__button"
                        data-testid="ask-dev-history-retry"
                        onClick={() => {
                            source.load();
                        }}
                        type="button"
                    >
                        {CTA_LABELS.tryAgain}
                    </button>
                </div>
            ) : null}
            {history.rows.length === 0 ? (
                history.status === "loading" || history.status === "idle" ? (
                    <p className="rail__empty" data-testid="ask-dev-history-loading">
                        {HISTORY_COPY.loading}
                    </p>
                ) : history.status === "ready" ? (
                    <p className="rail__empty" data-testid="ask-dev-history-empty">
                        {HISTORY_COPY.empty}
                    </p>
                ) : null
            ) : (
                <ul className="rail__list" data-testid="ask-dev-history-list">
                    {history.rows.map((row) => (
                        <HistoryRow
                            history={history}
                            key={row.id}
                            onOpen={onOpen}
                            row={row}
                            source={source}
                        />
                    ))}
                </ul>
            )}
            {history.moreFailed ? <p className="rail__note">{HISTORY_COPY.moreFailed}</p> : null}
            {history.hasMore ? (
                <button
                    className="rail__button"
                    data-testid="ask-dev-history-more"
                    disabled={history.loadingMore}
                    onClick={() => {
                        source.loadMore();
                    }}
                    type="button"
                >
                    {CTA_LABELS.askDevShowMoreConversations}
                </button>
            ) : null}
        </section>
    );
}
