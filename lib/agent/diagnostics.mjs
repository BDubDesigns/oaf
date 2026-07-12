import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { writeWorkspaceFile } from "./tool-execution.mjs";

export const DIAGNOSTICS_DIR = "oaf/diagnostics";

function toolEvents(events) {
  const calls = new Map();
  for (const event of events) {
    if (event.type === "tool_call") calls.set(event.toolCallId, { toolName: event.toolName, outcome: null });
    if (event.type === "tool_execution_end" && calls.has(event.toolCallId)) calls.get(event.toolCallId).outcome = event.success ? "success" : "execution_error";
    if (event.type === "tool_result" && calls.has(event.toolCallId) && event.errorCode === "rejected") calls.get(event.toolCallId).outcome = "rejected";
  }
  return [...calls.values()].map(({ toolName, outcome }) => ({ toolName, outcome: outcome ?? "unknown" }));
}

export function buildDiagnostic({ run, usage, receiptPath, receiptStatus }) {
  return {
    schemaVersion: "0.1.0",
    createdAt: new Date().toISOString(),
    runId: run.runId,
    provider: usage?.provider ?? null,
    requestedModel: usage?.model ?? null,
    status: receiptStatus ?? run.status,
    terminalReason: run.terminalReason,
    turns: run.turns,
    receiptPath: receiptPath ?? null,
    providerAttempts: run.providerAttempts ?? [],
    tools: toolEvents(run.events),
  };
}

export async function writeDiagnostic({ workspaceRoot, diagnostic }) {
  mkdirSync(join(workspaceRoot, DIAGNOSTICS_DIR), { recursive: true });
  const path = `${DIAGNOSTICS_DIR}/${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}-${randomUUID().slice(0, 8)}.json`;
  await writeWorkspaceFile({ workspaceRoot, path, content: JSON.stringify(diagnostic, null, 2) });
  return path;
}
