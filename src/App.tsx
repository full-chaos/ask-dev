import { useMemo, useState } from "react";

import { InvestigationResultView } from "@/components/InvestigationResultView";
import { QuestionForm } from "@/components/QuestionForm";
import { loadConfig } from "@/config";
import { mockScenarios, resolveMockScenario } from "@/mocks/investigations";

/**
 * Ask Dev Workbench shell.
 *
 * Scaffold scope (CHAOS-3803): ask a question, render an investigation result.
 * The result comes from committed mock fixtures; no live call is made. The
 * workbench is a read-only consumer — it authors no facts, no metrics, no
 * health states, and no authorization decisions (CHAOS-3738 boundary).
 */
export function App() {
    const config = useMemo(() => loadConfig(), []);
    const scenarios = useMemo(() => mockScenarios(), []);
    const [question, setQuestion] = useState(scenarios[0]!.question);

    const scenario = useMemo(() => resolveMockScenario(question), [question]);

    return (
        <main className="workbench">
            <header className="workbench__masthead">
                <h1>Ask Dev Workbench</h1>
                <p>
                    Temporary Context Fabric frontend (CHAOS-3803). Read-only: it renders
                    investigation results, it does not produce them.
                </p>
            </header>

            <QuestionForm
                initialQuestion={question}
                suggestions={scenarios.map((entry) => ({
                    id: entry.id,
                    question: entry.question,
                }))}
                onAsk={setQuestion}
            />

            <p className="record__meta" data-testid="scenario-note">
                {config.useMockFixtures
                    ? `Mock scenario “${scenario.id}” — ${scenario.demonstrates}`
                    : "Live mode is configured but not implemented in this scaffold."}
            </p>

            <InvestigationResultView result={scenario.result} />

            <footer className="workbench__footer">
                Contracts pinned from full-chaos/dev-health-acr. Regenerate with{" "}
                <code>pnpm acr:contracts:generate</code>.
            </footer>
        </main>
    );
}
