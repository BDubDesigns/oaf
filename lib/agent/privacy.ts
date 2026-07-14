// Shared privacy helpers for durable AgentEvents and receipts. Exact provider
// conversation data stays in the loop; callers use these bounded summaries for
// audit data only.

import { CANONICAL_COMMANDS, canonicalCommand } from "../command-policy.ts";
import { SANDBOX_MODES } from "./contracts.ts";
import type { SandboxMode, ToolArguments, ToolCallSummary, ToolExecutorResults, ToolName, ToolResultSummary } from "./contracts.ts";

const MAX_PATH_BYTES = 512;
const CONTROL_CHAR_RE = /[\x00-\x1f]/;
const REDACTED_MARKER = "<redacted command>";

type CanonicalCommand = (typeof CANONICAL_COMMANDS)[number]["command"];
type CommandSummary =
  | { command: CanonicalCommand; redacted: false }
  | { command: typeof REDACTED_MARKER; redacted: true };
type ToolCallInput = { path?: unknown; recursive?: unknown; content?: unknown; command?: unknown; mode?: unknown };
type ToolResultInput = { path?: unknown; content?: unknown; truncated?: unknown; entries?: unknown; matches?: unknown; bytes?: unknown; exitCode?: unknown; stdout?: unknown; stderr?: unknown };
type ToolResultCandidate = Omit<ToolResultSummary, "write" | "command"> & {
  write: { path?: string; bytes: number | null };
  command: { exitCode: number | null; stdoutBytes: number; stderrBytes: number; truncated: boolean };
};

// Canonical recordable commands. These are the only command strings that
// retain their identity in durable audit data. Recordability is separate
// from execution trust: repository-controlled package scripts can change
// their behavior independently of this policy.
export { CANONICAL_COMMANDS };
export const COMMAND_MODES = new Set<string>(SANDBOX_MODES);

export function utf8Bytes(value: unknown): number {
  return typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0;
}

export function safeProjectPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (Buffer.byteLength(value, "utf8") > MAX_PATH_BYTES) return null;
  if (CONTROL_CHAR_RE.test(value)) return null;
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return null;
  if (value.split(/[\\/]+/).includes("..")) return null;
  return value.replace(/\\/g, "/");
}

// Omission-by-default command recording policy. Only exact canonical
// command strings are identifiable in durable audit data.
export function summarizeCommand(command: unknown): CommandSummary {
  if (typeof command !== "string") return { command: REDACTED_MARKER, redacted: true };
  const canonical = canonicalCommand(command);
  return canonical === null
    ? { command: REDACTED_MARKER, redacted: true }
    : { command: canonical.command, redacted: false };
}

// Validate a command summary at the event-schema level. The loop uses
// summarizeCommand(), but direct createEvent() calls must also be safe.
export function validateCommandSummary(fields: unknown): void {
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error("Command summary must be an object");
  }
  // The object check above establishes the only runtime invariant this helper
  // needs: its existing direct property reads may observe inherited fields.
  const summary = fields as { command?: unknown; redacted?: unknown; mode?: unknown };
  if (typeof summary.command !== "string") {
    throw new Error("Command summary must have a string command");
  }
  if (typeof summary.redacted !== "boolean") {
    throw new Error("Command summary must have a boolean redacted");
  }
  if (summary.redacted === true) {
    if (summary.command !== REDACTED_MARKER) {
      throw new Error("Redacted command must be exactly '<redacted command>'");
    }
  } else if (canonicalCommand(summary.command) === null) {
    throw new Error("Non-redacted command must be a canonical recordable command");
  }
  if (summary.mode !== null && summary.mode !== undefined && !isSandboxMode(summary.mode)) {
    throw new Error("Command mode must be a valid sandbox mode or null");
  }
}

export function safeCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function callInput(value: unknown): ToolCallInput {
  // Preserve the historical truthy-object boundary, including arrays, class
  // instances, and null-prototype records.
  return value && typeof value === "object" ? value as ToolCallInput : {};
}

function resultInput(value: unknown): ToolResultInput {
  return value && typeof value === "object" ? value as ToolResultInput : {};
}

function optionalPath(value: unknown): { path?: string } {
  const path = safeProjectPath(value);
  return path === null ? {} : { path };
}

function isSandboxMode(value: unknown): value is SandboxMode {
  return typeof value === "string" && COMMAND_MODES.has(value);
}

export function summarizeToolCall<Name extends ToolName>(toolName: Name, args: ToolArguments[Name]): ToolCallSummary[Name];
export function summarizeToolCall(toolName: ToolName, args: unknown): ToolCallSummary[ToolName] | {};
export function summarizeToolCall(toolName: ToolName, args: unknown): ToolCallSummary[ToolName] | {} {
  const input = callInput(args);
  if (toolName === "read") return optionalPath(input.path);
  if (toolName === "list") return { ...optionalPath(input.path), recursive: input.recursive === true };
  if (toolName === "grep") return optionalPath(input.path ?? ".");
  if (toolName === "write") return { ...optionalPath(input.path), bytes: typeof input.content === "string" ? utf8Bytes(input.content) : null };
  if (toolName === "command") {
    const command = summarizeCommand(input.command);
    return { ...command, mode: isSandboxMode(input.mode) ? input.mode : null };
  }
  return {};
}

function matchPath(match: unknown): unknown {
  if (match === null || typeof match !== "object") return undefined;
  return (match as { path?: unknown }).path;
}

export function summarizeToolResult<Name extends ToolName>(toolName: Name, result: ToolExecutorResults[Name]): ToolResultCandidate[Name];
export function summarizeToolResult(toolName: ToolName, result: unknown): ToolResultCandidate[ToolName] | {} {
  const output = resultInput(result);
  if (toolName === "read") return { ...optionalPath(output.path), bytes: safeCount(utf8Bytes(output.content)), truncated: output.truncated === true };
  if (toolName === "list") return { ...optionalPath(output.path), entryCount: safeCount(Array.isArray(output.entries) ? output.entries.length : 0) };
  if (toolName === "grep") {
    const matches: unknown[] = Array.isArray(output.matches) ? output.matches : [];
    return { matchCount: safeCount(matches.length), fileCount: safeCount(new Set(matches.map((match) => safeProjectPath(matchPath(match))).filter(Boolean)).size) };
  }
  if (toolName === "write") return { ...optionalPath(output.path), bytes: safeCount(typeof output.bytes === "number" && Number.isInteger(output.bytes) && output.bytes >= 0 ? output.bytes : null) };
  if (toolName === "command") return {
    exitCode: typeof output.exitCode === "number" && Number.isInteger(output.exitCode) && output.exitCode >= 0 && output.exitCode <= 255 ? output.exitCode : null,
    stdoutBytes: safeCount(utf8Bytes(output.stdout)),
    stderrBytes: safeCount(utf8Bytes(output.stderr)),
    truncated: output.truncated === true,
  };
  return {};
}
