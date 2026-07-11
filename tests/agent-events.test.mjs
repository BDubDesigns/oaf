// Focused test for the minimal AgentEvent model.
// Uses only Node built-ins; no third-party dependencies.
import { strictEqual, deepEqual, throws, doesNotThrow } from "node:assert";
import {
  AGENT_EVENT_TYPES,
  createEvent,
  createEventCollector,
  recordContinuation,
} from "../lib/agent/events.mjs";

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`PASS  ${msg}`);
  } else {
    console.log(`FAIL  ${msg}`);
    failures++;
  }
}

// 1. Known vocabulary
assert(AGENT_EVENT_TYPES.length === 10, "exactly 10 AgentEvent types defined");
for (const t of [
  "agent_start",
  "turn_start",
  "message_start",
  "message_end",
  "tool_call",
  "tool_execution_start",
  "tool_execution_end",
  "tool_result",
  "receipt_emitted",
  "agent_end",
]) {
  assert(AGENT_EVENT_TYPES.includes(t), `type present: ${t}`);
}

// 2. event objects have expected shape
const start = createEvent("agent_start", { runId: "run_1" });
deepEqual(start, { type: "agent_start", runId: "run_1" }, "createEvent returns plain object with type + fields");
strictEqual(start.type, "agent_start", "event carries its type");

const toolCall = createEvent("tool_call", { toolCallId: "c1", toolName: "read", args: { path: "app/page.tsx" } });
strictEqual(toolCall.toolName, "read", "tool_call carries toolName");
strictEqual(toolCall.toolCallId, "c1", "tool_call carries toolCallId");

// 3. unknown event types are rejected
throws(() => createEvent("not_a_real_event"), /Unknown AgentEvent type/, "createEvent rejects unknown type");

// 3b. fields must not override the validated type
throws(
  () => createEvent("agent_start", { type: "bogus" }),
  /must not contain a 'type' property/,
  "createEvent rejects fields.type override",
);
throws(
  () => createEvent("agent_start", { type: "agent_start" }),
  /must not contain a 'type' property/,
  "createEvent rejects duplicate fields.type even when equal",
);

// 4. collector records events in order
const c = createEventCollector();
c.record(createEvent("agent_start", { runId: "run_1" }));
c.record(createEvent("tool_call", { toolCallId: "c1", toolName: "read" }));
c.record(createEvent("agent_end", { status: "success" }));
const all = c.all();
strictEqual(all.length, 3, "collector recorded 3 events");
strictEqual(all[0].type, "agent_start", "first recorded is agent_start");
strictEqual(all[1].type, "tool_call", "second recorded is tool_call");
strictEqual(all[2].type, "agent_end", "third recorded is agent_end");
strictEqual(all[0].seq, 1, "seq assigned in order (1)");
strictEqual(all[1].seq, 2, "seq assigned in order (2)");
strictEqual(all[2].seq, 3, "seq assigned in order (3)");
assert(typeof all[0].ts === "string" && !Number.isNaN(Date.parse(all[0].ts)), "recorded event gets an ISO timestamp");

// 5. collector returns JSON-serializable data
let serialized;
doesNotThrow(() => {
  serialized = JSON.parse(JSON.stringify(all));
}, "collected events are JSON-serializable");
strictEqual(serialized.length, 3, "serialized stream keeps all events");
strictEqual(serialized[1].toolName, "read", "serialized event preserves fields");

// 6. collector rejects unknown types
const c2 = createEventCollector();
throws(() => c2.record({ type: "bogus" }), /Unknown AgentEvent type/, "collector rejects unknown type");
throws(() => c2.record("not-an-object"), /object with a type/, "collector rejects non-object");

// 7. clear/reset
c.clear();
strictEqual(c.all().length, 0, "clear() empties the collector");
c.record(createEvent("agent_start", { runId: "run_2" }));
strictEqual(c.all()[0].seq, 1, "seq resets after clear()");

// 8. A continuation event keeps the shared recorded-event shape after a loop.
const continued = recordContinuation(
  [
    { type: "agent_start", runId: "run_3", seq: 7, ts: "2000-01-01T00:00:00.000Z" },
    { type: "agent_end", status: "success", seq: 8, ts: "2000-01-01T00:00:01.000Z" },
  ],
  { type: "receipt_emitted", receiptId: "rcpt_1" },
);
strictEqual(continued.type, "receipt_emitted", "continuation retains its validated event type");
strictEqual(continued.seq, 9, "continuation seq is one greater than the prior stream");
assert(typeof continued.ts === "string" && !Number.isNaN(Date.parse(continued.ts)), "continuation gets an ISO timestamp");
throws(
  () => recordContinuation([], { type: "bogus" }),
  /Unknown AgentEvent type/,
  "continuation rejects unknown event types",
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll agent-event checks passed.");
