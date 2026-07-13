import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { writeWorkspaceFile } from "./tool-execution.mjs";
import { DIAGNOSTIC_PROVIDER_IDENTIFIERS, DIAGNOSTIC_STATUSES, DIAGNOSTIC_TOOL_OUTCOMES, RUN_TERMINALS, TOOL_NAMES } from "./contracts.ts";
import { normalizeProviderAttempt } from "./provider.mjs";

export const DIAGNOSTICS_DIR = "oaf/diagnostics";

const IDENTIFIER_RE = /^[A-Za-z0-9._:\/-]+$/;
const RUN_ID_MAX = 128;
const MODEL_MAX = 128;
const RECEIPT_FILENAME_RE = /^[A-Za-z0-9._-]+\.json$/;

const VERSION = "0.1.0";
const VALID_STATUSES = new Set(DIAGNOSTIC_STATUSES);
const VALID_TERMINAL_REASONS = new Set(RUN_TERMINALS.map(({ terminalReason }) => terminalReason));
const VALID_PROVIDERS = new Set(DIAGNOSTIC_PROVIDER_IDENTIFIERS);
const TOOL_OUTCOMES = new Set(DIAGNOSTIC_TOOL_OUTCOMES);
const VALID_TOOL_NAMES = new Set(TOOL_NAMES);

/** @param {unknown} status @param {unknown} terminalReason */
function normalizeLifecycle(status, terminalReason) {
  if (terminalReason === "assistant_terminal") {
    return { status: status === "partial" ? "partial" : "success", terminalReason };
  }
  if (terminalReason === "max_turns") return { status: "failed", terminalReason };
  return { status: "failed", terminalReason: "provider_error" };
}

const DIAGNOSTIC_KEYS = new Set(["schemaVersion", "createdAt", "runId", "provider", "requestedModel", "status", "terminalReason", "turns", "receiptPath", "providerAttempts", "tools"]);
const ATTEMPT_KEYS = new Set(["turn", "durationMs", "outcome", "httpStatus"]);
const TOOL_RECORD_KEYS = new Set(["toolName", "outcome"]);

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isValidIsoDate(value) {
  if (typeof value !== "string" || !ISO_RE.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function safeIdentifier(value, max) {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > max) return null;
  if (!IDENTIFIER_RE.test(value)) return null;
  return value;
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeReceiptPath(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("oaf/receipts/")) return null;
  if (trimmed.includes("..")) return null;
  if (trimmed.includes("\\")) return null;
  const filename = trimmed.slice("oaf/receipts/".length);
  if (filename.length === 0 || filename.length > 255) return null;
  if (filename.includes("/")) return null;
  if (!RECEIPT_FILENAME_RE.test(filename)) return null;
  return trimmed;
}

export function normalizeDiagnosticSchema(diagnostic) {
  if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) {
    throw new Error("diagnostic must be a non-null object");
  }
  const actualKeys = new Set(Object.keys(diagnostic));
  for (const key of actualKeys) if (!DIAGNOSTIC_KEYS.has(key)) throw new Error(`diagnostic has unsupported field: ${key}`);
  for (const key of DIAGNOSTIC_KEYS) if (!actualKeys.has(key)) throw new Error(`diagnostic is missing required field: ${key}`);

  const createdAt = isValidIsoDate(diagnostic.createdAt)
    ? diagnostic.createdAt
    : new Date().toISOString();

  const lifecycle = normalizeLifecycle(
    VALID_STATUSES.has(diagnostic.status) ? diagnostic.status : "failed",
    VALID_TERMINAL_REASONS.has(diagnostic.terminalReason) ? diagnostic.terminalReason : "provider_error",
  );

  return {
    schemaVersion: diagnostic.schemaVersion === VERSION ? VERSION : (() => { throw new Error("schemaVersion must be exactly 0.1.0"); })(),
    createdAt,
    runId: safeIdentifier(diagnostic.runId, RUN_ID_MAX) ?? "unknown",
    provider: diagnostic.provider === null ? null : VALID_PROVIDERS.has(diagnostic.provider) ? diagnostic.provider : null,
    requestedModel: diagnostic.requestedModel === null ? null : safeIdentifier(diagnostic.requestedModel, MODEL_MAX),
    ...lifecycle,
    turns: safeCount(diagnostic.turns) ?? 0,
    receiptPath: safeReceiptPath(diagnostic.receiptPath),
    providerAttempts: Array.isArray(diagnostic.providerAttempts) ? normalizeAttempts(diagnostic.providerAttempts) : [],
    tools: Array.isArray(diagnostic.tools) ? normalizeTools(diagnostic.tools) : [],
  };
}

function normalizeAttempts(attempts) {
  return attempts.map((attempt, index) => {
    const keys = Object.keys(attempt ?? {});
    for (const key of keys) if (!ATTEMPT_KEYS.has(key)) return { turn: index + 1, durationMs: 0, outcome: "unknown_provider_error", httpStatus: null };
    return normalizeProviderAttempt(attempt, index + 1);
  });
}

function normalizeTools(tools) {
  return tools.map((tool) => {
    const keys = Object.keys(tool ?? {});
    for (const key of keys) if (!TOOL_RECORD_KEYS.has(key)) return { toolName: null, outcome: "unknown" };
    return {
      toolName: tool.toolName === null ? null : VALID_TOOL_NAMES.has(tool.toolName) ? tool.toolName : null,
      outcome: TOOL_OUTCOMES.has(tool.outcome) ? tool.outcome : "unknown",
    };
  });
}

const status = (value) => VALID_STATUSES.has(value) ? value : "failed";

function toolEvents(events) {
  const calls = new Map();
  for (const event of events) {
    if (event.type === "tool_call") calls.set(event.toolCallId, { toolName: event.toolName, outcome: null });
    if (event.type === "tool_execution_end" && calls.has(event.toolCallId)) calls.get(event.toolCallId).outcome = event.success ? "success" : "execution_error";
    if (event.type === "tool_result" && calls.has(event.toolCallId) && event.errorCode === "rejected") calls.get(event.toolCallId).outcome = "rejected";
  }
  return [...calls.values()].map(({ toolName, outcome }) => ({ toolName: toolName === null ? null : VALID_TOOL_NAMES.has(toolName) ? toolName : null, outcome: TOOL_OUTCOMES.has(outcome) ? outcome : "unknown" }));
}

export function buildDiagnostic({ run, usage, receiptPath, receiptStatus }) {
  const lifecycle = normalizeLifecycle(
    status(receiptStatus ?? run.status),
    VALID_TERMINAL_REASONS.has(run.terminalReason) ? run.terminalReason : "provider_error",
  );
  const diagnostic = {
    schemaVersion: VERSION,
    createdAt: new Date().toISOString(),
    runId: typeof run.runId === "string" ? run.runId : "unknown",
    provider: typeof usage?.provider === "string" ? usage.provider : null,
    requestedModel: typeof usage?.model === "string" ? usage.model : null,
    ...lifecycle,
    turns: safeCount(run.turns) ?? 0,
    receiptPath: safeReceiptPath(receiptPath),
    providerAttempts: Array.isArray(run.providerAttempts) ? run.providerAttempts.map((attempt, index) => normalizeProviderAttempt(attempt, index + 1)) : [],
    tools: toolEvents(run.events ?? []),
  };
  return normalizeDiagnosticSchema(diagnostic);
}

export async function writeDiagnostic({ workspaceRoot, diagnostic }) {
  const normalized = normalizeDiagnosticSchema(diagnostic);
  mkdirSync(join(workspaceRoot, DIAGNOSTICS_DIR), { recursive: true });
  const path = `${DIAGNOSTICS_DIR}/${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}-${randomUUID().slice(0, 8)}.json`;
  await writeWorkspaceFile({ workspaceRoot, path, content: JSON.stringify(normalized, null, 2) });
  return path;
}
