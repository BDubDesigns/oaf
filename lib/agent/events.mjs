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
