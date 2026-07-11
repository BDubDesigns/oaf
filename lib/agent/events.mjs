// Strict, JSON-serializable safe audit events. Raw task/model/tool data is
// deliberately excluded; the loop keeps it only in ephemeral conversation state.

import { safeProjectPath } from "./privacy.mjs";

export const AGENT_EVENT_TYPES = ["agent_start", "turn_start", "message_start", "message_end", "tool_call", "tool_execution_start", "tool_execution_end", "tool_result", "receipt_emitted", "agent_end"];
const KNOWN = new Set(AGENT_EVENT_TYPES);
const DISPOSITIONS = new Set(["terminal", "tool_calls", "provider_error"]);
const ERROR_CODES = new Set(["provider_error", "rejected", "execution_error"]);

function plain(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function integer(value) { return Number.isInteger(value) && value >= 0; }
function exact(fields, allowed) {
  if (!plain(fields)) throw new Error("Event fields must be an object");
  for (const key of Object.keys(fields)) if (!allowed.includes(key)) throw new Error(`Unsupported AgentEvent field: ${key}`);
  for (const key of allowed) if (!Object.hasOwn(fields, key)) throw new Error(`AgentEvent field is required: ${key}`);
}
function id(value, name) { if (typeof value !== "string" || value.length === 0 || value.length > 128) throw new Error(`Invalid ${name}`); }
function summary(toolName, fields, result = false) {
  if (!plain(fields)) throw new Error("Tool event summary must be an object");
  const allowed = result
    ? ({ read: ["path", "bytes", "truncated"], list: ["path", "entryCount"], grep: ["matchCount", "fileCount"], write: ["path", "bytes"], command: ["exitCode", "stdoutBytes", "stderrBytes", "truncated"] }[toolName] ?? [])
    : ({ read: ["path"], list: ["path", "recursive"], grep: ["path"], write: ["path", "bytes"], command: ["command", "redacted", "mode", "network", "confirm"] }[toolName] ?? []);
  for (const key of Object.keys(fields)) if (!allowed.includes(key)) throw new Error(`Unsupported tool summary field: ${key}`);
  if (typeof fields.path === "string" && safeProjectPath(fields.path) !== fields.path) throw new Error("Invalid tool summary path");
  for (const key of ["bytes", "entryCount", "matchCount", "fileCount", "stdoutBytes", "stderrBytes"]) if (fields[key] !== undefined && !integer(fields[key]) && fields[key] !== null) throw new Error("Invalid tool summary count");
  if (fields.exitCode !== undefined && fields.exitCode !== null && !Number.isInteger(fields.exitCode)) throw new Error("Invalid tool summary exitCode");
  for (const key of ["truncated", "recursive", "redacted", "network", "confirm"]) if (fields[key] !== undefined && typeof fields[key] !== "boolean") throw new Error("Invalid tool summary boolean");
  if (fields.command !== undefined && typeof fields.command !== "string") throw new Error("Invalid tool summary command");
  if (fields.mode !== undefined && fields.mode !== null && typeof fields.mode !== "string") throw new Error("Invalid tool summary mode");
}

function validate(type, fields) {
  if (type === "agent_start") { exact(fields, ["runId", "taskBytes", "taskProvided"]); id(fields.runId, "runId"); if (!integer(fields.taskBytes) || typeof fields.taskProvided !== "boolean") throw new Error("Invalid agent_start fields"); }
  else if (type === "turn_start" || type === "message_start") { exact(fields, ["turn"]); if (!integer(fields.turn) || fields.turn < 1) throw new Error(`Invalid ${type} turn`); }
  else if (type === "message_end") {
    exact(fields, ["turn", "disposition", "contentPresent", "contentBytes", "toolCallCount", "errorCode"]);
    if (!integer(fields.turn) || fields.turn < 1 || !DISPOSITIONS.has(fields.disposition) || typeof fields.contentPresent !== "boolean" || !integer(fields.contentBytes) || !integer(fields.toolCallCount) || (fields.errorCode !== null && !ERROR_CODES.has(fields.errorCode))) throw new Error("Invalid message_end fields");
  } else if (type === "tool_call") { exact(fields, ["toolCallId", "toolName", "summary"]); id(fields.toolCallId, "toolCallId"); if (fields.toolName !== null && (typeof fields.toolName !== "string" || fields.toolName.length > 64)) throw new Error("Invalid tool_call toolName"); summary(fields.toolName, fields.summary); }
  else if (type === "tool_execution_start") { exact(fields, ["toolCallId", "toolName"]); id(fields.toolCallId, "toolCallId"); id(fields.toolName, "toolName"); }
  else if (type === "tool_execution_end") { exact(fields, ["toolCallId", "toolName", "success"]); id(fields.toolCallId, "toolCallId"); id(fields.toolName, "toolName"); if (typeof fields.success !== "boolean") throw new Error("Invalid tool_execution_end success"); }
  else if (type === "tool_result") { exact(fields, ["toolCallId", "toolName", "summary", "errorCode"]); id(fields.toolCallId, "toolCallId"); if (fields.toolName !== null && (typeof fields.toolName !== "string" || fields.toolName.length > 64)) throw new Error("Invalid tool_result toolName"); summary(fields.toolName, fields.summary, true); if (fields.errorCode !== null && !ERROR_CODES.has(fields.errorCode)) throw new Error("Invalid tool_result errorCode"); }
  else if (type === "receipt_emitted") { exact(fields, ["runId", "receiptId", "path"]); id(fields.runId, "runId"); id(fields.receiptId, "receiptId"); if (safeProjectPath(fields.path) !== fields.path) throw new Error("Invalid receipt_emitted path"); }
  else if (type === "agent_end") { exact(fields, ["runId", "status", "turns", "terminalReason"]); id(fields.runId, "runId"); if (typeof fields.status !== "string" || !integer(fields.turns) || typeof fields.terminalReason !== "string") throw new Error("Invalid agent_end fields"); }
}

export function createEvent(type, fields = {}) {
  if (!KNOWN.has(type)) throw new Error(`Unknown AgentEvent type: ${type}`);
  if ("type" in fields) throw new Error("fields must not contain a 'type' property; it would override the validated event type");
  validate(type, fields);
  return { type, ...fields };
}

export function createEventCollector() {
  let events = []; let seq = 0;
  return {
    record(event) { if (!event || typeof event !== "object" || !("type" in event)) throw new Error("Event must be an object with a type"); const { type, seq: ignoredSeq, ts: ignoredTs, ...fields } = event; const recorded = { ...createEvent(type, fields), seq: ++seq, ts: new Date().toISOString() }; events.push(recorded); return recorded; },
    all() { return events.slice(); },
    clear() { events = []; seq = 0; },
  };
}

export function recordContinuation(events, fields) {
  const lastSeq = events.reduce((max, event) => (typeof event?.seq === "number" ? Math.max(max, event.seq) : max), 0);
  const { type, ...rest } = fields;
  return { ...createEvent(type, rest), seq: lastSeq + 1, ts: new Date().toISOString() };
}
