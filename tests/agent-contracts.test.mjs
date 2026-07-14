import { deepEqual, strictEqual } from "node:assert";
import { spawnSync } from "node:child_process";
import { AGENT_EVENT_TYPES, COMMAND_ORIGINS, PROVIDER_ATTEMPT_OUTCOMES, PROVIDER_FAILURE_OUTCOMES, RUN_TERMINALS, SANDBOX_MODES, TOOL_ERROR_MESSAGES, TOOL_NAMES } from "../lib/agent/contracts.ts";
import { createEvent } from "../lib/agent/events.ts";
import { buildToolProtocol, normalizeProviderAttempt, ProviderFailure } from "../lib/agent/provider.ts";
import { publicToolError, PUBLIC_TOOL_ERRORS } from "../lib/agent/tool-errors.ts";
import { getToolDefinition, TOOLS } from "../lib/agent/tools.ts";
import { buildReceipt, RECEIPT_SCHEMA_VERSION } from "../lib/agent/receipt.ts";
import { DIAGNOSTICS_DIR, normalizeDiagnosticSchema } from "../lib/agent/diagnostics.ts";
import { SANDBOX_MODES as SANDBOX_RUNTIME_MODES } from "../lib/sandbox.ts";

deepEqual(TOOL_NAMES, ["read", "list", "grep", "write", "command"], "tool vocabulary remains ordered and canonical");
deepEqual(SANDBOX_MODES, ["plan", "edit", "test", "browser", "install", "research"], "sandbox vocabulary remains canonical");
deepEqual(COMMAND_ORIGINS, ["agent", "human_cli"], "command origins remain canonical");
deepEqual(PROVIDER_ATTEMPT_OUTCOMES, ["success", ...PROVIDER_FAILURE_OUTCOMES], "attempt outcomes derive from failures");
deepEqual(RUN_TERMINALS, [
  { status: "success", terminalReason: "assistant_terminal" },
  { status: "exhausted", terminalReason: "max_turns" },
  { status: "failed", terminalReason: "provider_error" },
], "run lifecycle pairs remain canonical");
deepEqual(buildToolProtocol().map((tool) => tool.name), TOOL_NAMES, "provider protocol uses canonical tool names");
deepEqual(PUBLIC_TOOL_ERRORS, TOOL_ERROR_MESSAGES, "public tool messages retain canonical JSON values");
deepEqual(Object.keys(TOOLS), TOOL_NAMES, "runtime registry owns the canonical tool vocabulary");
strictEqual(getToolDefinition("unknown-tool"), undefined, "unknown tool lookup stays rejected without widening registry");
deepEqual(SANDBOX_RUNTIME_MODES, SANDBOX_MODES, "sandbox consumes the canonical mode vocabulary");
strictEqual(RECEIPT_SCHEMA_VERSION, "0.1.0", "receipt runtime owns its versioned boundary");
strictEqual(DIAGNOSTICS_DIR, "oaf/diagnostics", "diagnostics runtime owns its durable directory");
deepEqual(createEvent("tool_call", { toolCallId: "call_1", toolName: "read", summary: { path: "README.md" } }), { type: "tool_call", toolCallId: "call_1", toolName: "read", summary: { path: "README.md" } }, "event boundary accepts the correlated read summary");

const failure = new ProviderFailure("http_error", { httpStatus: 500, cause: "PRIVATE_CAUSE" });
deepEqual(Object.keys(failure).sort(), ["httpStatus", "outcome"], "ProviderFailure enumerable payload remains safe");
strictEqual(JSON.stringify(failure), '{"outcome":"http_error","httpStatus":500}', "ProviderFailure JSON remains unchanged");
deepEqual(publicToolError({ code: "ENOENT", raw: "RAW_EXCEPTION_SENTINEL" }), { code: "PATH_NOT_FOUND", message: "requested path does not exist" }, "public tool error retains exact bounded JSON");
deepEqual(normalizeProviderAttempt({ turn: 1, durationMs: 1, outcome: "http_error", httpStatus: null }), { turn: 1, durationMs: 1, outcome: "unknown_provider_error", httpStatus: null }, "durable attempts normalize missing HTTP status");
deepEqual(normalizeProviderAttempt({ turn: 1, durationMs: 1, outcome: "timeout", httpStatus: 504 }), { turn: 1, durationMs: 1, outcome: "timeout", httpStatus: null }, "durable attempts drop status from non-HTTP outcomes");

const privateSentinels = ["API_KEY_SECRET_VALUE", "PROVIDER_BODY_SENTINEL", "/tmp/absolute-workspace", "STDOUT_SENTINEL", "STDERR_SENTINEL", "RAW_EXCEPTION_SENTINEL"];
/** @type {import("../lib/agent/contracts.ts").AgentRunResult} */
const run = {
  runId: "run_contract",
  status: "success",
  terminalReason: "assistant_terminal",
  turns: 1,
  content: privateSentinels[2],
  providerCalls: [],
  providerAttempts: [{ turn: 1, durationMs: 1, outcome: "success", httpStatus: null }],
  context: { documents: [], docsPack: {} },
  events: [{ type: "agent_end", runId: "run_contract", status: "success", turns: 1, terminalReason: "assistant_terminal", seq: 1, ts: "2026-01-01T00:00:00.000Z" }],
};
const receipt = buildReceipt({ run, task: "task API_KEY=API_KEY_SECRET_VALUE" });
strictEqual(receipt.schemaVersion, "0.1.0", "receipt JSON schema remains unchanged");
const receiptJson = JSON.stringify(receipt);
for (const sentinel of privateSentinels) strictEqual(receiptJson.includes(sentinel), false, `receipt excludes ${sentinel}`);
const diagnostic = normalizeDiagnosticSchema({ schemaVersion: "0.1.0", createdAt: "2026-01-01T00:00:00.000Z", runId: "run_contract", provider: null, requestedModel: null, status: "success", terminalReason: "assistant_terminal", turns: 1, receiptPath: null, providerAttempts: [{ turn: 1, durationMs: 1, outcome: "http_error", httpStatus: null }], tools: [] });
deepEqual(diagnostic.providerAttempts, [{ turn: 1, durationMs: 1, outcome: "unknown_provider_error", httpStatus: null }], "diagnostic JSON normalizes invalid durable attempts");
deepEqual(normalizeDiagnosticSchema({ ...diagnostic, status: "success", terminalReason: "provider_error" }).status, "failed", "diagnostic status follows provider failure terminal reason");
deepEqual(normalizeDiagnosticSchema({ ...diagnostic, status: "partial", terminalReason: "max_turns" }), { ...diagnostic, status: "failed", terminalReason: "max_turns" }, "diagnostic lifecycle normalizes max-turn pairs deterministically");
deepEqual(normalizeDiagnosticSchema({ ...diagnostic, status: "exhausted", terminalReason: "max_turns" }), { ...diagnostic, status: "exhausted", terminalReason: "max_turns" }, "diagnostic lifecycle preserves exhausted max-turn runs");
deepEqual(normalizeDiagnosticSchema({ ...diagnostic, status: "failed", terminalReason: "max_turns" }), { ...diagnostic, status: "failed", terminalReason: "max_turns" }, "diagnostic lifecycle preserves receipt-level failed max-turn runs");
deepEqual(normalizeDiagnosticSchema({ ...diagnostic, status: "exhausted", terminalReason: "provider_error" }), { ...diagnostic, status: "failed", terminalReason: "provider_error" }, "diagnostic lifecycle normalizes exhausted provider failures");

const direct = spawnSync(process.execPath, ["--input-type=module", "--eval", 'import { TOOL_NAMES } from "./lib/agent/contracts.ts"; process.stdout.write(TOOL_NAMES.join(","));'], { cwd: process.cwd(), encoding: "utf8" });
strictEqual(direct.status, 0, "native TypeScript contracts load without a loader");
strictEqual(direct.stdout, "read,list,grep,write,command", "native TypeScript contract values execute directly");

console.log("All agent contract checks passed.");
