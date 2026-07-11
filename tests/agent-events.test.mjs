// Strict event-safe audit schema coverage.
import { strictEqual, deepEqual, throws } from "node:assert";
import { AGENT_EVENT_TYPES, createEvent, createEventCollector, recordContinuation } from "../lib/agent/events.mjs";

let failures = 0;
function assert(condition, message) { if (condition) console.log(`PASS  ${message}`); else { console.log(`FAIL  ${message}`); failures++; } }
function safeStart() { return { runId: "run_1", taskBytes: 12, taskProvided: true }; }

assert(AGENT_EVENT_TYPES.length === 10, "exactly 10 AgentEvent types defined");
for (const type of ["agent_start", "turn_start", "message_start", "message_end", "tool_call", "tool_execution_start", "tool_execution_end", "tool_result", "receipt_emitted", "agent_end"]) assert(AGENT_EVENT_TYPES.includes(type), `type present: ${type}`);

const start = createEvent("agent_start", safeStart());
deepEqual(start, { type: "agent_start", ...safeStart() }, "agent_start stores only safe task metadata");
const toolCall = createEvent("tool_call", { toolCallId: "c1", toolName: "read", summary: { path: "app/page.tsx" } });
strictEqual(toolCall.summary.path, "app/page.tsx", "tool_call keeps project-relative summary path");

throws(() => createEvent("not_a_real_event", {}), /Unknown AgentEvent type/, "unknown event type rejected");
throws(() => createEvent("agent_start", { ...safeStart(), task: "RAW_TASK" }), /Unsupported AgentEvent field/, "raw task rejected from agent_start");
throws(() => createEvent("agent_start", { ...safeStart(), workspaceRoot: "/tmp/raw" }), /Unsupported AgentEvent field/, "workspaceRoot rejected from agent_start");
throws(() => createEvent("message_end", { turn: 1, disposition: "terminal", contentPresent: true, contentBytes: 1, toolCallCount: 0, errorCode: null, content: "RAW" }), /Unsupported AgentEvent field/, "raw content rejected from message_end");
throws(() => createEvent("tool_call", { toolCallId: "c1", toolName: "read", summary: { path: "x" }, args: { path: "x" } }), /Unsupported AgentEvent field/, "raw args rejected from tool_call");
throws(() => createEvent("tool_call", { toolCallId: "c1", toolName: "read", summary: { args: { path: "x" } } }), /Unsupported tool summary field/, "raw args rejected from tool summary");
throws(() => createEvent("tool_result", { toolCallId: "c1", toolName: "read", summary: {}, errorCode: null, result: { content: "RAW" } }), /Unsupported AgentEvent field/, "raw result rejected from tool_result");
throws(() => createEvent("tool_result", { toolCallId: "c1", toolName: "command", summary: { stdout: "RAW" }, errorCode: null }), /Unsupported tool summary field/, "stdout rejected from tool_result summary");
throws(() => createEvent("tool_result", { toolCallId: "c1", toolName: "command", summary: { stderr: "RAW" }, errorCode: null }), /Unsupported tool summary field/, "stderr rejected from tool_result summary");
throws(() => createEvent("agent_end", { runId: "run_1", status: "success", turns: 1, terminalReason: "assistant_terminal", arbitrary: "RAW" }), /Unsupported AgentEvent field/, "unknown arbitrary event field rejected");

const collector = createEventCollector();
collector.record(createEvent("agent_start", safeStart()));
collector.record(createEvent("tool_call", { toolCallId: "c1", toolName: "read", summary: { path: "README.md" } }));
collector.record(createEvent("agent_end", { runId: "run_1", status: "success", turns: 1, terminalReason: "assistant_terminal" }));
const all = collector.all();
assert(all.map((event) => event.seq).join(",") === "1,2,3", "collector assigns contiguous sequence numbers");
assert(all.every((event) => typeof event.ts === "string" && !Number.isNaN(Date.parse(event.ts))), "collector assigns ISO timestamps");
JSON.parse(JSON.stringify(all));
assert(true, "safe events are JSON-serializable");

const continued = recordContinuation(all, { type: "receipt_emitted", runId: "run_1", receiptId: "rcpt_1", path: "oaf/receipts/a.json" });
strictEqual(continued.seq, 4, "continuation sequence follows recorded stream");
assert(typeof continued.ts === "string" && !Number.isNaN(Date.parse(continued.ts)), "continuation timestamp is ISO");
throws(() => recordContinuation([], { type: "receipt_emitted", runId: "run", receiptId: "r", path: "/tmp/escape" }), /Invalid receipt_emitted path/, "absolute receipt path rejected");

if (failures > 0) { console.error(`\n${failures} event check(s) failed.`); process.exit(1); }
console.log("\nAll agent-event checks passed.");
