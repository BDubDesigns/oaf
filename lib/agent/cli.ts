import { resolve } from "node:path";
import { loadAgentContext } from "./context.ts";
import { createOpenAICompatibleProvider } from "./openai-compatible-provider.ts";
import { DEFAULT_MAX_TURNS } from "./loop.ts";
import { runAgentLoopWithReceipt } from "./receipt.ts";
import { buildDiagnostic, normalizeDiagnosticSchema, writeDiagnostic } from "./diagnostics.ts";
import type {
  AgentCliConfig,
  AgentCliEnvironment,
  AgentCliOptions,
  AgentCliPublicError,
  AgentCliResult,
  AgentCliUsageRun,
  ProviderAttemptOutcome,
  ValidatedReceiptUsage,
} from "./contracts.ts";

const DISPLAY_MAX_BYTES = 8_192;
const TRUNCATION_MARKER = "\n[response truncated]";
const MAX_TURNS_RE = /^(?:[1-9]|1[0-6])$/;

function publicError(message: string): AgentCliPublicError { return { code: 2, message }; }

export function sanitizeTerminal(text: unknown): string {
  let clean = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "");
  clean = clean.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "");
  clean = clean.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  clean = clean.replace(/\x1b(?:[ -/][0-~]?|.)?/g, "");
  clean = clean.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
  let bytes = 0;
  const output: string[] = [];
  for (const codePoint of clean) {
    const size = Buffer.byteLength(codePoint, "utf8");
    if (bytes + size > DISPLAY_MAX_BYTES) {
      const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, "utf8");
      while (output.length > 0 && bytes + markerBytes > DISPLAY_MAX_BYTES) {
        const removed = output.pop();
        if (removed !== undefined) bytes -= Buffer.byteLength(removed, "utf8");
      }
      return `${output.join("")}${TRUNCATION_MARKER}`;
    }
    output.push(codePoint);
    bytes += size;
  }
  return output.join("");
}

export function parseAgentConfig(env: AgentCliEnvironment = process.env): AgentCliConfig {
  const baseUrl = env.OAF_PROVIDER_BASE_URL;
  const model = env.OAF_MODEL;
  const apiKeyEnv = env.OAF_API_KEY_ENV;
  if (
    env.OAF_PROVIDER !== "openai-compatible"
    || typeof baseUrl !== "string" || !baseUrl.trim()
    || typeof model !== "string" || !model.trim()
    || typeof apiKeyEnv !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)
    || typeof env[apiKeyEnv] !== "string" || !env[apiKeyEnv].trim()
  ) throw publicError("Error: agent configuration is incomplete or invalid.");
  const maxTurns = env.OAF_MAX_TURNS === undefined ? DEFAULT_MAX_TURNS : (MAX_TURNS_RE.test(env.OAF_MAX_TURNS) ? Number(env.OAF_MAX_TURNS) : null);
  if (maxTurns === null) throw publicError("Error: agent configuration is incomplete or invalid.");
  return { baseUrl, model, apiKeyEnv, maxTurns };
}

export function usageFrom(run: AgentCliUsageRun, config: Pick<AgentCliConfig, "model">): ValidatedReceiptUsage {
  const calls = run.providerCalls ?? [];
  const sum = (field: "inputTokens" | "outputTokens"): number | null => {
    if (calls.length !== run.turns) return null;
    let total = 0;
    for (const call of calls) {
      const value = call.usage?.[field];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || total > Number.MAX_SAFE_INTEGER - value) return null;
      total += value;
    }
    return total;
  };
  return { provider: "openai-compatible", model: config.model.trim(), runMode: "agent", calls: run.turns, tokensIn: sum("inputTokens"), tokensOut: sum("outputTokens") };
}

function isPropertyBearing(error: unknown): error is { code?: unknown; diagnostic?: unknown } {
  return error !== null && (typeof error === "object" || typeof error === "function");
}

function isReceiptWriteFailure(error: unknown): error is { code: "RECEIPT_WRITE_FAILED"; diagnostic?: unknown } {
  return isPropertyBearing(error) && error.code === "RECEIPT_WRITE_FAILED";
}

function hasDiagnostic(error: { diagnostic?: unknown }): error is { diagnostic: unknown } {
  return Boolean(error.diagnostic);
}

function providerErrorMessage(outcome: ProviderAttemptOutcome | undefined, httpStatus: number | undefined): string {
  switch (outcome) {
    case "authentication_failed": return "authentication failed.";
    case "not_found": return "HTTP 404 (not found).";
    case "rate_limited": return "HTTP 429 (rate limited).";
    case "http_error": return httpStatus === undefined ? "HTTP error." : `HTTP ${httpStatus}.`;
    case "timeout": return "request timed out.";
    case "network_error": return "network request failed.";
    case "invalid_json": return "provider returned invalid JSON.";
    case "response_too_large": return "provider response was too large.";
    case "invalid_response": return "provider returned an invalid response.";
    case "unknown_provider_error":
    case undefined: return "provider request failed.";
    case "success": return "provider request failed.";
  }
}

export async function runAgentCli(options: AgentCliOptions = {}): Promise<AgentCliResult> {
  const {
    taskParts,
    cwd = process.cwd(),
    oafRoot = resolve(import.meta.dirname, "..", ".."),
    env = process.env,
    output = console,
  } = options;
  const task = (taskParts ?? []).join(" ").trim();
  if (!task) return publicError("Error: agent task is required.");
  let config: AgentCliConfig;
  try { config = parseAgentConfig(env); } catch { return publicError("Error: agent configuration is incomplete or invalid."); }
  try { await loadAgentContext({ workspaceRoot: cwd, oafRoot }); }
  catch { return publicError("Error: current directory is not a valid OAF app."); }
  let provider;
  try { provider = createOpenAICompatibleProvider({ baseUrl: config.baseUrl, model: config.model, apiKeyEnv: config.apiKeyEnv, env }); }
  catch { return publicError("Error: agent configuration is incomplete or invalid."); }
  let run;
  try {
    run = await runAgentLoopWithReceipt({ task, workspaceRoot: cwd, oafRoot, provider, maxTurns: config.maxTurns, receiptUsage: (completed) => usageFrom(completed, config) });
  } catch (error) {
    if (isReceiptWriteFailure(error)) {
      if (env.OAF_DIAGNOSTICS === "1" && hasDiagnostic(error)) {
        try {
          const path = await writeDiagnostic({ workspaceRoot: cwd, diagnostic: normalizeDiagnosticSchema(error.diagnostic) });
          output.log(`Diagnostics: ${path}`);
        } catch { output.error?.("Warning: diagnostics could not be written."); }
      }
      return { code: 1, message: "Error: receipt could not be written." };
    }
    return { code: 1, message: "Error: agent provider request failed." };
  }
  const status = run.receipt.status;
  output.log(`OAF agent: ${status === "success" ? "success" : run.terminalReason === "max_turns" ? "exhausted" : status}`);
  output.log(`Reason: ${run.terminalReason}`);
  output.log(`Turns: ${run.turns}`);
  output.log(`Receipt: ${run.receiptPath}`);
  if (run.terminalReason === "provider_error") {
    const attempt = run.providerAttempts.at(-1);
    output.log(`Provider error: ${providerErrorMessage(attempt?.outcome, attempt?.httpStatus ?? undefined)}`);
  }
  if (env.OAF_DIAGNOSTICS === "1") {
    try {
      const path = await writeDiagnostic({ workspaceRoot: cwd, diagnostic: buildDiagnostic({ run, usage: run.receipt.usage, receiptPath: run.receiptPath, receiptStatus: run.receipt.status }) });
      output.log(`Diagnostics: ${path}`);
    } catch {
      output.error?.("Warning: diagnostics could not be written.");
    }
  }
  if (status === "success" && run.content) output.log(`Response:\n${sanitizeTerminal(run.content)}`);
  return { code: run.terminalReason === "max_turns" ? 3 : status === "success" ? 0 : 1, run };
}
