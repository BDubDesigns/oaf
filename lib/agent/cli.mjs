// @ts-nocheck
import { resolve } from "node:path";
import { loadAgentContext } from "./context.mjs";
import { createOpenAICompatibleProvider } from "./openai-compatible-provider.ts";
import { DEFAULT_MAX_TURNS } from "./loop.mjs";
import { runAgentLoopWithReceipt } from "./receipt.mjs";
import { buildDiagnostic, writeDiagnostic } from "./diagnostics.mjs";

const DISPLAY_MAX_BYTES = 8_192;
const TRUNCATION_MARKER = "\n[response truncated]";
const MAX_TURNS_RE = /^(?:[1-9]|1[0-6])$/;

function publicError(message) { return { code: 2, message }; }
export function sanitizeTerminal(text) {
  let clean = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "");
  clean = clean.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "");
  clean = clean.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  clean = clean.replace(/\x1b(?:[ -/][0-~]?|.)?/g, "");
  clean = clean.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
  let bytes = 0;
  const output = [];
  for (const codePoint of clean) {
    const size = Buffer.byteLength(codePoint, "utf8");
    if (bytes + size > DISPLAY_MAX_BYTES) {
      const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, "utf8");
      while (output.length > 0 && bytes + markerBytes > DISPLAY_MAX_BYTES) bytes -= Buffer.byteLength(output.pop(), "utf8");
      return `${output.join("")}${TRUNCATION_MARKER}`;
    }
    output.push(codePoint);
    bytes += size;
  }
  return output.join("");
}

export function parseAgentConfig(env = process.env) {
  if (env.OAF_PROVIDER !== "openai-compatible" || !env.OAF_PROVIDER_BASE_URL?.trim() || !env.OAF_MODEL?.trim() || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(env.OAF_API_KEY_ENV ?? "") || !env[env.OAF_API_KEY_ENV]?.trim()) {
    throw publicError("Error: agent configuration is incomplete or invalid.");
  }
  const maxTurns = env.OAF_MAX_TURNS === undefined ? DEFAULT_MAX_TURNS : (MAX_TURNS_RE.test(env.OAF_MAX_TURNS) ? Number(env.OAF_MAX_TURNS) : null);
  if (maxTurns === null) throw publicError("Error: agent configuration is incomplete or invalid.");
  return { baseUrl: env.OAF_PROVIDER_BASE_URL, model: env.OAF_MODEL, apiKeyEnv: env.OAF_API_KEY_ENV, maxTurns };
}

export function usageFrom(run, config) {
  const calls = run.providerCalls ?? [];
  const sum = (field) => {
    if (calls.length !== run.turns) return null;
    let total = 0;
    for (const call of calls) {
      const value = call.usage?.[field];
      if (!Number.isSafeInteger(value) || value < 0 || total > Number.MAX_SAFE_INTEGER - value) return null;
      total += value;
    }
    return total;
  };
  return { provider: "openai-compatible", model: config.model.trim(), runMode: "agent", calls: run.turns, tokensIn: sum("inputTokens"), tokensOut: sum("outputTokens") };
}

export async function runAgentCli({ taskParts, cwd = process.cwd(), oafRoot = resolve(import.meta.dirname, "..", ".."), env = process.env, output = console } = {}) {
  const task = (taskParts ?? []).join(" ").trim();
  if (!task) return publicError("Error: agent task is required.");
  let config;
  try { config = parseAgentConfig(env); } catch (error) { return error; }
  try { await loadAgentContext({ workspaceRoot: cwd, oafRoot }); }
  catch { return publicError("Error: current directory is not a valid OAF app."); }
  let provider;
  try { provider = createOpenAICompatibleProvider({ ...config, env }); }
  catch { return publicError("Error: agent configuration is incomplete or invalid."); }
  let run;
  try {
    run = await runAgentLoopWithReceipt({ task, workspaceRoot: cwd, oafRoot, provider, maxTurns: config.maxTurns, receiptUsage: (completed) => usageFrom(completed, config) });
  } catch (error) {
    if (error?.code === "RECEIPT_WRITE_FAILED" && env.OAF_DIAGNOSTICS === "1" && error.diagnostic) {
      try {
        const path = await writeDiagnostic({ workspaceRoot: cwd, diagnostic: error.diagnostic });
        output.log(`Diagnostics: ${path}`);
      } catch { output.error?.("Warning: diagnostics could not be written."); }
    }
    return { code: 1, message: error?.code === "RECEIPT_WRITE_FAILED" ? "Error: receipt could not be written." : "Error: agent provider request failed." };
  }
  const status = run.receipt.status;
  output.log(`OAF agent: ${status === "success" ? "success" : run.terminalReason === "max_turns" ? "exhausted" : status}`);
  output.log(`Reason: ${run.terminalReason}`);
  output.log(`Turns: ${run.turns}`);
  output.log(`Receipt: ${run.receiptPath}`);
  if (run.terminalReason === "provider_error") {
    const attempt = run.providerAttempts?.at(-1);
    /** @type {Record<string, string>} */
    const messages = { authentication_failed: "authentication failed.", not_found: "HTTP 404 (not found).", rate_limited: "HTTP 429 (rate limited).", http_error: `HTTP ${attempt?.httpStatus ?? "error"}.`, timeout: "request timed out.", network_error: "network request failed.", invalid_json: "provider returned invalid JSON.", response_too_large: "provider response was too large.", invalid_response: "provider returned an invalid response.", unknown_provider_error: "provider request failed." };
    const message = messages[attempt?.outcome ?? "unknown_provider_error"] ?? "provider request failed.";
    output.log(`Provider error: ${message}`);
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
