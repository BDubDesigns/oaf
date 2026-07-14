import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  DIAGNOSTIC_PROVIDER_IDENTIFIERS,
  DIAGNOSTIC_STATUSES,
  DIAGNOSTIC_TOOL_OUTCOMES,
  RUN_TERMINALS,
  TOOL_NAMES,
  type AgentRunResult,
  type BuildDiagnosticOptions,
  type Diagnostic,
  type DiagnosticLifecycle,
  type DiagnosticProviderIdentifier,
  type DiagnosticStatus,
  type DiagnosticToolOutcome,
  type ProviderAttempt,
  type TerminalReason,
  type ToolName,
  type WriteDiagnosticOptions,
} from "./contracts.ts";
import { normalizeProviderAttempt } from "./provider.ts";
import { writeWorkspaceFile } from "./tool-execution.ts";

export const DIAGNOSTICS_DIR = "oaf/diagnostics";

const IDENTIFIER_RE = /^[A-Za-z0-9._:/-]+$/;
const RUN_ID_MAX = 128;
const MODEL_MAX = 128;
const RECEIPT_FILENAME_RE = /^[A-Za-z0-9._-]+\.json$/;
const VERSION: "0.1.0" = "0.1.0";
const VALID_STATUSES = new Set<string>(DIAGNOSTIC_STATUSES);
const VALID_TERMINAL_REASONS = new Set<string>(RUN_TERMINALS.map(({ terminalReason }) => terminalReason));
const VALID_PROVIDERS = new Set<string>(DIAGNOSTIC_PROVIDER_IDENTIFIERS);
const TOOL_OUTCOMES = new Set<string>(DIAGNOSTIC_TOOL_OUTCOMES);
const VALID_TOOL_NAMES = new Set<string>(TOOL_NAMES);
const DIAGNOSTIC_KEYS = new Set(["schemaVersion", "createdAt", "runId", "provider", "requestedModel", "status", "terminalReason", "turns", "receiptPath", "providerAttempts", "tools"]);
const ATTEMPT_KEYS = new Set(["turn", "durationMs", "outcome", "httpStatus"]);
const TOOL_RECORD_KEYS = new Set(["toolName", "outcome"]);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type DiagnosticToolRecord = Diagnostic["tools"][number];
type ToolCorrelation = { toolName: ToolName | null; outcome: DiagnosticToolOutcome | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDiagnosticStatus(value: unknown): value is DiagnosticStatus {
  return typeof value === "string" && VALID_STATUSES.has(value);
}

function isTerminalReason(value: unknown): value is TerminalReason {
  return typeof value === "string" && VALID_TERMINAL_REASONS.has(value);
}

function isDiagnosticProvider(value: unknown): value is DiagnosticProviderIdentifier {
  return typeof value === "string" && VALID_PROVIDERS.has(value);
}

function isDiagnosticToolOutcome(value: unknown): value is DiagnosticToolOutcome {
  return typeof value === "string" && TOOL_OUTCOMES.has(value);
}

function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && VALID_TOOL_NAMES.has(value);
}

function normalizeLifecycle(status: unknown, terminalReason: unknown): DiagnosticLifecycle {
  if (terminalReason === "assistant_terminal") {
    return { status: status === "partial" ? "partial" : "success", terminalReason };
  }
  if (terminalReason === "max_turns") {
    return { status: status === "exhausted" ? "exhausted" : "failed", terminalReason };
  }
  return { status: "failed", terminalReason: "provider_error" };
}

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_RE.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function safeIdentifier(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > max || !IDENTIFIER_RE.test(value)) return null;
  return value;
}

function safeCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeReceiptPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("oaf/receipts/") || trimmed.includes("..") || trimmed.includes("\\")) return null;
  const filename = trimmed.slice("oaf/receipts/".length);
  if (filename.length === 0 || filename.length > 255 || filename.includes("/") || !RECEIPT_FILENAME_RE.test(filename)) return null;
  return trimmed;
}

export function normalizeDiagnosticSchema(diagnostic: unknown): Diagnostic {
  if (!isRecord(diagnostic)) throw new Error("diagnostic must be a non-null object");
  const actualKeys = new Set(Object.keys(diagnostic));
  for (const key of actualKeys) if (!DIAGNOSTIC_KEYS.has(key)) throw new Error(`diagnostic has unsupported field: ${key}`);
  for (const key of DIAGNOSTIC_KEYS) if (!actualKeys.has(key)) throw new Error(`diagnostic is missing required field: ${key}`);
  if (diagnostic.schemaVersion !== VERSION) throw new Error("schemaVersion must be exactly 0.1.0");

  return {
    schemaVersion: VERSION,
    createdAt: isValidIsoDate(diagnostic.createdAt) ? diagnostic.createdAt : new Date().toISOString(),
    runId: safeIdentifier(diagnostic.runId, RUN_ID_MAX) ?? "unknown",
    provider: diagnostic.provider === null ? null : isDiagnosticProvider(diagnostic.provider) ? diagnostic.provider : null,
    requestedModel: diagnostic.requestedModel === null ? null : safeIdentifier(diagnostic.requestedModel, MODEL_MAX),
    ...normalizeLifecycle(isDiagnosticStatus(diagnostic.status) ? diagnostic.status : "failed", isTerminalReason(diagnostic.terminalReason) ? diagnostic.terminalReason : "provider_error"),
    turns: safeCount(diagnostic.turns) ?? 0,
    receiptPath: safeReceiptPath(diagnostic.receiptPath),
    providerAttempts: Array.isArray(diagnostic.providerAttempts) ? normalizeAttempts(diagnostic.providerAttempts) : [],
    tools: Array.isArray(diagnostic.tools) ? normalizeTools(diagnostic.tools) : [],
  };
}

function normalizeAttempts(attempts: unknown[]): ProviderAttempt[] {
  return attempts.map((attempt, index) => {
    if (!isRecord(attempt) || Object.keys(attempt).some((key) => !ATTEMPT_KEYS.has(key))) {
      return { turn: index + 1, durationMs: 0, outcome: "unknown_provider_error", httpStatus: null };
    }
    return normalizeProviderAttempt(attempt, index + 1);
  });
}

function normalizeTools(tools: unknown[]): DiagnosticToolRecord[] {
  return tools.map((tool) => {
    if (!isRecord(tool) || Object.keys(tool).some((key) => !TOOL_RECORD_KEYS.has(key))) {
      return { toolName: null, outcome: "unknown" };
    }
    return {
      toolName: tool.toolName === null ? null : isToolName(tool.toolName) ? tool.toolName : null,
      outcome: isDiagnosticToolOutcome(tool.outcome) ? tool.outcome : "unknown",
    };
  });
}

function toolEvents(events: AgentRunResult["events"]): DiagnosticToolRecord[] {
  const calls = new Map<string, ToolCorrelation>();
  for (const event of events) {
    if (event.type === "tool_call") {
      calls.set(event.toolCallId, { toolName: event.toolName, outcome: null });
    } else if (event.type === "tool_execution_end") {
      const call = calls.get(event.toolCallId);
      if (call) call.outcome = event.success ? "success" : "execution_error";
    } else if (event.type === "tool_result" && event.errorCode === "rejected") {
      const call = calls.get(event.toolCallId);
      if (call) call.outcome = "rejected";
    }
  }
  return [...calls.values()].map(({ toolName, outcome }) => ({
    toolName,
    outcome: isDiagnosticToolOutcome(outcome) ? outcome : "unknown",
  }));
}

export function buildDiagnostic({ run, usage, receiptPath, receiptStatus }: BuildDiagnosticOptions): Diagnostic {
  return normalizeDiagnosticSchema({
    schemaVersion: VERSION,
    createdAt: new Date().toISOString(),
    runId: run.runId,
    provider: usage?.provider ?? null,
    requestedModel: usage?.model ?? null,
    ...normalizeLifecycle(receiptStatus ?? run.status, run.terminalReason),
    turns: safeCount(run.turns) ?? 0,
    receiptPath: safeReceiptPath(receiptPath),
    providerAttempts: run.providerAttempts.map((attempt, index) => normalizeProviderAttempt(attempt, index + 1)),
    tools: toolEvents(run.events),
  });
}

export async function writeDiagnostic({ workspaceRoot, diagnostic }: WriteDiagnosticOptions): Promise<string> {
  const normalized = normalizeDiagnosticSchema(diagnostic);
  mkdirSync(join(workspaceRoot, DIAGNOSTICS_DIR), { recursive: true });
  const path = `${DIAGNOSTICS_DIR}/${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}-${randomUUID().slice(0, 8)}.json`;
  await writeWorkspaceFile({ workspaceRoot, path, content: JSON.stringify(normalized, null, 2) });
  return path;
}
