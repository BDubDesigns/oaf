// Strict, JSON-serializable safe audit events. Raw task/model/tool data is
// deliberately excluded; the loop keeps it only in ephemeral conversation state.

import { safeProjectPath, validateCommandSummary } from "./privacy.mjs";
import { TOOL_NAMES } from "./tools.ts";
import {
  AGENT_EVENT_TYPES as AGENT_EVENT_TYPE_VALUES,
  EVENT_DISPOSITIONS,
  EVENT_ERROR_CODES,
  RUN_TERMINALS,
  type AgentEvent,
  type AgentEventFields,
  type AgentEventType,
  type EventCollector,
  type RecordedAgentEvent,
  type ToolName,
} from "./contracts.ts";

export const AGENT_EVENT_TYPES = [...AGENT_EVENT_TYPE_VALUES];
const KNOWN = new Set<string>(AGENT_EVENT_TYPES);
const DISPOSITIONS = new Set<string>(EVENT_DISPOSITIONS);
const ERROR_CODES = new Set<string>(EVENT_ERROR_CODES);
const STATUSES = new Set<string>(RUN_TERMINALS.map(({ status }) => status));
const TERMINAL_REASONS = new Set<string>(RUN_TERMINALS.map(({ terminalReason }) => terminalReason));
const TOOL_NAME_SET = new Set<string>(TOOL_NAMES);
const ID_RE = /^[A-Za-z0-9._:-]+$/;
const MAX_ID_LENGTH = 128;
const SUCCESS_FIELDS: Readonly<Record<ToolName, readonly string[]>> = {
  read: ["path", "bytes", "truncated"],
  list: ["path", "entryCount"],
  grep: ["matchCount", "fileCount"],
  write: ["path", "bytes"],
  command: ["exitCode", "stdoutBytes", "stderrBytes", "truncated"],
};

function plain(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function exact(fields: unknown, allowed: readonly string[]): asserts fields is Record<string, unknown> {
  if (!plain(fields)) throw new Error("Event fields must be an object");
  for (const key of Object.keys(fields)) if (!allowed.includes(key)) throw new Error(`Unsupported AgentEvent field: ${key}`);
  for (const key of allowed) if (!Object.hasOwn(fields, key)) throw new Error(`AgentEvent field is required: ${key}`);
}
function id(value: unknown, name: string): void { if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH || !ID_RE.test(value)) throw new Error(`Invalid ${name}`); }
function enumValue(value: unknown, allowed: ReadonlySet<string>, name: string): void { if (typeof value !== "string" || !allowed.has(value)) throw new Error(`Invalid ${name}`); }
function isToolName(value: unknown): value is ToolName { return typeof value === "string" && TOOL_NAME_SET.has(value); }

function summary(toolName: unknown, fields: unknown, result = false): void {
  if (!plain(fields)) throw new Error("Tool event summary must be an object");
  const allowed = result
    ? ({ read: ["path", "bytes", "truncated"], list: ["path", "entryCount"], grep: ["matchCount", "fileCount"], write: ["path", "bytes"], command: ["exitCode", "stdoutBytes", "stderrBytes", "truncated"] }[typeof toolName === "string" ? toolName : ""] ?? [])
    : ({ read: ["path"], list: ["path", "recursive"], grep: ["path"], write: ["path", "bytes"], command: ["command", "redacted", "mode"] }[typeof toolName === "string" ? toolName : ""] ?? []);
  for (const key of Object.keys(fields)) if (!allowed.includes(key)) throw new Error(`Unsupported tool summary field: ${key}`);
  if (typeof fields.path === "string" && safeProjectPath(fields.path) !== fields.path) throw new Error("Invalid tool summary path");
  for (const key of ["bytes", "entryCount", "matchCount", "fileCount", "stdoutBytes", "stderrBytes"]) if (fields[key] !== undefined && !integer(fields[key]) && fields[key] !== null) throw new Error("Invalid tool summary count");
  if (fields.exitCode !== undefined && fields.exitCode !== null && (typeof fields.exitCode !== "number" || !Number.isInteger(fields.exitCode) || fields.exitCode < 0 || fields.exitCode > 255)) throw new Error("Invalid tool summary exitCode");
  for (const key of ["truncated", "recursive", "redacted"]) if (fields[key] !== undefined && typeof fields[key] !== "boolean") throw new Error("Invalid tool summary boolean");
  if (fields.command !== undefined && typeof fields.command !== "string") throw new Error("Invalid tool summary command");
  if (fields.mode !== undefined && fields.mode !== null && typeof fields.mode !== "string") throw new Error("Invalid tool summary mode");
  if (toolName === "command" && !result) validateCommandSummary(fields);
}

function requireSuccessFields(toolName: unknown, fields: unknown): void {
  if (!plain(fields)) throw new Error("Tool event summary must be an object");
  if (!isToolName(toolName)) return;
  for (const field of SUCCESS_FIELDS[toolName]) if (!Object.hasOwn(fields, field) || fields[field] === null || fields[field] === undefined) throw new Error(`${toolName} success requires ${field}`);
}
function requireEmptySummary(fields: unknown): void { if (!plain(fields) || Object.keys(fields).length > 0) throw new Error("Error result must have empty summary"); }

function validate(type: AgentEventType, fields: unknown): void {
  if (type === "agent_start") {
    exact(fields, ["runId", "taskBytes", "taskProvided"]); id(fields.runId, "runId");
    if (!integer(fields.taskBytes) || typeof fields.taskProvided !== "boolean") throw new Error("Invalid agent_start fields");
  } else if (type === "turn_start" || type === "message_start") {
    exact(fields, ["turn"]); if (!integer(fields.turn) || fields.turn < 1) throw new Error(`Invalid ${type} turn`);
  } else if (type === "message_end") {
    exact(fields, ["turn", "disposition", "contentPresent", "contentBytes", "toolCallCount", "errorCode"]);
    if (!integer(fields.turn) || fields.turn < 1) throw new Error("Invalid message_end turn");
    enumValue(fields.disposition, DISPOSITIONS, "disposition");
    if (typeof fields.contentPresent !== "boolean") throw new Error("Invalid contentPresent");
    if (!integer(fields.contentBytes)) throw new Error("Invalid contentBytes");
    if (!integer(fields.toolCallCount)) throw new Error("Invalid toolCallCount");
    if (fields.errorCode !== null) enumValue(fields.errorCode, ERROR_CODES, "errorCode");
    if (fields.disposition === "provider_error" && fields.errorCode !== "provider_error") throw new Error("provider_error disposition requires provider_error errorCode");
    if (fields.disposition !== "provider_error" && fields.errorCode !== null) throw new Error("non-error disposition requires null errorCode");
    if (fields.disposition === "terminal" && fields.toolCallCount !== 0) throw new Error("terminal disposition requires zero toolCallCount");
    if (fields.disposition === "tool_calls" && fields.toolCallCount < 1) throw new Error("tool_calls disposition requires at least one tool call");
  } else if (type === "tool_call") {
    exact(fields, ["toolCallId", "toolName", "summary"]); id(fields.toolCallId, "toolCallId");
    if (fields.toolName !== null && (typeof fields.toolName !== "string" || fields.toolName.length > 64 || !TOOL_NAME_SET.has(fields.toolName))) throw new Error("Invalid tool_call toolName");
    summary(fields.toolName, fields.summary);
  } else if (type === "tool_execution_start" || type === "tool_execution_end") {
    exact(fields, type === "tool_execution_start" ? ["toolCallId", "toolName"] : ["toolCallId", "toolName", "success"]); id(fields.toolCallId, "toolCallId");
    if (typeof fields.toolName !== "string" || !TOOL_NAME_SET.has(fields.toolName)) throw new Error(`Invalid ${type} toolName`);
    if (type === "tool_execution_end" && typeof fields.success !== "boolean") throw new Error("Invalid tool_execution_end success");
  } else if (type === "tool_result") {
    exact(fields, ["toolCallId", "toolName", "summary", "errorCode"]); id(fields.toolCallId, "toolCallId");
    if (fields.toolName !== null && (typeof fields.toolName !== "string" || fields.toolName.length > 64 || !TOOL_NAME_SET.has(fields.toolName))) throw new Error("Invalid tool_result toolName");
    summary(fields.toolName, fields.summary, true);
    if (fields.errorCode !== null) { enumValue(fields.errorCode, ERROR_CODES, "errorCode"); requireEmptySummary(fields.summary); }
    else { if (fields.toolName === null) throw new Error("Successful tool_result requires a known toolName"); requireSuccessFields(fields.toolName, fields.summary); }
  } else if (type === "receipt_emitted") {
    exact(fields, ["runId", "receiptId", "path"]); id(fields.runId, "runId"); id(fields.receiptId, "receiptId");
    if (safeProjectPath(fields.path) !== fields.path) throw new Error("Invalid receipt_emitted path");
  } else {
    exact(fields, ["runId", "status", "turns", "terminalReason"]); id(fields.runId, "runId"); enumValue(fields.status, STATUSES, "status");
    if (!integer(fields.turns)) throw new Error("Invalid agent_end turns"); enumValue(fields.terminalReason, TERMINAL_REASONS, "terminalReason");
    if (fields.status === "success" && fields.terminalReason !== "assistant_terminal") throw new Error("success requires assistant_terminal");
    if (fields.status === "exhausted" && fields.terminalReason !== "max_turns") throw new Error("exhausted requires max_turns");
    if (fields.status === "failed" && fields.terminalReason !== "provider_error") throw new Error("failed requires provider_error");
  }
}

type ExactEventFields<Type extends AgentEventType, Fields> = Exclude<keyof Fields, keyof AgentEventFields<Type>> extends never ? Fields : never;
type CheckedEventFields<Fields> = Fields extends { disposition: "tool_calls"; toolCallCount: 0 } ? never : Fields;

export function createEvent<Type extends AgentEventType, Fields extends AgentEventFields<Type>>(type: Type, fields: Fields & ExactEventFields<Type, Fields> & CheckedEventFields<Fields>): Extract<AgentEvent, { type: Type }>;
export function createEvent(type: AgentEventType, fields: unknown = {}): AgentEvent {
  if (!KNOWN.has(type)) throw new Error(`Unknown AgentEvent type: ${type}`);
  if (!plain(fields)) throw new Error("Event fields must be an object");
  if ("type" in fields) throw new Error("fields must not contain a 'type' property; it would override the validated event type");
  validate(type, fields);
  return { type, ...fields } as AgentEvent;
}

function createValidatedEvent(type: AgentEventType, fields: unknown): AgentEvent {
  return Reflect.apply(createEvent, undefined, [type, fields]);
}

export function createEventCollector(): EventCollector {
  let events: RecordedAgentEvent[] = [];
  let seq = 0;
  return {
    record(event: AgentEvent): RecordedAgentEvent {
      if (!plain(event) || !("type" in event)) throw new Error("Event must be an object with a type");
      const { type, ...untrustedFields } = event;
      const fields = Object.fromEntries(Object.entries(untrustedFields).filter(([key]) => key !== "seq" && key !== "ts"));
      const recorded = { ...createValidatedEvent(type, fields), seq: ++seq, ts: new Date().toISOString() };
      events.push(recorded);
      return recorded;
    },
    all(): RecordedAgentEvent[] { return events.slice(); },
    clear(): void { events = []; seq = 0; },
  };
}

export function recordContinuation(events: readonly unknown[], event: AgentEvent): RecordedAgentEvent {
  const lastSeq = events.reduce<number>((max, current) => {
    if (!plain(current) || !integer(current.seq)) return max;
    return Math.max(max, current.seq);
  }, 0);
  const { type, ...fields } = event;
  return { ...createValidatedEvent(type, fields), seq: lastSeq + 1, ts: new Date().toISOString() };
}
