import { afterEach, describe, expect, it, vi } from "vitest";

import {
    createStandaloneSource,
    type StandaloneInvestigate,
    type StandaloneInvestigateOutcome,
} from "./standalone-source";
import type { BatchItem, ChatAssistantTurn, ChatTurn } from "./source";
import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import shapesResult from "@/contracts/examples/context_fabric_investigation_result_render_shapes.v1.json";
import unsupportedResult from "@/contracts/examples/context_fabric_investigation_result_unsupported.v1.json";
import type { WorkbenchFailure } from "@/lib/acr/errors";
import { unsentSubjectsNotice } from "@/lib/conversation";
import type { InvestigationResult } from "@/lib/contracts";
import workItemStatusResult from "../../tests/fixtures/work-item-status-result.json";

/**
 * CHAOS-12382: the standalone source is today's behaviour moved out of `AskDevChat`. CHAOS-12106:
 * its investigation call is injected, so these tests drive a fake one. The answered results are the
 * pinned ACR captures, never hand-written result JSON.
 */

type Call = {
    /** The options the source passed to the investigation call. */
    readonly body: Record<string, unknown>;
    /** `{ result }` answers, `{ failure }` fails; anything else answers neither. */
    readonly respond: (payload: unknown) => void;
    readonly fail: (error: unknown) => void;
};

/** An investigation call whose calls stay open until a test answers them. */
function controlledInvestigate() {
    const calls: Call[] = [];
    const impl: StandaloneInvestigate = (options) =>
        new Promise<StandaloneInvestigateOutcome>((resolve, reject) => {
            calls.push({
                body: { ...options },
                respond: (payload) => {
                    const { result, failure } = payload as {
                        result?: InvestigationResult;
                        failure?: WorkbenchFailure;
                    };
                    if (failure !== undefined) resolve({ kind: "failed", failure });
                    else resolve({ kind: "answered", result: result as InvestigationResult });
                },
                fail: reject,
            });
        });
    return { impl, calls };
}

function call(calls: readonly Call[], index: number): Call {
    const found = calls[index];
    if (found === undefined) throw new Error(`no call ${String(index)}`);
    return found;
}

function assistant(turns: readonly ChatTurn[], index: number): ChatAssistantTurn {
    const turn = turns[index];
    if (turn?.role !== "assistant") throw new Error(`turn ${String(index)} is not assistant`);
    return turn;
}

const noEvents: BatchItem["selectionEvents"] = [];

describe("createStandaloneSource", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("ask appends a user turn and a pending turn, then settles answered", async () => {
        const { impl, calls } = controlledInvestigate();
        const source = createStandaloneSource(impl);
        const answered = source.ask("Is Ask Dev ready?");

        const [user, pending] = source.getSnapshot().turns;
        expect(user).toMatchObject({
            role: "user",
            question: "Is Ask Dev ready?",
            showBubble: true,
        });
        expect(pending).toMatchObject({
            role: "assistant",
            outcome: { kind: "pending" },
            retryQuestion: "Is Ask Dev ready?",
            rootQuestion: "Is Ask Dev ready?",
        });
        // Today's request, field for field: one call, with these options.
        expect(calls).toHaveLength(1);
        expect(call(calls, 0).body).toEqual({
            question: "Is Ask Dev ready?",
            priorSubjectReceipts: [],
            conversation: [],
        });

        call(calls, 0).respond({ result: canonicalResult });
        await expect(answered).resolves.toBe(true);
        const settled = assistant(source.getSnapshot().turns, 1);
        expect(settled.outcome).toMatchObject({
            kind: "answered",
            result: { result_id: canonicalResult.result_id },
        });
    });

    it("words the scope-loss notice itself, from the subjects the follow-up could not carry", async () => {
        const { impl, calls } = controlledInvestigate();
        const source = createStandaloneSource(impl);
        const first = source.ask("Status of Project Alpha?");
        const unsendable = structuredClone(workItemStatusResult) as unknown as InvestigationResult;
        // A committed subject of a kind that cannot ride as a scope hint.
        unsendable.subject_resolution.committed = [
            { kind: "new_entity", canonical_id: "x:1", label: "Atlas" },
        ] as typeof unsendable.subject_resolution.committed;
        call(calls, 0).respond({ result: unsendable });
        await first;
        // The first answer carries no notice: nothing came before it.
        expect(assistant(source.getSnapshot().turns, 1).outcome).not.toHaveProperty(
            "scopeLossNotice",
        );

        const followUp = source.ask("And last month?");
        call(calls, 1).respond({ result: canonicalResult });
        await followUp;
        const { outcome } = assistant(source.getSnapshot().turns, 3);
        if (outcome.kind !== "answered") throw new Error("not answered");
        expect(outcome.scopeLossNotice).toBe(
            unsentSubjectsNotice([{ kind: "new_entity", label: "Atlas" }]),
        );
        expect(outcome.scopeLossNotice).toMatch(/does not carry Atlas/);
    });

    it("carries no notice when every committed subject rode as a hint", async () => {
        const { impl, calls } = controlledInvestigate();
        const source = createStandaloneSource(impl);
        const first = source.ask("Is Ask Dev ready?");
        call(calls, 0).respond({ result: canonicalResult });
        await first;
        const followUp = source.ask("And last month?");
        call(calls, 1).respond({ result: canonicalResult });
        await followUp;
        expect(assistant(source.getSnapshot().turns, 3).outcome).not.toHaveProperty(
            "scopeLossNotice",
        );
    });

    it("withholds a person cohort's ranking where the result enters, with a typed marker", async () => {
        const { impl, calls } = controlledInvestigate();
        const source = createStandaloneSource(impl);
        const base = canonicalResult as unknown as InvestigationResult;
        const person = {
            ...base,
            interpretation: { ...base.interpretation, shape: "explicit_cohort" },
            cohort: {
                ...base.cohort!,
                kind: "person",
                members: base.cohort!.members.map((member) => ({
                    ...member,
                    subject: { ...member.subject, kind: "person" },
                })),
            },
        };
        const answered = source.ask("Who needs attention?");
        call(calls, 0).respond({ result: person });
        await answered;
        const { outcome } = assistant(source.getSnapshot().turns, 1);
        if (outcome.kind !== "answered") throw new Error("not answered");
        expect(outcome.rankingWithheld?.reason).toBe("subject_kind_not_ranked");
        expect(JSON.stringify(outcome.result)).not.toContain("attention_rank");
        expect(JSON.stringify(outcome.result)).not.toContain('"score"');
    });

    it("holds the withheld form of a raw person cohort: its state feeds what it sends", async () => {
        const { impl, calls } = controlledInvestigate();
        const source = createStandaloneSource(impl);
        const rankable = shapesResult as unknown as InvestigationResult;
        const person = {
            ...rankable,
            cohort: { ...rankable.cohort!, kind: "person" },
        };
        const answered = source.ask("Who ships the most?");
        call(calls, 0).respond({ result: person });
        await answered;
        const { outcome } = assistant(source.getSnapshot().turns, 1);
        if (outcome.kind !== "answered") throw new Error("not answered");
        expect(outcome.result.cohort).toBeUndefined();
        expect(outcome.result.render_shapes).toBeUndefined();
        expect(outcome.rankingWithheld?.reason).toBe("subject_kind_not_ranked");
    });

    it("a failed outcome settles failed and resolves false", async () => {
        const { impl, calls } = controlledInvestigate();
        const source = createStandaloneSource(impl);
        const failure = { code: "acr_runtime_unavailable", message: "Down.", retryable: true };
        const answered = source.ask("Is Ask Dev ready?");
        call(calls, 0).respond({ failure });
        await expect(answered).resolves.toBe(false);
        expect(assistant(source.getSnapshot().turns, 1).outcome).toEqual({
            kind: "failed",
            failure,
        });
    });

    it("a thrown call is acr_unreachable (retryable) and is logged", async () => {
        const { impl, calls } = controlledInvestigate();
        const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const source = createStandaloneSource(impl);
        const answered = source.ask("Is Ask Dev ready?");
        const dead = new Error("socket hang up");
        call(calls, 0).fail(dead);
        await expect(answered).resolves.toBe(false);
        expect(assistant(source.getSnapshot().turns, 1).outcome).toEqual({
            kind: "failed",
            failure: {
                code: "acr_unreachable",
                message: "Ask Dev could not be reached.",
                retryable: true,
            },
        });
        expect(logged).toHaveBeenCalledWith("investigation request failed", dead);
    });

    it("threads the prior answer into a follow-up: conversation, parent, subject hints", async () => {
        const { impl, calls } = controlledInvestigate();
        const source = createStandaloneSource(impl);
        const first = source.ask("Is Ask Dev ready?");
        call(calls, 0).respond({ result: canonicalResult });
        await first;

        void source.ask("And last month?");
        const body = call(calls, 1).body;
        expect(body.parentResultId).toBe(canonicalResult.result_id);
        expect(body.subjectHints).toEqual([
            {
                kind: "project",
                id: "project_ask_dev",
                label: "Ask Dev",
                source: "ask_dev_parent_result_subject",
            },
        ]);
        expect(body.conversation).toMatchObject([
            { turn_id: "turn_0", role: "user", content: "Is Ask Dev ready?" },
            { turn_id: "turn_1", role: "assistant", content: canonicalResult.deterministic_answer },
        ]);
    });

    it("does not thread a blank answer (a real unsupported capture)", async () => {
        const { impl, calls } = controlledInvestigate();
        const source = createStandaloneSource(impl);
        const first = source.ask("Is Ask Dev ready?");
        call(calls, 0).respond({ result: unsupportedResult });
        await first;
        void source.ask("And last month?");
        expect(call(calls, 1).body.conversation).toMatchObject([
            { role: "user", content: "Is Ask Dev ready?" },
        ]);
    });

    it("a narrower re-ask keeps the chain's root; a receipt re-ask is silent and not retryable", () => {
        const { impl, calls } = controlledInvestigate();
        const source = createStandaloneSource(impl);
        void source.ask("Rank all repositories, top 5 only", { narrowingRoot: "Rank all" });
        expect(assistant(source.getSnapshot().turns, 1)).toMatchObject({
            retryQuestion: "Rank all repositories, top 5 only",
            rootQuestion: "Rank all",
        });

        const receipt = { result_id: "r1", receipt_id: "receipt_1" };
        void source.ask("Is Atlas on track?", { priorSubjectReceipts: [receipt] });
        const { turns } = source.getSnapshot();
        expect(turns[2]).toMatchObject({ role: "user", showBubble: false });
        expect(assistant(turns, 3)).toMatchObject({
            retryQuestion: undefined,
            rootQuestion: undefined,
        });
        expect(call(calls, 1).body.priorSubjectReceipts).toEqual([receipt]);
    });

    it("sends the structure batch a re-ask carries, and not the selection events", () => {
        const { impl, calls } = controlledInvestigate();
        const source = createStandaloneSource(impl);
        const expectedKind = { result_id: "r1", receipt_id: "kindr_1" };
        void source.ask("Is Atlas on track?", {
            structureBatch: { expected_kind: expectedKind },
            selectionEvents: [{ member: "expected_kind", outcome: "submitted" }],
        });
        expect(call(calls, 0).body).toMatchObject({
            priorKindReceipts: [expectedKind],
            priorAnchorReceipts: [],
            priorHandleReceipts: [],
            priorWindowReceipts: [],
            priorCandidateReceipts: [],
        });
        // Telemetry only, and nothing in this app emits it (CHAOS-12106).
        expect(call(calls, 0).body).not.toHaveProperty("structureSelectionEvents");
        expect(call(calls, 0).body).not.toHaveProperty("selectionEvents");
    });

    it("askBatch fires N requests in parallel and settles each on its own", async () => {
        const { impl, calls } = controlledInvestigate();
        const source = createStandaloneSource(impl);
        const first = { result_id: "r1", receipt_id: "receipt_1" };
        const second = { result_id: "r1", receipt_id: "receipt_2" };
        const third = { result_id: "r1", receipt_id: "candr_3" };
        source.askBatch(
            [
                {
                    priorSubjectReceipts: [first],
                    structureBatch: {},
                    chosenSubject: undefined,
                    selectionEvents: [{ member: "subject_candidate", outcome: "submitted" }],
                },
                {
                    priorSubjectReceipts: [second],
                    structureBatch: {},
                    chosenSubject: undefined,
                    selectionEvents: noEvents,
                },
                {
                    priorSubjectReceipts: [],
                    structureBatch: { subject_candidate: third },
                    chosenSubject: undefined,
                    selectionEvents: noEvents,
                },
            ],
            "Is Atlas on track?",
        );

        // All three started, and none has been answered.
        expect(calls).toHaveLength(3);
        const { turns } = source.getSnapshot();
        expect(turns.map((turn) => turn.role)).toEqual([
            "user",
            "assistant",
            "assistant",
            "assistant",
        ]);
        expect(turns[0]).toMatchObject({ question: "Is Atlas on track?", showBubble: false });
        expect(call(calls, 0).body).not.toHaveProperty("selectionEvents");
        expect(call(calls, 2).body.priorCandidateReceipts).toEqual([third]);

        // The last request answers first, and only its own turn settles.
        call(calls, 2).respond({ result: workItemStatusResult });
        await vi.waitFor(() => {
            expect(assistant(source.getSnapshot().turns, 3).outcome.kind).toBe("answered");
        });
        expect(assistant(source.getSnapshot().turns, 1).outcome.kind).toBe("pending");
        expect(assistant(source.getSnapshot().turns, 2).outcome.kind).toBe("pending");
    });

    it("askBatch with no items does nothing", () => {
        const { impl, calls } = controlledInvestigate();
        const source = createStandaloneSource(impl);
        const before = source.getSnapshot();
        source.askBatch([], "Is Atlas on track?");
        expect(calls).toHaveLength(0);
        expect(source.getSnapshot()).toBe(before);
    });

    it("records what the superseded turn submitted, in the update that appends the new turns", async () => {
        const { impl, calls } = controlledInvestigate();
        const source = createStandaloneSource(impl);
        const first = source.ask("Is Atlas on track?");
        call(calls, 0).respond({ result: canonicalResult });
        await first;

        const batch = { expected_kind: { result_id: "r1", receipt_id: "kindr_1" } };
        const picked = new Set(["receipt_1"]);
        const none = new Set<string>();
        const seen: number[] = [];
        source.subscribe(() => {
            seen.push(source.getSnapshot().turns.length);
        });
        source.askBatch(
            [
                {
                    priorSubjectReceipts: [{ result_id: "r1", receipt_id: "receipt_1" }],
                    structureBatch: batch,
                    chosenSubject: undefined,
                    selectionEvents: noEvents,
                },
            ],
            "Is Atlas on track?",
            {
                turnId: 1,
                submittedStructureBatch: batch,
                submittedCandidateReceiptIds: picked,
                submittedStructureCandidateReceiptIds: none,
            },
        );
        expect(assistant(source.getSnapshot().turns, 1)).toMatchObject({
            submittedStructureBatch: batch,
            submittedCandidateReceiptIds: picked,
            submittedStructureCandidateReceiptIds: none,
        });
        expect(seen).toEqual([4]);
    });

    it("retry resends a plain question as a new pair, and says how it ended", async () => {
        const { impl, calls } = controlledInvestigate();
        const source = createStandaloneSource(impl);
        const first = source.ask("Is Ask Dev ready?");
        call(calls, 0).respond({
            failure: { code: "acr_unreachable", message: "No.", retryable: true },
        });
        await first;

        const retried = source.retry(1);
        expect(calls).toHaveLength(2);
        expect(call(calls, 1).body.question).toBe("Is Ask Dev ready?");
        expect(source.getSnapshot().turns).toHaveLength(4);
        expect(assistant(source.getSnapshot().turns, 3).outcome.kind).toBe("pending");

        call(calls, 1).respond({ result: canonicalResult });
        await expect(retried).resolves.toBe(true);
    });

    it("retry passes the intent to ask, so the call is the one ask would make", async () => {
        const { impl, calls } = controlledInvestigate();
        const source = createStandaloneSource(impl);
        const first = source.ask("Is Ask Dev ready?");
        call(calls, 0).respond({
            failure: { code: "acr_unreachable", message: "No.", retryable: true },
        });
        await first;

        const retried = source.retry(1, {
            selectionEvents: [{ member: "subject_candidate", outcome: "submitted" }],
            narrowingRoot: "The root",
        });
        expect(call(calls, 1).body).not.toHaveProperty("selectionEvents");
        expect(assistant(source.getSnapshot().turns, 3).rootQuestion).toBe("The root");
        call(calls, 1).respond({
            failure: { code: "acr_unreachable", message: "No.", retryable: true },
        });
        await expect(retried).resolves.toBe(false);
    });

    it("retry does nothing for a receipt re-ask or an unknown turn, and resolves false", async () => {
        const { impl, calls } = controlledInvestigate();
        const source = createStandaloneSource(impl);
        void source.ask("Is Atlas on track?", {
            priorSubjectReceipts: [{ result_id: "r1", receipt_id: "receipt_1" }],
        });
        await expect(source.retry(1)).resolves.toBe(false);
        await expect(source.retry(99)).resolves.toBe(false);
        expect(calls).toHaveLength(1);
    });

    it("newConversation empties the timeline, and the next ask threads nothing", async () => {
        const { impl, calls } = controlledInvestigate();
        const source = createStandaloneSource(impl);
        const first = source.ask("Is Ask Dev ready?");
        call(calls, 0).respond({ result: canonicalResult });
        await first;

        source.newConversation();
        expect(source.getSnapshot().turns).toEqual([]);
        void source.ask("A new question");
        expect(call(calls, 1).body).toEqual({
            question: "A new question",
            priorSubjectReceipts: [],
            conversation: [],
        });
    });

    it("a request that answers after newConversation leaves the fresh conversation alone", async () => {
        const { impl, calls } = controlledInvestigate();
        const source = createStandaloneSource(impl);
        const first = source.ask("Is Ask Dev ready?");
        source.newConversation();
        const empty = source.getSnapshot();
        call(calls, 0).respond({ result: canonicalResult });
        await first;
        expect(source.getSnapshot()).toBe(empty);
    });

    it("snapshots are immutable and change identity only on change", async () => {
        const { impl, calls } = controlledInvestigate();
        const source = createStandaloneSource(impl);
        const listener = vi.fn();
        const unsubscribe = source.subscribe(listener);

        const empty = source.getSnapshot();
        expect(source.getSnapshot()).toBe(empty);
        expect(Object.isFrozen(empty)).toBe(true);
        expect(Object.isFrozen(empty.turns)).toBe(true);
        expect(listener).not.toHaveBeenCalled();

        const answered = source.ask("Is Ask Dev ready?");
        expect(listener).toHaveBeenCalledTimes(1);
        const pending = source.getSnapshot();
        expect(pending).not.toBe(empty);
        expect(empty.turns).toEqual([]);
        expect(Object.isFrozen(pending.turns)).toBe(true);
        expect(pending.turns.every((turn) => Object.isFrozen(turn))).toBe(true);

        call(calls, 0).respond({ result: canonicalResult });
        await answered;
        expect(listener).toHaveBeenCalledTimes(2);
        const settled = source.getSnapshot();
        expect(settled).not.toBe(pending);
        // The earlier snapshot still reads as it did.
        expect(assistant(pending.turns, 1).outcome.kind).toBe("pending");
        expect(assistant(settled.turns, 1).outcome.kind).toBe("answered");
        expect(settled.turns.every((turn) => Object.isFrozen(turn))).toBe(true);

        unsubscribe();
        source.newConversation();
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("never offers stop, never reports progress, never sends a status", async () => {
        const { impl, calls } = controlledInvestigate();
        const source = createStandaloneSource(impl);
        expect("stop" in source).toBe(false);
        expect(source.getSnapshot().stoppable).toBe(false);

        const answered = source.ask("Is Ask Dev ready?");
        expect(source.getSnapshot().stoppable).toBe(false);
        expect(assistant(source.getSnapshot().turns, 1).outcome).toEqual({ kind: "pending" });
        call(calls, 0).fail(new Error("gone"));
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        await answered;
        expect(source.getSnapshot().stoppable).toBe(false);
        expect(assistant(source.getSnapshot().turns, 1).outcome.kind).toBe("failed");
    });

    it("asks through the injected call and no other, once per ask", async () => {
        const stub = vi.fn<StandaloneInvestigate>(() =>
            Promise.resolve({
                kind: "answered",
                result: canonicalResult as unknown as InvestigationResult,
            }),
        );
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        const source = createStandaloneSource(stub);
        await expect(source.ask("Is Ask Dev ready?")).resolves.toBe(true);
        expect(stub).toHaveBeenCalledTimes(1);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
