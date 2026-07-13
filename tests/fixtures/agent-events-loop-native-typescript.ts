import { createEvent, createEventCollector, recordContinuation } from "../../lib/agent/events.ts";
import { DEFAULT_EXECUTORS, DEFAULT_MAX_TURNS, runAgentLoop } from "../../lib/agent/loop.ts";
import type { AgentEvent, AgentEventFields, AgentEventType, AgentLoopOptions, AgentRunResult, EventCollector, NormalizedProviderRequest, Provider, RecordedAgentEvent, ToolExecutorMap } from "../../lib/agent/contracts.ts";

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;
type Assignable<From, To> = From extends To ? true : false;

type CollectorMatchesContract = Assert<Assignable<ReturnType<typeof createEventCollector>, EventCollector>>;
type LoopAcceptsContractOptions = Assert<Equal<Parameters<typeof runAgentLoop>[0], AgentLoopOptions>>;
type LoopReturnsContractResult = Assert<Equal<Awaited<ReturnType<typeof runAgentLoop>>, AgentRunResult>>;
type EventFieldsDistributeOverTypes = Assert<Equal<AgentEventFields<"agent_start" | "turn_start">, AgentEventFields<"agent_start"> | AgentEventFields<"turn_start">>>;
type DefaultExecutorsMatchContract = Assert<Equal<typeof DEFAULT_EXECUTORS, ToolExecutorMap>>;
type ProviderResponseIsUnknown = Assert<Equal<Awaited<ReturnType<Provider["complete"]>>, unknown>>;

const event = createEvent("agent_start", { runId: "fixture_run", taskBytes: 7, taskProvided: true });
type EventFactoryPreservesType = Assert<Equal<typeof event["type"], "agent_start">>;
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
// @ts-expect-error agent_end status and terminal reason remain correlated.
const invalidTerminalCorrelation: AgentEventFields<"agent_end"> = { runId: "fixture_run", status: "success", turns: 1, terminalReason: "max_turns" };
// @ts-expect-error message_end disposition and error code remain correlated.
const invalidMessageCorrelation: AgentEventFields<"message_end"> = { turn: 1, disposition: "terminal", contentPresent: true, contentBytes: 2, toolCallCount: 0, errorCode: "provider_error" };
// @ts-expect-error terminal messages cannot report a tool call.
const invalidTerminalToolCallCount: AgentEventFields<"message_end"> = { turn: 1, disposition: "terminal", contentPresent: true, contentBytes: 2, toolCallCount: 1, errorCode: null };
// @ts-expect-error provider errors have fixed content and tool-call metadata.
const invalidProviderErrorContent: AgentEventFields<"message_end"> = { turn: 1, disposition: "provider_error", contentPresent: true, contentBytes: 2, toolCallCount: 0, errorCode: "provider_error" };
// @ts-expect-error provider errors require the provider_error code.
const invalidProviderErrorCode: AgentEventFields<"message_end"> = { turn: 1, disposition: "provider_error", contentPresent: false, contentBytes: 0, toolCallCount: 0, errorCode: null };
// @ts-expect-error each agent_end status has one matching terminal reason.
const invalidExhaustedTerminal: AgentEventFields<"agent_end"> = { runId: "fixture_run", status: "exhausted", turns: 1, terminalReason: "assistant_terminal" };
// @ts-expect-error each agent_end status has one matching terminal reason.
const invalidFailedTerminal: AgentEventFields<"agent_end"> = { runId: "fixture_run", status: "failed", turns: 1, terminalReason: "assistant_terminal" };
// @ts-expect-error read calls cannot use the command summary shape.
const invalidReadToolCallSummary: AgentEventFields<"tool_call"> = { toolCallId: "call_6", toolName: "read", summary: { command: "pnpm test", redacted: false, mode: null } };
// @ts-expect-error successful results require a known tool name.
const invalidSuccessfulNullResult: AgentEventFields<"tool_result"> = { toolCallId: "call_7", toolName: null, summary: {}, errorCode: null };
function proveExecutorInput(): void {
  // @ts-expect-error A read executor requires read arguments.
  void DEFAULT_EXECUTORS.read({ workspaceRoot: "." });
}
function proveEventFactoryCorrelations(): void {
  // @ts-expect-error tool-call messages require at least one tool call.
  void createEvent("message_end", { turn: 1, disposition: "tool_calls", contentPresent: false, contentBytes: 0, toolCallCount: 0, errorCode: null });
  // @ts-expect-error createEvent does not accept fields from another event variant.
  void createEvent("agent_start", { runId: "fixture_run", taskBytes: 7, taskProvided: true, turn: 1 });
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
void [compileProof, eventContract, recordedContract, invalidStart, invalidDistributedFields, invalidTerminal, invalidTerminalCorrelation, invalidMessageCorrelation, invalidTerminalToolCallCount, invalidProviderErrorContent, invalidProviderErrorCode, invalidExhaustedTerminal, invalidFailedTerminal, invalidReadToolCallSummary, invalidSuccessfulNullResult, maxTurns, validEventFields, proveExecutorInput, proveEventFactoryCorrelations, proveLoopInput, proveProviderBoundary];
