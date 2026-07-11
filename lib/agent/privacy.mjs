// Shared privacy helpers for durable AgentEvents and receipts. Exact provider
// conversation data stays in the loop; callers use these bounded summaries for
// audit data only.

import { CANONICAL_COMMANDS, CANONICAL_COMMAND_SET } from "../command-policy.mjs";

const MAX_PATH_BYTES = 512;
const CONTROL_CHAR_RE = /[\x00-\x1f]/;

// Canonical recordable commands. These are the only command strings that
// retain their identity in durable audit data. Recordability is separate
// from execution trust: repository-controlled package scripts can change
// their behavior independently of this policy.
export { CANONICAL_COMMANDS, CANONICAL_COMMAND_SET };
export const COMMAND_MODES = new Set(["plan", "edit", "test", "browser", "install", "research"]);
const REDACTED_MARKER = "<redacted command>";

export function utf8Bytes(value) {
  return typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0;
}

export function safeProjectPath(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  if (Buffer.byteLength(value, "utf8") > MAX_PATH_BYTES) return null;
  if (CONTROL_CHAR_RE.test(value)) return null;
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return null;
  if (value.split(/[\\/]+/).includes("..")) return null;
  return value.replace(/\\/g, "/");
}

// Omission-by-default command recording policy. Only exact canonical
// command strings are identifiable in durable audit data.
export function summarizeCommand(command) {
  if (typeof command !== "string" || !CANONICAL_COMMAND_SET.has(command)) {
    return { command: REDACTED_MARKER, redacted: true };
  }
  return { command, redacted: false };
}

// Validate a command summary at the event-schema level. The loop uses
// summarizeCommand(), but direct createEvent() calls must also be safe.
export function validateCommandSummary(fields) {
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error("Command summary must be an object");
  }
  if (typeof fields.command !== "string") {
    throw new Error("Command summary must have a string command");
  }
  if (typeof fields.redacted !== "boolean") {
    throw new Error("Command summary must have a boolean redacted");
  }
  if (fields.redacted === true) {
    if (fields.command !== REDACTED_MARKER) {
      throw new Error("Redacted command must be exactly '<redacted command>'");
    }
  } else {
    if (!CANONICAL_COMMAND_SET.has(fields.command)) {
      throw new Error("Non-redacted command must be a canonical recordable command");
    }
  }
  if (fields.mode !== null && fields.mode !== undefined && !COMMAND_MODES.has(fields.mode)) {
    throw new Error("Command mode must be a valid sandbox mode or null");
  }
}

export function safeCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function optionalPath(value) {
  const path = safeProjectPath(value);
  return path === null ? {} : { path };
}

export function summarizeToolCall(toolName, args) {
  const input = args && typeof args === "object" ? args : {};
  if (toolName === "read") return optionalPath(input.path);
  if (toolName === "list") return { ...optionalPath(input.path), recursive: input.recursive === true };
  if (toolName === "grep") return optionalPath(input.path ?? ".");
  if (toolName === "write") return { ...optionalPath(input.path), bytes: typeof input.content === "string" ? utf8Bytes(input.content) : null };
  if (toolName === "command") {
    const command = summarizeCommand(input.command);
    return {
      ...command,
      mode: COMMAND_MODES.has(input.mode) ? input.mode : null,
    };
  }
  return {};
}

export function summarizeToolResult(toolName, result) {
  const output = result && typeof result === "object" ? result : {};
  if (toolName === "read") return { ...optionalPath(output.path), bytes: safeCount(utf8Bytes(output.content)), truncated: output.truncated === true };
  if (toolName === "list") return { ...optionalPath(output.path), entryCount: safeCount(Array.isArray(output.entries) ? output.entries.length : 0) };
  if (toolName === "grep") {
    const matches = Array.isArray(output.matches) ? output.matches : [];
    return { matchCount: safeCount(matches.length), fileCount: safeCount(new Set(matches.map((match) => safeProjectPath(match?.path)).filter(Boolean)).size) };
  }
  if (toolName === "write") return { ...optionalPath(output.path), bytes: safeCount(Number.isInteger(output.bytes) && output.bytes >= 0 ? output.bytes : null) };
  if (toolName === "command") return {
    exitCode: Number.isInteger(output.exitCode) && output.exitCode >= 0 && output.exitCode <= 255 ? output.exitCode : null,
    stdoutBytes: safeCount(utf8Bytes(output.stdout)),
    stderrBytes: safeCount(utf8Bytes(output.stderr)),
    truncated: output.truncated === true,
  };
  return {};
}
