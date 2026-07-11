// Strict event-safe audit schema coverage.
import { strictEqual, deepEqual, throws } from "node:assert";
import { AGENT_EVENT_TYPES, createEvent, createEventCollector, recordContinuation } from "../lib/agent/events.mjs";

let failures = 0;
function assert(condition, message) { if (condition) console.log(`PASS  ${message}`); else { console.log(`FAIL  ${message}`); failures++; } }

function safeStart() { return { runId: "run_1", taskBytes: 12, taskProvided: true }; }
function safeEnd() { return { runId: "run_1", status: "success", turns: 1, terminalReason: "assistant_terminal" }; }
function safeMessageEnd() { return { turn: 1, disposition: "terminal", contentPresent: true, contentBytes: 4, toolCallCount: 0, errorCode: null }; }

assert(AGENT_EVENT_TYPES.length === 10, "exactly 10 AgentEvent types defined");
for (const type of ["agent_start", "turn_start", "message_start", "message_end", "tool_call", "tool_execution_start", "tool_execution_end", "tool_result", "receipt_emitted", "agent_end"]) assert(AGENT_EVENT_TYPES.includes(type), `type present: ${type}`);

// Basic event construction
const start = createEvent("agent_start", safeStart());
deepEqual(start, { type: "agent_start", ...safeStart() }, "agent_start stores only safe task metadata");
const toolCall = createEvent("tool_call", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "app/page.tsx" } });
strictEqual(toolCall.summary.path, "app/page.tsx", "tool_call keeps project-relative summary path");

// Unknown event type
throws(() => createEvent("not_a_real_event", {}), /Unknown AgentEvent type/, "unknown event type rejected");
throws(() => createEvent("agent_start", { ...safeStart(), type: "bogus" }), /must not contain a 'type' property/, "fields.type override rejected");

// Raw field rejection in agent_start
throws(() => createEvent("agent_start", { ...safeStart(), task: "RAW_TASK" }), /Unsupported AgentEvent field/, "raw task rejected from agent_start");
throws(() => createEvent("agent_start", { ...safeStart(), workspaceRoot: "/tmp/raw" }), /Unsupported AgentEvent field/, "workspaceRoot rejected from agent_start");

// Raw field rejection in message_end
throws(() => createEvent("message_end", { ...safeMessageEnd(), content: "RAW" }), /Unsupported AgentEvent field/, "raw content rejected from message_end");
throws(() => createEvent("message_end", { ...safeMessageEnd(), error: "RAW" }), /Unsupported AgentEvent field/, "raw error rejected from message_end");

// Raw field rejection in tool events
throws(() => createEvent("tool_call", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "x" }, args: { path: "x" } }), /Unsupported AgentEvent field/, "raw args rejected from tool_call");
throws(() => createEvent("tool_call", { toolCallId: "tool_1_1", toolName: "read", summary: { args: { path: "x" } } }), /Unsupported tool summary field/, "raw args rejected from tool summary");
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md", bytes: 10, truncated: false }, errorCode: null, result: { content: "RAW" } }), /Unsupported AgentEvent field/, "raw result rejected from tool_result");
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "command", summary: { exitCode: 0, stdoutBytes: 10, stderrBytes: 0, truncated: false }, errorCode: null, stdout: "RAW" }), /Unsupported AgentEvent field/, "raw stdout rejected from tool_result fields");
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "command", summary: { stdout: "RAW", exitCode: 0, stdoutBytes: 10, stderrBytes: 0, truncated: false }, errorCode: null }), /Unsupported tool summary field/, "stdout rejected from tool_result summary");
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "command", summary: { stderr: "RAW", exitCode: 0, stdoutBytes: 10, stderrBytes: 0, truncated: false }, errorCode: null }), /Unsupported tool summary field/, "stderr rejected from tool_result summary");

// Arbitrary field rejection
throws(() => createEvent("agent_end", { ...safeEnd(), arbitrary: "RAW" }), /Unsupported AgentEvent field/, "unknown arbitrary event field rejected");

// Strict ID validation
throws(() => createEvent("agent_start", { ...safeStart(), runId: "" }), /Invalid runId/, "empty runId rejected");
throws(() => createEvent("agent_start", { ...safeStart(), runId: "/tmp/bad" }), /Invalid runId/, "path-like runId rejected");
throws(() => createEvent("agent_start", { ...safeStart(), runId: "a".repeat(200) }), /Invalid runId/, "oversized runId rejected");
throws(() => createEvent("tool_call", { toolCallId: "", toolName: "read", summary: { path: "x" } }), /Invalid toolCallId/, "empty toolCallId rejected");
throws(() => createEvent("receipt_emitted", { runId: "run_1", receiptId: "", path: "oaf/receipts/a.json" }), /Invalid receiptId/, "empty receiptId rejected");

// Strict tool name validation
throws(() => createEvent("tool_call", { toolCallId: "tool_1_1", toolName: "nonexistent", summary: {} }), /Invalid tool_call toolName/, "unknown tool name rejected in tool_call");
throws(() => createEvent("tool_execution_start", { toolCallId: "tool_1_1", toolName: "nonexistent" }), /Invalid tool_execution_start toolName/, "unknown tool name rejected in tool_execution_start");
throws(() => createEvent("tool_execution_end", { toolCallId: "tool_1_1", toolName: "nonexistent", success: true }), /Invalid tool_execution_end toolName/, "unknown tool name rejected in tool_execution_end");
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "nonexistent", summary: {}, errorCode: null }), /Invalid tool_result toolName/, "unknown tool name rejected in tool_result");
// null toolName allowed in tool_call and tool_result (for unknown tool rejection)
assert(createEvent("tool_call", { toolCallId: "tool_1_1", toolName: null, summary: {} }).toolName === null, "null toolName allowed in tool_call for unknown tools");

// Strict status/terminalReason validation
throws(() => createEvent("agent_end", { ...safeEnd(), status: "invalid" }), /Invalid status/, "invalid status rejected");
throws(() => createEvent("agent_end", { ...safeEnd(), terminalReason: "invalid" }), /Invalid terminalReason/, "invalid terminalReason rejected");
throws(() => createEvent("message_end", { ...safeMessageEnd(), disposition: "invalid" }), /Invalid disposition/, "invalid disposition rejected");
throws(() => createEvent("message_end", { ...safeMessageEnd(), errorCode: "invalid" }), /Invalid errorCode/, "invalid errorCode rejected");

// Success completeness validation
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md", bytes: 10 }, errorCode: null }), /read success requires truncated/, "read success requires truncated");
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md", truncated: false }, errorCode: null }), /read success requires bytes/, "read success requires bytes");
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "write", summary: { path: "notes.txt" }, errorCode: null }), /write success requires bytes/, "write success requires bytes");
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "command", summary: { exitCode: 0, stdoutBytes: 10, stderrBytes: 0 }, errorCode: null }), /command success requires truncated/, "command success requires truncated");
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "command", summary: { exitCode: null, stdoutBytes: 10, stderrBytes: 0, truncated: false }, errorCode: null }), /command success requires exitCode/, "command success with null exitCode rejected");
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: null, summary: {}, errorCode: null }), /Successful tool_result requires a known toolName/, "success with null toolName rejected");

// Error consistency validation
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md" }, errorCode: "rejected" }), /Error result must have empty summary/, "error result with non-empty summary rejected");
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { bytes: 100 }, errorCode: "execution_error" }), /Error result must have empty summary/, "error result with bytes rejected");
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "command", summary: { exitCode: 1 }, errorCode: "rejected" }), /Error result must have empty summary/, "error result with exitCode rejected");

// Valid success summaries
assert(createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md", bytes: 100, truncated: false }, errorCode: null }).summary.path === "README.md", "valid read success accepted");
assert(createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "list", summary: { path: ".", entryCount: 5 }, errorCode: null }).summary.entryCount === 5, "valid list success accepted");
assert(createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "grep", summary: { matchCount: 3, fileCount: 2 }, errorCode: null }).summary.matchCount === 3, "valid grep success accepted");
assert(createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "write", summary: { path: "notes.txt", bytes: 50 }, errorCode: null }).summary.bytes === 50, "valid write success accepted");
assert(createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "command", summary: { exitCode: 0, stdoutBytes: 100, stderrBytes: 0, truncated: false }, errorCode: null }).summary.exitCode === 0, "valid command success accepted");

// Valid error summaries
assert(createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: {}, errorCode: "rejected" }).errorCode === "rejected", "valid read error accepted");
assert(createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "command", summary: {}, errorCode: "execution_error" }).errorCode === "execution_error", "valid command error accepted");
assert(createEvent("tool_result", { toolCallId: "tool_1_1", toolName: null, summary: {}, errorCode: "rejected" }).errorCode === "rejected", "valid unknown tool error accepted");

// Count bounds
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md", bytes: -1, truncated: false }, errorCode: null }), /Invalid tool summary count/, "negative bytes rejected");
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md", bytes: 999999999, truncated: false }, errorCode: null }), /Invalid tool summary count/, "oversized bytes rejected");

// Exit code bounds
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "command", summary: { exitCode: 256, stdoutBytes: 0, stderrBytes: 0, truncated: false }, errorCode: null }), /Invalid tool summary exitCode/, "exitCode > 255 rejected");
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "command", summary: { exitCode: -1, stdoutBytes: 0, stderrBytes: 0, truncated: false }, errorCode: null }), /Invalid tool summary exitCode/, "negative exitCode rejected");

// Path control character rejection
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md\x00", bytes: 10, truncated: false }, errorCode: null }), /Invalid tool summary path/, "path with NUL rejected");
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md\n", bytes: 10, truncated: false }, errorCode: null }), /Invalid tool summary path/, "path with newline rejected");
throws(() => createEvent("tool_result", { toolCallId: "tool_1_1", toolName: "read", summary: { path: "/absolute/path", bytes: 10, truncated: false }, errorCode: null }), /Invalid tool summary path/, "absolute path rejected");

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

if (failures > 0) { console.error(`\n${failures} event check(s) failed.`); process.exit(1); }
console.log("\nAll agent-event checks passed.");
