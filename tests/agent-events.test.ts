// Strict event-safe audit schema coverage.
import { strictEqual, deepEqual, throws } from "node:assert";
import { AGENT_EVENT_TYPES as typedAgentEventTypes, createEvent, createEventCollector, recordContinuation } from "../lib/agent/events.ts";
import type { AgentEvent, AgentEventFields } from "../lib/agent/contracts.ts";

const AGENT_EVENT_TYPES: readonly string[] = typedAgentEventTypes;

let failures = 0;
function assert(condition: unknown, message: string): void { if (condition) console.log(`PASS  ${message}`); else { console.log(`FAIL  ${message}`); failures++; } }

function safeStart(): AgentEventFields<"agent_start"> { return { runId: "run_1", taskBytes: 12, taskProvided: true }; }
function safeEnd(): AgentEventFields<"agent_end"> { return { runId: "run_1", status: "success", turns: 1, terminalReason: "assistant_terminal" }; }
function safeMessageEnd(): AgentEventFields<"message_end"> { return { turn: 1, disposition: "terminal", contentPresent: true, contentBytes: 4, toolCallCount: 0, errorCode: null }; }

function isCommandToolCall(event: AgentEvent): event is Extract<AgentEvent, { type: "tool_call"; toolName: "command" }> { return event.type === "tool_call" && event.toolName === "command"; }
function isReadToolResult(event: AgentEvent): event is Extract<AgentEvent, { type: "tool_result"; toolName: "read" }> { return event.type === "tool_result" && event.toolName === "read"; }
function isListToolResult(event: AgentEvent): event is Extract<AgentEvent, { type: "tool_result"; toolName: "list" }> { return event.type === "tool_result" && event.toolName === "list"; }
function isGrepToolResult(event: AgentEvent): event is Extract<AgentEvent, { type: "tool_result"; toolName: "grep" }> { return event.type === "tool_result" && event.toolName === "grep"; }
function isWriteToolResult(event: AgentEvent): event is Extract<AgentEvent, { type: "tool_result"; toolName: "write" }> { return event.type === "tool_result" && event.toolName === "write"; }
function isCommandToolResult(event: AgentEvent): event is Extract<AgentEvent, { type: "tool_result"; toolName: "command" }> { return event.type === "tool_result" && event.toolName === "command"; }

// Runtime schema tests intentionally pass invalid JavaScript values.
function callCreateEventWithInvalidRuntimeInput(type: unknown, fields: unknown): unknown { return Reflect.apply(createEvent, undefined, [type, fields]); }

assert(AGENT_EVENT_TYPES.length === 10, "exactly 10 AgentEvent types defined");
for (const type of ["agent_start", "turn_start", "message_start", "message_end", "tool_call", "tool_execution_start", "tool_execution_end", "tool_result", "receipt_emitted", "agent_end"]) assert(AGENT_EVENT_TYPES.includes(type), `type present: ${type}`);

// Basic event construction
const start = createEvent("agent_start", safeStart());
deepEqual(start, { type: "agent_start", ...safeStart() }, "agent_start stores only safe task metadata");
const toolCall = createEvent("tool_call", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "app/page.tsx" } });
strictEqual(toolCall.type === "tool_call" && toolCall.toolName === "read" ? toolCall.summary.path : undefined, "app/page.tsx", "tool_call keeps project-relative summary path");

// Unknown event type
throws(() => callCreateEventWithInvalidRuntimeInput("not_a_real_event", {}), /Unknown AgentEvent type/, "unknown event type rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("agent_start", { ...safeStart(), type: "bogus" }), /must not contain a 'type' property/, "fields.type override rejected");

// Raw field rejection
throws(() => callCreateEventWithInvalidRuntimeInput("agent_start", { ...safeStart(), task: "RAW_TASK" }), /Unsupported AgentEvent field/, "raw task rejected from agent_start");
throws(() => callCreateEventWithInvalidRuntimeInput("agent_start", { ...safeStart(), workspaceRoot: "/tmp/raw" }), /Unsupported AgentEvent field/, "workspaceRoot rejected from agent_start");
throws(() => callCreateEventWithInvalidRuntimeInput("message_end", { ...safeMessageEnd(), content: "RAW" }), /Unsupported AgentEvent field/, "raw content rejected from message_end");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_call", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "x" }, args: { path: "x" } }), /Unsupported AgentEvent field/, "raw args rejected from tool_call");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_call", { toolCallId: "tool_1_1", toolName: "read", summary: { args: { path: "x" } } }), /Unsupported tool summary field/, "raw args rejected from tool summary");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md", bytes: 10, truncated: false }, errorCode: null, result: { content: "RAW" } }), /Unsupported AgentEvent field/, "raw result rejected from tool_result");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_result", { toolCallId: "tool_1_1", toolName: "command", summary: { stdout: "RAW", exitCode: 0, stdoutBytes: 10, stderrBytes: 0, truncated: false }, errorCode: null }), /Unsupported tool summary field/, "stdout rejected from tool_result summary");
throws(() => callCreateEventWithInvalidRuntimeInput("agent_end", { ...safeEnd(), arbitrary: "RAW" }), /Unsupported AgentEvent field/, "unknown arbitrary event field rejected");

// Strict ID validation
throws(() => callCreateEventWithInvalidRuntimeInput("agent_start", { ...safeStart(), runId: "" }), /Invalid runId/, "empty runId rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("agent_start", { ...safeStart(), runId: "/tmp/bad" }), /Invalid runId/, "path-like runId rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("agent_start", { ...safeStart(), runId: "a".repeat(200) }), /Invalid runId/, "oversized runId rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_call", { toolCallId: "", toolName: "read", summary: { path: "x" } }), /Invalid toolCallId/, "empty toolCallId rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("receipt_emitted", { runId: "run_1", receiptId: "", path: "oaf/receipts/a.json" }), /Invalid receiptId/, "empty receiptId rejected");

// Strict tool name validation
throws(() => callCreateEventWithInvalidRuntimeInput("tool_call", { toolCallId: "tool_1_1", toolName: "nonexistent", summary: {} }), /Invalid tool_call toolName/, "unknown tool name rejected in tool_call");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_execution_start", { toolCallId: "tool_1_1", toolName: "nonexistent" }), /Invalid tool_execution_start toolName/, "unknown tool name rejected in tool_execution_start");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_execution_end", { toolCallId: "tool_1_1", toolName: "nonexistent", success: true }), /Invalid tool_execution_end toolName/, "unknown tool name rejected in tool_execution_end");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_result", { toolCallId: "tool_1_1", toolName: "nonexistent", summary: {}, errorCode: null }), /Invalid tool_result toolName/, "unknown tool name rejected in tool_result");
assert(createEvent("tool_call", { toolCallId: "tool_1_1", toolName: null, summary: {} }).toolName === null, "null toolName allowed in tool_call for unknown tools");

// Strict status/terminalReason/disposition/errorCode validation
throws(() => callCreateEventWithInvalidRuntimeInput("agent_end", { ...safeEnd(), status: "invalid" }), /Invalid status/, "invalid status rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("agent_end", { ...safeEnd(), terminalReason: "invalid" }), /Invalid terminalReason/, "invalid terminalReason rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("message_end", { ...safeMessageEnd(), disposition: "invalid" }), /Invalid disposition/, "invalid disposition rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("message_end", { ...safeMessageEnd(), errorCode: "invalid" }), /Invalid errorCode/, "invalid errorCode rejected");

// Cross-field consistency: message_end
throws(() => callCreateEventWithInvalidRuntimeInput("message_end", { ...safeMessageEnd(), disposition: "provider_error", errorCode: null }), /provider_error disposition requires provider_error errorCode/, "provider_error disposition requires provider_error errorCode");
throws(() => callCreateEventWithInvalidRuntimeInput("message_end", { ...safeMessageEnd(), errorCode: "provider_error" }), /non-error disposition requires null errorCode/, "non-error disposition requires null errorCode");
throws(() => callCreateEventWithInvalidRuntimeInput("message_end", { ...safeMessageEnd(), toolCallCount: 1 }), /terminal disposition requires zero toolCallCount/, "terminal disposition requires zero toolCallCount");
throws(() => callCreateEventWithInvalidRuntimeInput("message_end", { ...safeMessageEnd(), disposition: "tool_calls", toolCallCount: 0 }), /tool_calls disposition requires at least one tool call/, "tool_calls disposition requires at least one tool call");
assert(createEvent("message_end", { turn: 1, disposition: "terminal", contentPresent: true, contentBytes: 4, toolCallCount: 0, errorCode: null }).disposition === "terminal", "terminal disposition with zero toolCallCount accepted");
assert(createEvent("message_end", { turn: 1, disposition: "tool_calls", contentPresent: true, contentBytes: 4, toolCallCount: 2, errorCode: null }).disposition === "tool_calls", "tool_calls disposition with positive toolCallCount accepted");

// Cross-field consistency: agent_end
throws(() => callCreateEventWithInvalidRuntimeInput("agent_end", { ...safeEnd(), status: "success", terminalReason: "max_turns" }), /success requires assistant_terminal/, "success requires assistant_terminal");
throws(() => callCreateEventWithInvalidRuntimeInput("agent_end", { ...safeEnd(), status: "exhausted", terminalReason: "assistant_terminal" }), /exhausted requires max_turns/, "exhausted requires max_turns");
throws(() => callCreateEventWithInvalidRuntimeInput("agent_end", { ...safeEnd(), status: "failed", terminalReason: "assistant_terminal" }), /failed requires provider_error/, "failed requires provider_error");
assert(createEvent("agent_end", { runId: "run_1", status: "exhausted", turns: 8, terminalReason: "max_turns" }).status === "exhausted", "exhausted with max_turns accepted");
assert(createEvent("agent_end", { runId: "run_1", status: "failed", turns: 1, terminalReason: "provider_error" }).status === "failed", "failed with provider_error accepted");

// Command privacy enforcement in event schema
throws(() => callCreateEventWithInvalidRuntimeInput("tool_call", { toolCallId: "tool_1_1", toolName: "command", summary: { command: "echo UNLABELED_SECRET", redacted: false, mode: null } }), /Non-redacted command must be a canonical recordable command/, "arbitrary command with redacted false rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_call", { toolCallId: "tool_1_1", toolName: "command", summary: { command: "echo UNLABELED_SECRET", redacted: true, mode: null } }), /Redacted command must be exactly/, "arbitrary command with redacted true rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_call", { toolCallId: "tool_1_1", toolName: "command", summary: { command: "pnpm test", redacted: true, mode: null } }), /Redacted command must be exactly/, "canonical command with redacted true rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_call", { toolCallId: "tool_1_1", toolName: "command", summary: { command: "<redacted command>", redacted: false, mode: null } }), /Non-redacted command must be a canonical recordable command/, "redacted marker with redacted false rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_call", { toolCallId: "tool_1_1", toolName: "command", summary: { command: "", redacted: false, mode: null } }), /Non-redacted command must be a canonical recordable command/, "empty command rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_call", { toolCallId: "tool_1_1", toolName: "command", summary: { command: "pnpm test && echo x", redacted: false, mode: null } }), /Non-redacted command must be a canonical recordable command/, "canonical-prefix command rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_call", { toolCallId: "tool_1_1", toolName: "command", summary: { command: "pnpm test --unexpected", redacted: false, mode: null } }), /Non-redacted command must be a canonical recordable command/, "canonical command with extra args rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_call", { toolCallId: "tool_1_1", toolName: "command", summary: { command: "pnpm test", redacted: false, mode: "invalid" } }), /Command mode must be a valid sandbox mode or null/, "invalid command mode rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_call", { toolCallId: "tool_1_1", toolName: "command", summary: { command: "pnpm test", redacted: false, mode: "test", network: false } }), /Unsupported tool summary field/, "model authorization claim rejected from audit summary");

// All seven canonical command summaries accepted
for (const canonical of ["pnpm test", "pnpm lint", "pnpm typecheck", "pnpm build", "git status", "git diff", "git log --oneline"]) {
  const commandEvent = createEvent("tool_call", { toolCallId: "tool_1_1", toolName: "command", summary: { command: canonical, redacted: false, mode: null } });
  assert(isCommandToolCall(commandEvent) && commandEvent.summary.command === canonical, `canonical command accepted: ${canonical}`);
}
const redactedCommandEvent = createEvent("tool_call", { toolCallId: "tool_1_1", toolName: "command", summary: { command: "<redacted command>", redacted: true, mode: null } });
assert(isCommandToolCall(redactedCommandEvent) && redactedCommandEvent.summary.redacted === true, "exact redacted marker summary accepted");
const commandModeEvent = createEvent("tool_call", { toolCallId: "tool_1_1", toolName: "command", summary: { command: "pnpm test", redacted: false, mode: "test" } });
assert(isCommandToolCall(commandModeEvent) && commandModeEvent.summary.mode === "test", "valid command mode accepted");
const nullCommandModeEvent = createEvent("tool_call", { toolCallId: "tool_1_1", toolName: "command", summary: { command: "pnpm test", redacted: false, mode: null } });
assert(isCommandToolCall(nullCommandModeEvent) && nullCommandModeEvent.summary.mode === null, "null command mode accepted");

// Success completeness validation
throws(() => callCreateEventWithInvalidRuntimeInput("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md", bytes: 10 }, errorCode: null }), /read success requires truncated/, "read success requires truncated");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md", truncated: false }, errorCode: null }), /read success requires bytes/, "read success requires bytes");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_result", { toolCallId: "tool_1_1", toolName: "write", summary: { path: "notes.txt" }, errorCode: null }), /write success requires bytes/, "write success requires bytes");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_result", { toolCallId: "tool_1_1", toolName: "command", summary: { exitCode: 0, stdoutBytes: 10, stderrBytes: 0 }, errorCode: null }), /command success requires truncated/, "command success requires truncated");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_result", { toolCallId: "tool_1_1", toolName: "command", summary: { exitCode: null, stdoutBytes: 10, stderrBytes: 0, truncated: false }, errorCode: null }), /command success requires exitCode/, "command success with null exitCode rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_result", { toolCallId: "tool_1_1", toolName: null, summary: {}, errorCode: null }), /Successful tool_result requires a known toolName/, "success with null toolName rejected");

// Error consistency validation
throws(() => callCreateEventWithInvalidRuntimeInput("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md" }, errorCode: "rejected" }), /Error result must have empty summary/, "error result with non-empty summary rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_result", { toolCallId: "tool_1_1", toolName: "command", summary: { exitCode: 1 }, errorCode: "rejected" }), /Error result must have empty summary/, "error result with exitCode rejected");

// Valid success summaries
const readResult = createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md", bytes: 100, truncated: false }, errorCode: null });
assert(isReadToolResult(readResult) && readResult.summary.path === "README.md", "valid read success accepted");
const listResult = createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "list", summary: { path: ".", entryCount: 5 }, errorCode: null });
assert(isListToolResult(listResult) && listResult.summary.entryCount === 5, "valid list success accepted");
const grepResult = createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "grep", summary: { matchCount: 3, fileCount: 2 }, errorCode: null });
assert(isGrepToolResult(grepResult) && grepResult.summary.matchCount === 3, "valid grep success accepted");
const writeResult = createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "write", summary: { path: "notes.txt", bytes: 50 }, errorCode: null });
assert(isWriteToolResult(writeResult) && writeResult.summary.bytes === 50, "valid write success accepted");
const commandResult = createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "command", summary: { exitCode: 0, stdoutBytes: 100, stderrBytes: 0, truncated: false }, errorCode: null });
assert(isCommandToolResult(commandResult) && commandResult.summary.exitCode === 0, "valid command success accepted");

// Valid error summaries
assert(createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: {}, errorCode: "rejected" }).errorCode === "rejected", "valid read error accepted");
assert(createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "command", summary: {}, errorCode: "execution_error" }).errorCode === "execution_error", "valid command error accepted");
assert(createEvent("tool_result", { toolCallId: "tool_1_1", toolName: null, summary: {}, errorCode: "rejected" }).errorCode === "rejected", "valid unknown tool error accepted");

// Number.isSafeInteger boundaries
const maximumReadResult = createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md", bytes: Number.MAX_SAFE_INTEGER, truncated: false }, errorCode: null });
assert(isReadToolResult(maximumReadResult) && maximumReadResult.summary.bytes === Number.MAX_SAFE_INTEGER, "MAX_SAFE_INTEGER bytes accepted");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md", bytes: Number.MAX_SAFE_INTEGER + 1, truncated: false }, errorCode: null }), /Invalid tool summary count/, "unsafe integer bytes rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md", bytes: -1, truncated: false }, errorCode: null }), /Invalid tool summary count/, "negative bytes rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md", bytes: 1.5, truncated: false }, errorCode: null }), /Invalid tool summary count/, "fractional bytes rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md", bytes: Infinity, truncated: false }, errorCode: null }), /Invalid tool summary count/, "infinite bytes rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md", bytes: NaN, truncated: false }, errorCode: null }), /Invalid tool summary count/, "NaN bytes rejected");

// Path control character rejection
throws(() => callCreateEventWithInvalidRuntimeInput("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md\x00", bytes: 10, truncated: false }, errorCode: null }), /Invalid tool summary path/, "path with NUL rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md\n", bytes: 10, truncated: false }, errorCode: null }), /Invalid tool summary path/, "path with newline rejected");
throws(() => callCreateEventWithInvalidRuntimeInput("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "/absolute/path", bytes: 10, truncated: false }, errorCode: null }), /Invalid tool summary path/, "absolute path rejected");

// Collector behavior
const collector = createEventCollector();
collector.record(createEvent("agent_start", safeStart()));
collector.record(createEvent("tool_call", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md" } }));
collector.record(createEvent("agent_end", safeEnd()));
const all = collector.all();
assert(all.map((event) => event.seq).join(",") === "1,2,3", "collector assigns contiguous sequence numbers");
assert(all.every((event) => typeof event.ts === "string" && !Number.isNaN(Date.parse(event.ts))), "collector assigns ISO timestamps");
JSON.parse(JSON.stringify(all));
assert(true, "safe events are JSON-serializable");

// Continuation behavior
const continued = recordContinuation(all, { type: "receipt_emitted", runId: "run_1", receiptId: "rcpt_1", path: "oaf/receipts/a.json" });
strictEqual(continued.seq, 4, "continuation sequence follows recorded stream");
assert(typeof continued.ts === "string" && !Number.isNaN(Date.parse(continued.ts)), "continuation timestamp is ISO");
throws(() => recordContinuation([], { type: "receipt_emitted", runId: "run", receiptId: "r", path: "/tmp/escape" }), /Invalid receipt_emitted path/, "absolute receipt path rejected");
strictEqual(recordContinuation([{ seq: Number.NaN }, { seq: -1 }, { seq: 3.5 }, { seq: 4 }], { type: "receipt_emitted", runId: "run_1", receiptId: "rcpt_2", path: "oaf/receipts/b.json" }).seq, 5, "continuation ignores invalid sequence values");

if (failures > 0) { console.error(`\n${failures} event check(s) failed.`); process.exit(1); }
console.log("\nAll agent-event checks passed.");
