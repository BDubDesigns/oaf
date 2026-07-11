// Minimal event model for the first OAF-owned agent loop.
//
// Events are plain, JSON-serializable objects. The collector records them in
// order; later stages (receipt emission, tests) consume the collected stream.
//
// This module is intentionally tiny and dependency-free. It defines only the
// shared vocabulary: what the loop records and what receipts consume. It does
// not implement the loop, tools, or receipt writing.

export const AGENT_EVENT_TYPES = [
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
];

const KNOWN = new Set(AGENT_EVENT_TYPES);

// Create a single event of a known type. `type` must be a known AgentEvent
// type; unknown types are rejected so the vocabulary stays strict and receipt
// schemas stay stable. `fields` are passed through unchanged (validated later
// by the stages that consume them, not here).
export function createEvent(type, fields = {}) {
  if (!KNOWN.has(type)) {
    throw new Error(`Unknown AgentEvent type: ${type}`);
  }
  if ("type" in fields) {
    throw new Error("fields must not contain a 'type' property; it would override the validated event type");
  }
  return { type, ...fields };
}

// Tiny in-memory collector for tests and later receipt emission.
//
//   record(event) -> appends the event with an assigned seq + timestamp
//   all()         -> returns recorded events in order (shallow copy)
//   clear()       -> resets the collector (events + sequence counter)
export function createEventCollector() {
  let events = [];
  let seq = 0;

  return {
    record(event) {
      if (!event || typeof event !== "object" || !("type" in event)) {
        throw new Error("Event must be an object with a type");
      }
      if (!KNOWN.has(event.type)) {
        throw new Error(`Unknown AgentEvent type: ${event.type}`);
      }
      const recorded = { ...event, seq: ++seq, ts: new Date().toISOString() };
      events.push(recorded);
      return recorded;
    },
    all() {
      return events.slice();
    },
    clear() {
      events = [];
      seq = 0;
    },
  };
}

// Record one more event onto an ALREADY-RECORDED stream, assigning it the next
// sequence number and a fresh ISO timestamp. This lets a layer that owns a
// completed event stream (e.g. the receipt emitter, which receives the loop's
// recorded events) append one event without re-implementing sequence/timestamp
// logic. The returned event carries `seq` exactly one greater than the highest
// existing sequence and a parseable ISO `ts`, so it is indistinguishable from a
// collector-recorded event.
export function recordContinuation(events, fields) {
  const lastSeq = events.reduce(
    (max, event) => (typeof event?.seq === "number" ? Math.max(max, event.seq) : max),
    0,
  );
  const { type, ...rest } = fields;
  const recorded = createEvent(type, rest);
  return { ...recorded, seq: lastSeq + 1, ts: new Date().toISOString() };
}
