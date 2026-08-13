"use client";

import { useState } from "react";

import { CanonicalResultInspector } from "@/components/CanonicalResultInspector";
import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { FailurePanel } from "@/components/FailurePanel";
import { QuestionForm } from "@/components/QuestionForm";
import { ViewSwitcher, type WorkbenchView } from "@/components/ViewSwitcher";
import type { WorkbenchFailure } from "@/lib/acr/errors";
import type { InvestigationResult } from "@/lib/contracts";

/**
 * Context Fabric Workbench (CHAOS-3738).
 *
 * A tester asks a question; the server hop runs a REAL ACR investigation; the
 * immutable result is rendered through the canonical inspector and the
 * deterministic answer view side by side. There is no mock path — when ACR
 * cannot answer, the failure is shown as a failure.
 */

type Outcome =
    | { readonly kind: "idle" }
    | { readonly kind: "pending" }
    | { readonly kind: "answered"; readonly result: InvestigationResult }
    | { readonly kind: "failed"; readonly failure: WorkbenchFailure };

// `enriched` joins this list in M3, behind its fail-closed validator.
const AVAILABLE_VIEWS: readonly WorkbenchView[] = ["raw", "deterministic"];

function isFailure(value: unknown): value is WorkbenchFailure {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { code?: unknown }).code === "string" &&
        typeof (value as { message?: unknown }).message === "string"
    );
}

export default function WorkbenchPage() {
    const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
    const [view, setView] = useState<WorkbenchView>("deterministic");
    const [askedQuestion, setAskedQuestion] = useState("");

    async function ask(question: string) {
        setAskedQuestion(question);
        setOutcome({ kind: "pending" });
        try {
            const response = await fetch("/api/investigations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question }),
            });
            const payload: unknown = await response.json();
            const failure = (payload as { failure?: unknown }).failure;
            if (isFailure(failure)) {
                setOutcome({ kind: "failed", failure });
                return;
            }
            const result = (payload as { result?: unknown }).result;
            if (result === undefined || result === null) {
                setOutcome({
                    kind: "failed",
                    failure: {
                        code: "acr_contract_violation",
                        message: "The Workbench server returned neither a result nor a failure.",
                        retryable: false,
                    },
                });
                return;
            }
            setOutcome({ kind: "answered", result: result as InvestigationResult });
        } catch (error) {
            // Never swallow: a dead server hop is itself a reportable outcome.
            console.error("investigation request failed", error);
            setOutcome({
                kind: "failed",
                failure: {
                    code: "acr_unreachable",
                    message: "The Workbench server could not be reached.",
                    retryable: true,
                },
            });
        }
    }

    return (
        <main className="workbench">
            <header className="workbench__masthead">
                <h1>Context Fabric Workbench</h1>
                <p>
                    Standalone answer test platform (CHAOS-3738). Platform/test scoped, separate
                    from the Ask Dev window and /dev. Read-only: it renders investigation results,
                    it does not produce them.
                </p>
            </header>

            <QuestionForm
                initialQuestion=""
                pending={outcome.kind === "pending"}
                onAsk={(question) => {
                    void ask(question);
                }}
            />

            {outcome.kind === "idle" ? (
                <p className="panel__empty">Ask a question to run an investigation.</p>
            ) : null}

            {outcome.kind === "pending" ? (
                <p className="record__meta" role="status">
                    Investigating “{askedQuestion}” …
                </p>
            ) : null}

            {outcome.kind === "failed" ? <FailurePanel failure={outcome.failure} /> : null}

            {outcome.kind === "answered" ? (
                <>
                    <div className="result__head">
                        <h2 className="result__question">{outcome.result.question}</h2>
                        <span className="badge" title={outcome.result.status}>
                            {outcome.result.status.replaceAll("_", " ")}
                        </span>
                    </div>
                    <ViewSwitcher active={view} available={AVAILABLE_VIEWS} onSelect={setView} />
                    {view === "raw" ? (
                        <CanonicalResultInspector result={outcome.result} />
                    ) : (
                        <DeterministicAnswerView result={outcome.result} />
                    )}
                </>
            ) : null}
        </main>
    );
}
