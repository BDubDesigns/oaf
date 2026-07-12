import { join, normalize, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { writeWorkspaceFile } from "./tool-execution.mjs";

export const DIAGNOSTICS_DIR = "oaf/diagnostics";

const IDENTIFIER_RE = /^[A-Za-z0-9._:\/-]+$/;
const RUN_ID_MAX = 128;
const PROVIDER_MAX = 64;
const MODEL_MAX = 128;
const TOOL_NAME_MAX = 64;

const VERSION = "0.1.0";
const VALID_STATUSES = new Set(["success", "partial", "failed", "exhausted"]);
const VALID_TERMINAL_REASONS = new Set(["assistant_terminal", "provider_error", "max_turns"]);
const PROVIDER_OUTCOMES = new Set(["success", "authentication_failed", "not_found", "rate_limited", "http_error", "timeout", "network_error", "invalid_json", "response_too_large", "invalid_response", "unknown_provider_error"]);
const TOOL_OUTCOMES = new Set(["success", "rejected", "execution_error", "unknown"]);

const DIAGNOSTIC_KEYS = new Set(["schemaVersion", "createdAt", "runId", "provider", "requestedModel", "status", "terminalReason", "turns", "receiptPath", "providerAttempts", "tools"]);
const ATTEMPT_KEYS = new Set(["turn", "durationMs", "outcome", "httpStatus"]);
const TOOL_RECORD_KEYS = new Set(["toolName", "outcome"]);

function safeIdentifier(value, max) {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > max) return null;
  if (!IDENTIFIER_RE.test(value)) return null;
  return value;
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeAttempts(attempts) {
  return attempts.map((attempt, index) => {
    const keys = Object.keys(attempt ?? {});
    for (const key of keys) if (!ATTEMPT_KEYS.has(key)) return { turn: index + 1, durationMs: 0, outcome: "unknown_provider_error", httpStatus: null };
    return {
      turn: safeCount(attempt.turn) ?? index + 1,
      durationMs: safeCount(attempt.durationMs) ?? 0,
      outcome: PROVIDER_OUTCOMES.has(attempt.outcome) ? attempt.outcome : "unknown_provider_error",
      httpStatus: Number.isInteger(attempt.httpStatus) && attempt.httpStatus >= 100 && attempt.httpStatus <= 599 ? attempt.httpStatus : null,
    };
  });
}

function normalizeTools(tools) {
  return tools.map((tool) => {
    const keys = Object.keys(tool ?? {});
    for (const key of keys) if (!TOOL_RECORD_KEYS.has(key)) return { toolName: null, outcome: "unknown" };
    return {
      toolName: typeof tool.toolName === "string" && tool.toolName.length <= TOOL_NAME_MAX ? tool.toolName : null,
      outcome: TOOL_OUTCOMES.has(tool.outcome) ? tool.outcome : "unknown",
    };
  });
}

export function normalizeDiagnosticSchema(diagnostic) {
  if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) {
    throw new Error("diagnostic must be a non-null object");
  }
  const actualKeys = new Set(Object.keys(diagnostic));
  for (const key of actualKeys) if (!DIAGNOSTIC_KEYS.has(key)) throw new Error(`diagnostic has unsupported field: ${key}`);
  for (const key of DIAGNOSTIC_KEYS) if (!actualKeys.has(key)) throw new Error(`diagnostic is missing required field: ${key}`);

  return {
    schemaVersion: typeof diagnostic.schemaVersion === "string" ? diagnostic.schemaVersion : VERSION,
    createdAt: typeof diagnostic.createdAt === "string" ? diagnostic.createdAt : new Date().toISOString(),
    runId: safeIdentifier(diagnostic.runId, RUN_ID_MAX) ?? "unknown",
    provider: diagnostic.provider === null ? null : safeIdentifier(diagnostic.provider, PROVIDER_MAX),
    requestedModel: diagnostic.requestedModel === null ? null : safeIdentifier(diagnostic.requestedModel, MODEL_MAX),
    status: VALID_STATUSES.has(diagnostic.status) ? diagnostic.status : "failed",
    terminalReason: VALID_TERMINAL_REASONS.has(diagnostic.terminalReason) ? diagnostic.terminalReason : "provider_error",
    turns: safeCount(diagnostic.turns) ?? 0,
    receiptPath: typeof diagnostic.receiptPath === "string" && diagnostic.receiptPath.startsWith("oaf/receipts/") && normalize(diagnostic.receiptPath).startsWith("oaf/receipts/") && !relative("oaf/receipts", normalize(diagnostic.receiptPath)).startsWith("..") ? diagnostic.receiptPath : null,
    providerAttempts: Array.isArray(diagnostic.providerAttempts) ? normalizeAttempts(diagnostic.providerAttempts) : [],
    tools: Array.isArray(diagnostic.tools) ? normalizeTools(diagnostic.tools) : [],
  };
}

const status = (value) => VALID_STATUSES.has(value) ? value : "failed";
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;

function toolEvents(events) {
  const calls = new Map();
  for (const event of events) {
    if (event.type === "tool_call") calls.set(event.toolCallId, { toolName: event.toolName, outcome: null });
    if (event.type === "tool_execution_end" && calls.has(event.toolCallId)) calls.get(event.toolCallId).outcome = event.success ? "success" : "execution_error";
    if (event.type === "tool_result" && calls.has(event.toolCallId) && event.errorCode === "rejected") calls.get(event.toolCallId).outcome = "rejected";
  }
  return [...calls.values()].map(({ toolName, outcome }) => ({ toolName: typeof toolName === "string" && toolName.length <= 64 ? toolName : null, outcome: TOOL_OUTCOMES.has(outcome) ? outcome : "unknown" }));
}

export function buildDiagnostic({ run, usage, receiptPath, receiptStatus }) {
  return {
    schemaVersion: VERSION,
    createdAt: new Date().toISOString(),
    runId: typeof run.runId === "string" ? run.runId : "unknown",
    provider: typeof usage?.provider === "string" ? usage.provider : null,
    requestedModel: typeof usage?.model === "string" ? usage.model : null,
    status: status(receiptStatus ?? run.status),
    terminalReason: VALID_TERMINAL_REASONS.has(run.terminalReason) ? run.terminalReason : "provider_error",
    turns: count(run.turns) ?? 0,
    receiptPath: typeof receiptPath === "string" && receiptPath.startsWith("oaf/receipts/") && normalize(receiptPath).startsWith("oaf/receipts/") && !relative("oaf/receipts", normalize(receiptPath)).startsWith("..") ? receiptPath : null,
    providerAttempts: Array.isArray(run.providerAttempts) ? run.providerAttempts.map((attempt, index) => ({ turn: count(attempt?.turn) ?? index + 1, durationMs: count(attempt?.durationMs) ?? 0, outcome: PROVIDER_OUTCOMES.has(attempt?.outcome) ? attempt.outcome : "unknown_provider_error", httpStatus: Number.isInteger(attempt?.httpStatus) && attempt.httpStatus >= 100 && attempt.httpStatus <= 599 ? attempt.httpStatus : null })) : [],
    tools: toolEvents(run.events),
  };
}

export async function writeDiagnostic({ workspaceRoot, diagnostic }) {
  const normalized = normalizeDiagnosticSchema(diagnostic);
  mkdirSync(join(workspaceRoot, DIAGNOSTICS_DIR), { recursive: true });
  const path = `${DIAGNOSTICS_DIR}/${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}-${randomUUID().slice(0, 8)}.json`;
  await writeWorkspaceFile({ workspaceRoot, path, content: JSON.stringify(normalized, null, 2) });
  return path;
}
