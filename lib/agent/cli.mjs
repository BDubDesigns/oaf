import { resolve } from "node:path";
import { loadAgentContext } from "./context.mjs";
import { createOpenAICompatibleProvider } from "./openai-compatible-provider.mjs";
import { DEFAULT_MAX_TURNS } from "./loop.mjs";
import { runAgentLoopWithReceipt } from "./receipt.mjs";

const DISPLAY_MAX_BYTES = 8_192;
const MAX_TURNS_RE = /^(?:[1-9]|1[0-6])$/;

function publicError(message) { return { code: 2, message }; }
function sanitizeTerminal(text) {
  const clean = String(text ?? "").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\x1b\[][\s\S]*?(?:\x07|\x1b\\)/g, "");
  const bytes = Buffer.byteLength(clean, "utf8");
  if (bytes <= DISPLAY_MAX_BYTES) return clean;
  return Buffer.from(clean, "utf8").subarray(0, DISPLAY_MAX_BYTES).toString("utf8") + "\n[response truncated]";
}

export function parseAgentConfig(env = process.env) {
  if (env.OAF_PROVIDER !== "openai-compatible" || !env.OAF_PROVIDER_BASE_URL?.trim() || !env.OAF_MODEL?.trim() || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(env.OAF_API_KEY_ENV ?? "") || !env[env.OAF_API_KEY_ENV]?.trim()) {
    throw publicError("Error: agent configuration is incomplete or invalid.");
  }
  const maxTurns = env.OAF_MAX_TURNS === undefined ? DEFAULT_MAX_TURNS : (MAX_TURNS_RE.test(env.OAF_MAX_TURNS) ? Number(env.OAF_MAX_TURNS) : null);
  if (maxTurns === null) throw publicError("Error: agent configuration is incomplete or invalid.");
  return { baseUrl: env.OAF_PROVIDER_BASE_URL, model: env.OAF_MODEL, apiKeyEnv: env.OAF_API_KEY_ENV, maxTurns };
}

function usageFrom(run, config) {
  const calls = run.providerCalls ?? [];
  const sum = (field) => calls.every((call) => Number.isInteger(call.usage?.[field])) ? calls.reduce((total, call) => total + call.usage[field], 0) : null;
  return { provider: "openai-compatible", model: config.model, runMode: "agent", calls: calls.length, tokensIn: sum("inputTokens"), tokensOut: sum("outputTokens") };
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
    return { code: 1, message: /receipt/i.test(error?.message ?? "") ? "Error: receipt could not be written." : "Error: agent provider request failed." };
  }
  const status = run.receipt.status;
  output.log(`OAF agent: ${status === "success" ? "success" : run.terminalReason === "max_turns" ? "exhausted" : status}`);
  output.log(`Reason: ${run.terminalReason}`);
  output.log(`Turns: ${run.turns}`);
  output.log(`Receipt: ${run.receiptPath}`);
  if (status === "success" && run.finalContent) output.log(`Response:\n${sanitizeTerminal(run.finalContent)}`);
  return { code: run.terminalReason === "max_turns" ? 3 : status === "success" ? 0 : 1, run };
}
