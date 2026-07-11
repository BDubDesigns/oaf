import { resolve } from "node:path";
import { loadAgentContext } from "./context.mjs";
import { createOpenAICompatibleProvider } from "./openai-compatible-provider.mjs";
import { DEFAULT_MAX_TURNS } from "./loop.mjs";
import { runAgentLoopWithReceipt } from "./receipt.mjs";

const DISPLAY_MAX_BYTES = 8_192;
const MAX_TURNS_RE = /^(?:[1-9]|1[0-6])$/;

function publicError(message) { return { code: 2, message }; }
export function sanitizeTerminal(text) {
  let clean = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "");
  clean = clean.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "");
  clean = clean.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  clean = clean.replace(/\x1b(?:[ -/][0-~]?|.)?/g, "");
  clean = clean.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
  let bytes = 0;
  let output = "";
  for (const codePoint of clean) {
    const size = Buffer.byteLength(codePoint, "utf8");
    if (bytes + size > DISPLAY_MAX_BYTES) return `${output}\n[response truncated]`;
    output += codePoint;
    bytes += size;
  }
  return output;
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
  const complete = calls.length === run.turns && calls.every((call) => Number.isSafeInteger(call.usage?.inputTokens) && call.usage.inputTokens >= 0 && Number.isSafeInteger(call.usage?.outputTokens) && call.usage.outputTokens >= 0);
  const sum = (field) => complete ? calls.reduce((total, call) => total + call.usage[field], 0) : null;
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
    return { code: 1, message: error?.code === "RECEIPT_WRITE_FAILED" ? "Error: receipt could not be written." : "Error: agent provider request failed." };
  }
  const status = run.receipt.status;
  output.log(`OAF agent: ${status === "success" ? "success" : run.terminalReason === "max_turns" ? "exhausted" : status}`);
  output.log(`Reason: ${run.terminalReason}`);
  output.log(`Turns: ${run.turns}`);
  output.log(`Receipt: ${run.receiptPath}`);
  if (status === "success" && run.content) output.log(`Response:\n${sanitizeTerminal(run.content)}`);
  return { code: run.terminalReason === "max_turns" ? 3 : status === "success" ? 0 : 1, run };
}
