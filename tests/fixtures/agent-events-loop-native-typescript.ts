import { createEvent, createEventCollector, recordContinuation } from "../../lib/agent/events.ts";
import { DEFAULT_EXECUTORS, DEFAULT_MAX_TURNS, runAgentLoop } from "../../lib/agent/loop.ts";
import type { AgentEvent, AgentEventFields, AgentEventType, AgentLoopOptions, AgentRunResult, EventCollector, NormalizedProviderRequest, Provider, RecordedAgentEvent, ToolExecutorMap } from "../../lib/agent/contracts.ts";

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;
type Assignable<From, To> = From extends To ? true : false;

type EventFactoryPreservesType = Assert<Equal<ReturnType<typeof createEvent<"agent_start">>["type"], "agent_start">>;
type CollectorMatchesContract = Assert<Assignable<ReturnType<typeof createEventCollector>, EventCollector>>;
type LoopAcceptsContractOptions = Assert<Equal<Parameters<typeof runAgentLoop>[0], AgentLoopOptions>>;
type LoopReturnsContractResult = Assert<Equal<Awaited<ReturnType<typeof runAgentLoop>>, AgentRunResult>>;
type EventFieldsDistributeOverTypes = Assert<Equal<AgentEventFields<"agent_start" | "turn_start">, AgentEventFields<"agent_start"> | AgentEventFields<"turn_start">>>;
type DefaultExecutorsMatchContract = Assert<Equal<typeof DEFAULT_EXECUTORS, ToolExecutorMap>>;
type ProviderResponseIsUnknown = Assert<Equal<Awaited<ReturnType<Provider["complete"]>>, unknown>>;

const event = createEvent("agent_start", { runId: "fixture_run", taskBytes: 7, taskProvided: true });
const collector = createEventCollector();
const recorded = collector.record(event);
const continued = recordContinuation([recorded], { type: "agent_end", runId: "fixture_run", status: "success", turns: 1, terminalReason: "assistant_terminal" });
const eventContract: AgentEvent = event;
const recordedContract: RecordedAgentEvent = continued;
const maxTurns: number = DEFAULT_MAX_TURNS;
const validEventFields: AgentEventFields<AgentEventType>[] = [
  { runId: "fixture_run", taskBytes: 7, taskProvided: true },
  { turn: 1 },
  { turn: 1 },
  { turn: 1, disposition: "terminal", contentPresent: true, contentBytes: 2, toolCallCount: 0, errorCode: null },
  { turn: 1, disposition: "tool_calls", contentPresent: false, contentBytes: 0, toolCallCount: 1, errorCode: null },
  { turn: 1, disposition: "provider_error", contentPresent: false, contentBytes: 0, toolCallCount: 0, errorCode: "provider_error" },
  { toolCallId: "call_1", toolName: "read", summary: { path: "README.md" } },
  { toolCallId: "call_2", toolName: null, summary: {} },
  { toolCallId: "call_3", toolName: "read" },
  { toolCallId: "call_3", toolName: "read", success: true },
  { toolCallId: "call_4", toolName: "read", summary: { path: "README.md", bytes: 7, truncated: false }, errorCode: null },
  { toolCallId: "call_5", toolName: null, summary: {}, errorCode: "rejected" },
  { runId: "fixture_run", receiptId: "receipt_1", path: ".oaf/receipts/receipt_1.json" },
  { runId: "fixture_run", status: "success", turns: 1, terminalReason: "assistant_terminal" },
  { runId: "fixture_run", status: "exhausted", turns: 8, terminalReason: "max_turns" },
  { runId: "fixture_run", status: "failed", turns: 1, terminalReason: "provider_error" },
];
// @ts-expect-error Event fields are exact for a known event type.
const invalidStart: AgentEventFields<"agent_start"> = { runId: "fixture_run", taskBytes: 7, taskProvided: true, task: "raw" };
// @ts-expect-error Each distributed event field member retains its required fields.
const invalidDistributedFields: AgentEventFields<"agent_start" | "turn_start"> = { runId: "fixture_run", taskBytes: 7 };
// @ts-expect-error agent_end terminal reasons are limited to the contract vocabulary.
const invalidTerminal: AgentEventFields<"agent_end"> = { runId: "fixture_run", status: "success", turns: 1, terminalReason: "other" };
function proveExecutorInput(): void {
  // @ts-expect-error A read executor requires read arguments.
  void DEFAULT_EXECUTORS.read({ workspaceRoot: "." });
}
function proveLoopInput(): void {
  // @ts-expect-error The loop requires every contract input at compile time.
  void runAgentLoop({ workspaceRoot: ".", provider: { async complete() { return null; } } });
}

async function proveProviderBoundary(provider: Provider, request: NormalizedProviderRequest): Promise<void> {
  const response = await provider.complete(request);
  // @ts-expect-error Provider output requires runtime validation before access.
  void response.content;
}

const compileProof: [EventFactoryPreservesType, CollectorMatchesContract, LoopAcceptsContractOptions, LoopReturnsContractResult, EventFieldsDistributeOverTypes, DefaultExecutorsMatchContract, ProviderResponseIsUnknown] = [true, true, true, true, true, true, true];
void [compileProof, eventContract, recordedContract, invalidStart, invalidDistributedFields, invalidTerminal, maxTurns, validEventFields, proveExecutorInput, proveLoopInput, proveProviderBoundary];
