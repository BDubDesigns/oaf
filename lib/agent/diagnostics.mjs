import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { writeWorkspaceFile } from "./tool-execution.mjs";

export const DIAGNOSTICS_DIR = "oaf/diagnostics";
const PROVIDER_OUTCOMES = new Set(["success", "authentication_failed", "not_found", "rate_limited", "http_error", "timeout", "network_error", "invalid_json", "response_too_large", "invalid_response", "unknown_provider_error"]);
const TOOL_OUTCOMES = new Set(["success", "rejected", "execution_error", "unknown"]);
const status = (value) => ["success", "partial", "failed", "exhausted"].includes(value) ? value : "failed";
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
    schemaVersion: "0.1.0",
    createdAt: new Date().toISOString(),
    runId: typeof run.runId === "string" ? run.runId : "unknown",
    provider: typeof usage?.provider === "string" ? usage.provider : null,
    requestedModel: typeof usage?.model === "string" ? usage.model : null,
    status: status(receiptStatus ?? run.status),
    terminalReason: ["assistant_terminal", "provider_error", "max_turns"].includes(run.terminalReason) ? run.terminalReason : "provider_error",
    turns: count(run.turns) ?? 0,
    receiptPath: typeof receiptPath === "string" && receiptPath.startsWith("oaf/receipts/") ? receiptPath : null,
    providerAttempts: Array.isArray(run.providerAttempts) ? run.providerAttempts.map((attempt, index) => ({ turn: count(attempt?.turn) ?? index + 1, durationMs: count(attempt?.durationMs) ?? 0, outcome: PROVIDER_OUTCOMES.has(attempt?.outcome) ? attempt.outcome : "unknown_provider_error", httpStatus: Number.isInteger(attempt?.httpStatus) && attempt.httpStatus >= 100 && attempt.httpStatus <= 599 ? attempt.httpStatus : null })) : [],
    tools: toolEvents(run.events),
  };
}

export async function writeDiagnostic({ workspaceRoot, diagnostic }) {
  mkdirSync(join(workspaceRoot, DIAGNOSTICS_DIR), { recursive: true });
  const path = `${DIAGNOSTICS_DIR}/${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}-${randomUUID().slice(0, 8)}.json`;
  await writeWorkspaceFile({ workspaceRoot, path, content: JSON.stringify(diagnostic, null, 2) });
  return path;
}
