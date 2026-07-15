import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { copyGeneratedAppFixture } from "./generated-app-fixture-helper.ts";
import { parseAgentConfig, sanitizeTerminal, usageFrom } from "../lib/agent/cli.ts";
import type { SpawnOptions } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentCliEnvironment, AgentCliUsageRun, ValidatedReceiptUsage } from "../lib/agent/contracts.ts";

interface CliProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface ScenarioEnvironment extends NodeJS.ProcessEnv, AgentCliEnvironment {
  OAF_PROVIDER: string;
  OAF_PROVIDER_BASE_URL: string;
  OAF_MODEL: string;
  OAF_API_KEY_ENV: string;
  OAF_TEST_SECRET: string;
  OAF_MAX_TURNS: string;
}

interface ScenarioContext {
  workspace: string;
  env: ScenarioEnvironment;
  requests(): number;
}

type ScenarioResponder = (request: IncomingMessage, response: ServerResponse<IncomingMessage>, body: string, requests: number) => void;
type ScenarioCallback = (context: ScenarioContext) => Promise<void>;

interface WireFunction { name?: string; arguments?: string; }
interface WireToolCall { id?: string; function?: WireFunction; }
interface WireMessage { role?: string; tool_calls?: WireToolCall[]; tool_call_id?: string; content?: string; }
interface WireRequest { tools?: unknown[]; messages?: WireMessage[]; }
interface ReceiptJson { status?: unknown; terminalReason?: unknown; usage: Record<string, unknown>; }
interface DiagnosticJson { schemaVersion?: unknown; status?: unknown; terminalReason?: unknown; turns?: unknown; provider?: unknown; requestedModel?: unknown; receiptPath?: string; providerAttempts: Record<string, unknown>[]; tools: Record<string, unknown>[]; }
const EMPTY_DIAGNOSTIC: DiagnosticJson = { providerAttempts: [], tools: [] };
const EMPTY_RECEIPT: ReceiptJson = { usage: {} };

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function wireFunction(value: unknown): WireFunction | undefined { if (!isRecord(value)) return undefined; const name = Reflect.get(value, "name"); const argumentsText = Reflect.get(value, "arguments"); return { ...(typeof name === "string" ? { name } : {}), ...(typeof argumentsText === "string" ? { arguments: argumentsText } : {}) }; }
function wireToolCall(value: unknown): WireToolCall { if (!isRecord(value)) return {}; const id = Reflect.get(value, "id"); const fn = wireFunction(Reflect.get(value, "function")); return { ...(typeof id === "string" ? { id } : {}), ...(fn === undefined ? {} : { function: fn }) }; }
function wireMessage(value: unknown): WireMessage { if (!isRecord(value)) return {}; const role = Reflect.get(value, "role"); const toolCallId = Reflect.get(value, "tool_call_id"); const content = Reflect.get(value, "content"); const toolCalls = Reflect.get(value, "tool_calls"); return { ...(typeof role === "string" ? { role } : {}), ...(typeof toolCallId === "string" ? { tool_call_id: toolCallId } : {}), ...(typeof content === "string" ? { content } : {}), ...(Array.isArray(toolCalls) ? { tool_calls: toolCalls.map(wireToolCall) } : {}) }; }
function parseWireRequest(text: string): WireRequest { const parsed: unknown = JSON.parse(text); if (!isRecord(parsed)) throw new Error("provider request must be an object"); const tools = Reflect.get(parsed, "tools"); const messages = Reflect.get(parsed, "messages"); return { ...(Array.isArray(tools) ? { tools } : {}), ...(Array.isArray(messages) ? { messages: messages.map(wireMessage) } : {}) }; }
function parseJson(text: string): unknown { const parsed: unknown = JSON.parse(text); return parsed; }
function records(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.filter(isRecord) : []; }
function property(value: unknown, name: string): unknown { return isRecord(value) ? Reflect.get(value, name) : undefined; }
function parseReceipt(text: string): ReceiptJson { const parsed = parseJson(text); if (!isRecord(parsed)) throw new Error("receipt JSON must be an object"); const usage = Reflect.get(parsed, "usage"); return { status: Reflect.get(parsed, "status"), terminalReason: Reflect.get(parsed, "terminalReason"), usage: isRecord(usage) ? usage : {} }; }
function parseDiagnostic(text: string): DiagnosticJson { const parsed = parseJson(text); if (!isRecord(parsed)) throw new Error("diagnostic JSON must be an object"); const receiptPath = Reflect.get(parsed, "receiptPath"); return { schemaVersion: Reflect.get(parsed, "schemaVersion"), status: Reflect.get(parsed, "status"), terminalReason: Reflect.get(parsed, "terminalReason"), turns: Reflect.get(parsed, "turns"), provider: Reflect.get(parsed, "provider"), requestedModel: Reflect.get(parsed, "requestedModel"), ...(typeof receiptPath === "string" ? { receiptPath } : {}), providerAttempts: records(Reflect.get(parsed, "providerAttempts")), tools: records(Reflect.get(parsed, "tools")) }; }

function serverPort(server: ReturnType<typeof createServer>): number {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test server did not bind to a TCP port");
  return address.port;
}

let failures = 0;
function assert(ok: unknown, message: string): void { if (ok) console.log(`PASS  ${message}`); else { console.log(`FAIL  ${message}`); failures++; } }
function runCli(args: string[], options: SpawnOptions): Promise<CliProcessResult> { return new Promise<CliProcessResult>((resolveChild, reject) => { const child = spawn("node", args, options); if (child.stdout === null || child.stderr === null) { reject(new Error("CLI child must expose stdout and stderr")); return; } let stdout = ""; let stderr = ""; child.stdout.on("data", (data: Buffer) => { stdout += data; }); child.stderr.on("data", (data: Buffer) => { stderr += data; }); child.on("error", reject); child.on("close", (status) => resolveChild({ status, stdout, stderr })); }); }
const repo = resolve(import.meta.dirname, "..");
const bin = join(repo, "bin/oaf.ts");
function receiptFiles(workspace: string): string[] { const dir = join(workspace, "oaf/receipts"); try { return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")) : []; } catch { return []; } }
async function scenario(responder: ScenarioResponder, callback: ScenarioCallback): Promise<void> {
  let requests = 0;
  const server = createServer((req: IncomingMessage, res: ServerResponse<IncomingMessage>) => { let body = ""; req.on("data", (chunk: Buffer) => { body += chunk; }); req.on("end", () => { requests++; responder(req, res, body, requests); }); });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const fixture = copyGeneratedAppFixture();
  const env: ScenarioEnvironment = { ...process.env, OAF_PROVIDER: "openai-compatible", OAF_PROVIDER_BASE_URL: `http://127.0.0.1:${serverPort(server)}`, OAF_MODEL: "test/model", OAF_API_KEY_ENV: "OAF_TEST_SECRET", OAF_TEST_SECRET: "SCENARIO_KEY_59", OAF_MAX_TURNS: "3" };
  try { await callback({ workspace: fixture.workspace, env, requests: () => requests }); }
  finally { await new Promise<void>((done, reject) => server.close((error) => error === undefined ? done() : reject(error))); fixture.cleanup(); }
}
const sanitized = sanitizeTerminal("\x1b[31mRED\x1b[0m\x1b]title\x07\0x\by\rz\n\tok");
assert(sanitized === "REDxyz\n\tok", "terminal sanitizer strips CSI, OSC, controls, and CR");
assert(sanitizeTerminal(null) === "" && sanitizeTerminal(undefined) === "", "terminal sanitizer converts nullish values to empty text");
assert(sanitizeTerminal("a".repeat(8192)) === "a".repeat(8192), "terminal sanitizer preserves exactly 8192 UTF-8 bytes without a marker");
assert(sanitizeTerminal("a".repeat(8193)) === `${"a".repeat(8192 - Buffer.byteLength("\n[response truncated]", "utf8"))}\n[response truncated]`, "terminal sanitizer appends the exact marker when content exceeds the limit");
assert(sanitizeTerminal({ toString: () => "converted" }) === "converted", "terminal sanitizer preserves String conversion behavior");
const unicode = sanitizeTerminal("a".repeat(8190) + "€😀");
assert(Buffer.byteLength(unicode, "utf8") <= 8192 && unicode.endsWith("[response truncated]"), "terminal sanitizer truncates at Unicode boundary within final byte limit");
const configSecret = "AGENT_CLI_CONFIG_SECRET";
const configEnvironment: AgentCliEnvironment = { OAF_PROVIDER: "openai-compatible", OAF_PROVIDER_BASE_URL: " https://example.test/base ", OAF_MODEL: " model/name ", OAF_API_KEY_ENV: "AGENT_CLI_CONFIG_KEY", AGENT_CLI_CONFIG_KEY: configSecret };
const ordinaryConfig = parseAgentConfig(configEnvironment);
const nullPrototypeEnvironment: AgentCliEnvironment = {};
Reflect.setPrototypeOf(nullPrototypeEnvironment, null);
Object.assign(nullPrototypeEnvironment, configEnvironment);
const inheritedEnvironment: AgentCliEnvironment = {};
Reflect.setPrototypeOf(inheritedEnvironment, configEnvironment);
const nullPrototypeConfig = parseAgentConfig(nullPrototypeEnvironment);
const inheritedConfig = parseAgentConfig(inheritedEnvironment);
const oneTurnConfig = parseAgentConfig({ ...configEnvironment, OAF_MAX_TURNS: "1" });
const sixteenTurnConfig = parseAgentConfig({ ...configEnvironment, OAF_MAX_TURNS: "16" });
assert(ordinaryConfig.baseUrl === configEnvironment.OAF_PROVIDER_BASE_URL && ordinaryConfig.model === configEnvironment.OAF_MODEL && ordinaryConfig.apiKeyEnv === "AGENT_CLI_CONFIG_KEY" && ordinaryConfig.maxTurns === 8 && !Object.values(ordinaryConfig).includes(configSecret), "parseAgentConfig preserves validated ordinary-record values without the API key");
assert(nullPrototypeConfig.maxTurns === 8 && inheritedConfig.maxTurns === 8 && oneTurnConfig.maxTurns === 1 && sixteenTurnConfig.maxTurns === 16, "parseAgentConfig accepts null-prototype and inherited environments with exact turn limits");
const usageFailure: ValidatedReceiptUsage = usageFrom({ turns: 1, providerCalls: [] }, { model: " test/model " });
assert(usageFailure.calls === 1 && usageFailure.tokensIn === null && usageFailure.tokensOut === null && usageFailure.model === "test/model", "usage counts failed attempts without fabricated tokens");
const usageCases: [AgentCliUsageRun["providerCalls"], number | null, number | null, string][] = [
  [[{ usage: { inputTokens: 1, outputTokens: Number.MAX_SAFE_INTEGER } }, { usage: { inputTokens: 1, outputTokens: 1 } }], 2, null, "valid input with overflowing output"],
  [[{ usage: { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 } }, { usage: { inputTokens: 1, outputTokens: 1 } }], null, 2, "overflowing input with valid output"],
  [[{ usage: { inputTokens: null, outputTokens: 1 } }], null, 1, "invalid input with valid output"],
  [[{ usage: { inputTokens: 1, outputTokens: null } }], 1, null, "valid input with invalid output"],
];
for (const [calls, expectedIn, expectedOut, label] of usageCases) { const usage: ValidatedReceiptUsage = usageFrom({ turns: calls?.length ?? 0, providerCalls: calls }, { model: "test/model" }); assert(usage.calls === (calls?.length ?? 0) && usage.tokensIn === expectedIn && usage.tokensOut === expectedOut, `usageFrom ${label}`); }
const missingCallUsage = usageFrom({ turns: 2, providerCalls: [{ usage: { inputTokens: 1, outputTokens: 1 } }] }, { model: "test/model" });
assert(missingCallUsage.calls === 2 && missingCallUsage.tokensIn === null && missingCallUsage.tokensOut === null, "usageFrom missing providerCall nulls independent totals");
const negativeUsage = usageFrom({ turns: 1, providerCalls: [{ usage: { inputTokens: -1, outputTokens: 1 } }] }, { model: "test/model" });
const fractionalUsage = usageFrom({ turns: 1, providerCalls: [{ usage: { inputTokens: 1, outputTokens: 1.5 } }] }, { model: "test/model" });
const unsafeUsage = usageFrom({ turns: 1, providerCalls: [{ usage: { inputTokens: Number.MAX_SAFE_INTEGER + 1, outputTokens: 1 } }] }, { model: "test/model" });
const missingUsage = usageFrom({ turns: 1, providerCalls: [{}] }, { model: "test/model" });
assert(negativeUsage.tokensIn === null && negativeUsage.tokensOut === 1 && fractionalUsage.tokensIn === 1 && fractionalUsage.tokensOut === null && unsafeUsage.tokensIn === null && unsafeUsage.tokensOut === 1 && missingUsage.tokensIn === null && missingUsage.tokensOut === null, "usageFrom rejects invalid token values independently without fabricating totals");
const fixture = copyGeneratedAppFixture();
const secret = "OAF_CLI_SECRET_SENTINEL";
let calls = 0;
let auth: string | undefined;
const requests: WireRequest[] = [];
const server = createServer((req: IncomingMessage, res: ServerResponse<IncomingMessage>) => {
  let body = "";
  req.on("data", (chunk: Buffer) => { body += chunk; });
  req.on("end", () => {
    auth = req.headers.authorization;
    const request = parseWireRequest(body);
    requests.push(request);
    const payload = calls++ === 0
      ? { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "cli_tool_1", type: "function", function: { name: "write", arguments: JSON.stringify({ path: "app/oaf-cli-test.txt", content: "cli wrote this" }) } }] } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }
      : { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "CLI terminal response" } }], usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 } };
    assert(Array.isArray(request.tools) && request.tools.length === 5, "CLI sends fixed tool definitions");
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(payload));
  });
});
await new Promise<void>((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
try {
  const port = serverPort(server);
  const env = { ...process.env, OAF_PROVIDER: "openai-compatible", OAF_PROVIDER_BASE_URL: `http://127.0.0.1:${port}`, OAF_MODEL: "test/model", OAF_API_KEY_ENV: "OAF_TEST_SECRET", OAF_TEST_SECRET: secret, OAF_MAX_TURNS: "4", OAF_DIAGNOSTICS: "1" };
  const success = await runCli([join(repo, "bin/oaf.ts"), "agent", "write", "a", "file"], { cwd: fixture.workspace, env });
  const output = success.stdout + success.stderr;
  assert(success.status === 0, "successful CLI round trip exits 0");
  assert(existsSync(join(fixture.workspace, "app/oaf-cli-test.txt")), "provider tool call writes allowed file");
  const secondMessages: WireMessage[] = requests[1]?.messages ?? [];
  const assistantToolCall = secondMessages.find((message) => message.role === "assistant" && message.tool_calls?.[0]?.id === "cli_tool_1");
  const toolResult = secondMessages.find((message) => message.role === "tool" && message.tool_call_id === "cli_tool_1");
  const decodedArgs = assistantToolCall?.tool_calls?.[0]?.function?.arguments;
  let parsedResult: unknown = null; try { parsedResult = parseJson(toolResult?.content ?? ""); } catch {}
  assert(assistantToolCall?.tool_calls?.[0]?.id === "cli_tool_1" && assistantToolCall?.tool_calls?.[0]?.function?.name === "write" && decodedArgs === JSON.stringify({ path: "app/oaf-cli-test.txt", content: "cli wrote this" }) && JSON.stringify(parsedResult) === JSON.stringify({ path: "app/oaf-cli-test.txt", bytes: 14 }), "second request preserves exact write tool-call/result protocol");
  assert(!JSON.stringify(secondMessages).includes(secret) && !JSON.stringify(secondMessages).includes(fixture.workspace) && !JSON.stringify(secondMessages).includes(env.OAF_PROVIDER_BASE_URL) && !JSON.stringify(secondMessages).includes("Authorization"), "tool-result protocol omits credentials, endpoint, and host path");
  assert(/Receipt: oaf\/receipts\/.+\.json/.test(output), "CLI prints project-relative receipt path");
  assert(/Response:\nCLI terminal response/.test(output), "CLI prints established terminal content under response heading");
  assert(auth === `Bearer ${secret}`, "API key sentinel appears only in Authorization header");
  assert(!output.includes(secret), "API key sentinel absent from CLI output");
  const receipts = readdirSync(join(fixture.workspace, "oaf/receipts")).filter((name) => name.endsWith(".json"));
  assert(receipts.length === 1, "successful CLI writes exactly one receipt");
  const diagnostics = readdirSync(join(fixture.workspace, "oaf/diagnostics")).filter((name) => name.endsWith(".json"));
  assert(diagnostics.length === 1 && /Diagnostics: oaf\/diagnostics\//.test(output), "successful diagnostics-enabled CLI writes exactly one diagnostic");
  const receipt = parseReceipt(readFileSync(join(fixture.workspace, "oaf/receipts", receipts[0]), "utf8"));
  assert(receipt.status === "success" && receipt.terminalReason === "assistant_terminal", "receipt records successful terminal run");
  assert(receipt.usage.provider === "openai-compatible" && receipt.usage.model === "test/model" && receipt.usage.calls === 2 && receipt.usage.tokensIn === 8 && receipt.usage.tokensOut === 6, "receipt records trusted provider usage");
  assert(!JSON.stringify(receipt).includes(secret) && !JSON.stringify(receipt).includes("CLI terminal response"), "receipt omits key and raw model response");
  const missing = await runCli([join(repo, "bin/oaf.ts"), "agent"], { cwd: fixture.workspace, env });
  assert(missing.status === 2 && /task is required/.test(missing.stderr), "missing task exits 2 before provider");
  const invalidConfig = await runCli([join(repo, "bin/oaf.ts"), "agent", "x"], { cwd: fixture.workspace, env: { ...env, OAF_PROVIDER: "other" } });
  assert(invalidConfig.status === 2 && !invalidConfig.stdout.includes(secret), "invalid provider exits 2 without key leakage");
} finally { await new Promise<void>((resolveServer, reject) => server.close((error) => error === undefined ? resolveServer() : reject(error))); fixture.cleanup(); }

// Preflight/config scenarios must never contact the local provider or write receipts.
await scenario((_req, res) => { res.writeHead(500); res.end("unused"); }, async ({ workspace, env, requests: count }) => {
  const missingTask = await runCli([bin, "agent"], { cwd: workspace, env });
  const unsupportedProvider = await runCli([bin, "agent", "task"], { cwd: workspace, env: { ...env, OAF_PROVIDER: "other" } });
  assert(missingTask.status === 2 && unsupportedProvider.status === 2 && count() === 0 && receiptFiles(workspace).length === 0 && !`${missingTask.stdout}${missingTask.stderr}${unsupportedProvider.stdout}${unsupportedProvider.stderr}`.includes(env.OAF_TEST_SECRET) && !`${missingTask.stdout}${missingTask.stderr}${unsupportedProvider.stdout}${unsupportedProvider.stderr}`.includes(env.OAF_PROVIDER_BASE_URL) && !`${missingTask.stdout}${missingTask.stderr}${unsupportedProvider.stdout}${unsupportedProvider.stderr}`.includes(workspace), "missing task and unsupported provider are isolated safe preflight failures");
  for (const key of ["OAF_PROVIDER", "OAF_PROVIDER_BASE_URL", "OAF_MODEL", "OAF_API_KEY_ENV", "OAF_TEST_SECRET"]) {
    const next = { ...env }; delete next[key];
    const result = await runCli([bin, "agent", "task"], { cwd: workspace, env: next });
    assert(result.status === 2 && count() === 0 && receiptFiles(workspace).length === 0 && !`${result.stdout}${result.stderr}`.includes(env.OAF_TEST_SECRET) && !`${result.stdout}${result.stderr}`.includes(env.OAF_PROVIDER_BASE_URL) && !`${result.stdout}${result.stderr}`.includes("Authorization") && !`${result.stdout}${result.stderr}`.includes(workspace), `missing ${key} fails before provider`);
  }
  for (const value of ["", " ", "+1", "-1", "0", "17", "1.5", "1e1", "1x"]) {
    const result = await runCli([bin, "agent", "task"], { cwd: workspace, env: { ...env, OAF_MAX_TURNS: value } });
    assert(result.status === 2 && count() === 0 && receiptFiles(workspace).length === 0 && !`${result.stdout}${result.stderr}`.includes(env.OAF_TEST_SECRET) && !`${result.stdout}${result.stderr}`.includes(env.OAF_PROVIDER_BASE_URL) && !`${result.stdout}${result.stderr}`.includes("Authorization") && !`${result.stdout}${result.stderr}`.includes(workspace), `invalid max turns ${JSON.stringify(value)} exits 2`);
  }
  const badName = await runCli([bin, "agent", "task"], { cwd: workspace, env: { ...env, OAF_API_KEY_ENV: "bad-name" } });
  const option = await runCli([bin, "agent", "--bad"], { cwd: workspace, env });
  assert(badName.status === 2 && option.status === 2 && count() === 0 && receiptFiles(workspace).length === 0 && !`${badName.stdout}${badName.stderr}${option.stdout}${option.stderr}`.includes(env.OAF_TEST_SECRET) && !`${badName.stdout}${badName.stderr}${option.stdout}${option.stderr}`.includes(env.OAF_PROVIDER_BASE_URL) && !`${badName.stdout}${badName.stderr}${option.stdout}${option.stderr}`.includes("Authorization") && !`${badName.stdout}${badName.stderr}${option.stdout}${option.stderr}`.includes(workspace), "invalid key name and unsupported option fail preflight");
});
const invalidWorkspace = copyGeneratedAppFixture();
try { rmSync(join(invalidWorkspace.workspace, "oaf"), { recursive: true }); const result = await runCli([bin, "agent", "task"], { cwd: invalidWorkspace.workspace, env: { ...process.env, OAF_PROVIDER: "openai-compatible", OAF_PROVIDER_BASE_URL: "http://127.0.0.1:9", OAF_MODEL: "test/model", OAF_API_KEY_ENV: "NO_KEY", NO_KEY: "x" } }); assert(result.status === 2 && !`${result.stdout}${result.stderr}`.includes(invalidWorkspace.workspace), "invalid workspace exits 2 without host path"); } finally { invalidWorkspace.cleanup(); }

await scenario((_req, res) => { res.writeHead(500); res.end("RAW_HTTP_BODY_SECRET"); }, async ({ workspace, env, requests: count }) => {
  const result = await runCli([bin, "agent", "task"], { cwd: workspace, env }); const files = receiptFiles(workspace); const receipt = parseReceipt(readFileSync(join(workspace, "oaf/receipts", files[0]), "utf8"));
  assert(result.status === 1 && count() === 1 && files.length === 1 && receipt.status === "failed" && receipt.terminalReason === "provider_error" && receipt.usage.calls === 1 && receipt.usage.tokensIn === null && receipt.usage.tokensOut === null && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes("RAW_HTTP_BODY_SECRET") && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes(env.OAF_TEST_SECRET) && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes(env.OAF_PROVIDER_BASE_URL) && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes("Authorization") && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes(workspace), "HTTP failure writes one safe failed receipt");
});
await scenario((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("{bad response body}"); }, async ({ workspace, env, requests: count }) => {
  const result = await runCli([bin, "agent", "task"], { cwd: workspace, env }); const files = receiptFiles(workspace); const receipt = parseReceipt(readFileSync(join(workspace, "oaf/receipts", files[0]), "utf8"));
  assert(result.status === 1 && count() === 1 && files.length === 1 && receipt.status === "failed" && receipt.terminalReason === "provider_error" && receipt.usage.calls === 1 && receipt.usage.tokensIn === null && receipt.usage.tokensOut === null && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes("bad response body") && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes(env.OAF_TEST_SECRET) && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes(env.OAF_PROVIDER_BASE_URL) && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes("Authorization") && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes(workspace), "malformed response writes one safe failed receipt");
});
await scenario((_req, res, _body, number) => { const payload = { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: `turn_${number}`, type: "function", function: { name: "read", arguments: JSON.stringify({ path: "README.md" }) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); }, async ({ workspace, env, requests: count }) => {
  const result = await runCli([bin, "agent", "loop"], { cwd: workspace, env: { ...env, OAF_MAX_TURNS: "2" } }); const files = receiptFiles(workspace); const receipt = parseReceipt(readFileSync(join(workspace, "oaf/receipts", files[0]), "utf8"));
  assert(result.status === 3 && count() === 2 && files.length === 1 && receipt.status === "failed" && receipt.terminalReason === "max_turns" && receipt.usage.calls === 2 && receipt.usage.tokensIn === 2 && receipt.usage.tokensOut === 2 && /exhausted/.test(result.stdout) && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes(env.OAF_TEST_SECRET) && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes(env.OAF_PROVIDER_BASE_URL) && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes("Authorization") && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes(workspace), "max turns exits 3 with one exhausted receipt");
});
await scenario((_req, res, _body, number) => { const payload = number === 1 ? { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "protected_1", type: "function", function: { name: "read", arguments: JSON.stringify({ path: ".env.missing" }) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } : { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "partial done" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); }, async ({ workspace, env, requests: count }) => {
  const result = await runCli([bin, "agent", "protected"], { cwd: workspace, env }); const files = receiptFiles(workspace); const receipt = parseReceipt(readFileSync(join(workspace, "oaf/receipts", files[0]), "utf8"));
  assert(result.status === 1 && count() === 2 && files.length === 1 && receipt.status === "partial" && receipt.terminalReason === "assistant_terminal" && receipt.usage.calls === 2 && receipt.usage.tokensIn === 2 && receipt.usage.tokensOut === 2 && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes(workspace) && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes(env.OAF_TEST_SECRET) && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes(env.OAF_PROVIDER_BASE_URL) && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes("Authorization") && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes(".env.missing"), "protected path becomes partial without host-path leakage");
});
await scenario((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "receipt failure" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })); }, async ({ workspace, env, requests: count }) => {
  rmSync(join(workspace, "oaf", "receipts"), { recursive: true }); writeFileSync(join(workspace, "oaf", "receipts"), "blocked");
  const result = await runCli([bin, "agent", "receipt"], { cwd: workspace, env: { ...env, OAF_DIAGNOSTICS: "1" } });
  const diagnostics = readdirSync(join(workspace, "oaf", "diagnostics")).filter((name) => name.endsWith(".json"));
  assert(result.status === 1 && count() === 1 && receiptFiles(workspace).length === 0 && diagnostics.length === 1 && /Diagnostics: oaf\/diagnostics\//.test(result.stdout) && /receipt could not be written/.test(result.stderr) && !/Receipt:/.test(result.stdout) && !`${result.stdout}${result.stderr}`.includes(workspace) && !`${result.stdout}${result.stderr}`.includes(env.OAF_TEST_SECRET) && !`${result.stdout}${result.stderr}`.includes(env.OAF_PROVIDER_BASE_URL) && !`${result.stdout}${result.stderr}`.includes("Authorization"), "receipt-write failure is bounded with no receipt claim or retry");
});
await scenario((_req, res) => { const content = `safe \x1b[31mRED\x1b[0m \x1b]title\x07 \x1b]st\x1b\\ \x1bX\0a\bb\u0085\r\n\t😀${"z".repeat(9000)}`; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })); }, async ({ workspace, env }) => {
  const result = await runCli([bin, "agent", "sanitize"], { cwd: workspace, env }); const response = result.stdout.split("Response:\n")[1] ?? "";
  assert(result.status === 0 && response.includes("safe RED") && response.includes("😀") && response.includes("[response truncated]") && !/[\x00-\x08\x0b-\x1f\x7f-\x9f\x1b]/.test(response) && Buffer.byteLength(response.trimEnd(), "utf8") <= 8192, "spawned CLI sanitizes terminal controls and bounds Unicode response");
});
const commandFixture = copyGeneratedAppFixture();
try {
  const help = await runCli([bin, "--help"], { cwd: commandFixture.workspace, env: process.env });
  const doctor = await runCli([bin, "doctor"], { cwd: commandFixture.workspace, env: process.env });
  const sandbox = await runCli([bin, "sandbox", "run", "sudo rm -rf /"], { cwd: commandFixture.workspace, env: process.env });
  assert(help.status === 0 && /agent/.test(help.stdout) && doctor.status === 0 && /valid OAF/.test(doctor.stdout) && sandbox.status !== 0 && /blocked/i.test(`${sandbox.stdout}${sandbox.stderr}`), "help, doctor, and sandbox policy dispatch remain functional");
} finally { commandFixture.cleanup(); }
const initParent = copyGeneratedAppFixture();
try { const target = join(initParent.workspace, "new-app"); const init = await runCli([bin, "init", "new-app"], { cwd: initParent.workspace, env: process.env }); const doctor = await runCli([bin, "doctor"], { cwd: target, env: process.env }); assert(init.status === 0 && existsSync(join(target, "oaf", "app.json")) && doctor.status === 0, "init creates marked app and doctor succeeds"); } finally { initParent.cleanup(); }
const toolErrorCases: readonly [string, string, object, string, string][] = [
  ["missing read", "read", { path: "app/does-not-exist.ts" }, "PATH_NOT_FOUND", "requested path does not exist"],
  ["missing list", "list", { path: "app/does-not-exist" }, "PATH_NOT_FOUND", "requested path does not exist"],
  ["missing grep", "grep", { path: "app/does-not-exist", pattern: "x" }, "PATH_NOT_FOUND", "requested path does not exist"],
  ["protected read", "read", { path: ".env.missing" }, "AGENT_PATH_DENIED", "requested project path is not available to the agent"],
  ["read directory", "read", { path: "app" }, "NOT_A_FILE", "requested path is not a file"],
  ["list file", "list", { path: "README.md" }, "NOT_A_DIRECTORY", "requested path is not a directory"],
  ["invalid range", "read", { path: "README.md", startLine: 2, endLine: 1 }, "INVALID_LINE_RANGE", "requested line range is invalid"],
  ["invalid args", "read", { path: 1 }, "INVALID_TOOL_ARGUMENTS", "tool arguments are invalid"],
];
for (const [name, tool, args, code, error] of toolErrorCases) {
  const requests: WireRequest[] = [];
  await scenario((_req, res, body, number) => { requests.push(parseWireRequest(body)); const payload = number === 1 ? { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "error_1", type: "function", function: { name: tool, arguments: JSON.stringify(args) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } : { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "done" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); }, async ({ workspace, env, requests: count }) => {
    const result = await runCli([bin, "agent", name], { cwd: workspace, env }); const files = receiptFiles(workspace); const receipt = parseReceipt(readFileSync(join(workspace, "oaf/receipts", files[0]), "utf8")); const toolMessage = requests[1]?.messages?.find((message) => message.role === "tool" && message.tool_call_id === "error_1"); let wire: unknown; try { wire = parseJson(toolMessage?.content ?? ""); } catch {}
    const all = `${JSON.stringify(requests)}${result.stdout}${result.stderr}${JSON.stringify(receipt)}`;
    assert(result.status === 1 && count() === 2 && files.length === 1 && receipt.status === "partial" && property(wire, "code") === code && property(wire, "error") === error && !all.includes(workspace) && !all.includes(env.OAF_TEST_SECRET) && !all.includes(env.OAF_PROVIDER_BASE_URL) && !all.includes("Authorization"), `provider wire ${name} uses exact bounded pair`);
  });
}
// ---------------------------------------------------------------------------
// A-D: diagnostics-enabled CLI scenarios (OAF_DIAGNOSTICS=1)
// ---------------------------------------------------------------------------

// A. DIAGNOSTICS DISABLED (no OAF_DIAGNOSTICS)
await scenario((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "no diag" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })); }, async ({ workspace, env }) => {
  const envNoDiag = { ...env }; delete envNoDiag.OAF_DIAGNOSTICS;
  const result = await runCli([bin, "agent", "task"], { cwd: workspace, env: envNoDiag });
  assert(result.status === 0, "A(CLI): exit 0");
  assert(!existsSync(join(workspace, "oaf", "diagnostics")), "A(CLI): no diagnostics dir/file");
  assert(!result.stdout.includes("Diagnostics:"), "A(CLI): no Diagnostics: line");
  assert(receiptFiles(workspace).length === 1, "A(CLI): exactly one receipt");
});

// B. SUCCESS + diagnostic written
await scenario((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "success diag" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })); }, async ({ workspace, env }) => {
  const result = await runCli([bin, "agent", "task"], { cwd: workspace, env: { ...env, OAF_DIAGNOSTICS: "1" } });
  const diags = readdirSync(join(workspace, "oaf", "diagnostics")).filter((n) => n.endsWith(".json"));
  const diag = diags.length === 1 ? parseDiagnostic(readFileSync(join(workspace, "oaf", "diagnostics", diags[0]), "utf8")) : EMPTY_DIAGNOSTIC;
  assert(result.status === 0 && diags.length === 1 && diag !== null, "B(CLI): exactly 1 diagnostic");
  assert(receiptFiles(workspace).length === 1, "B(CLI): exactly one receipt");
  assert(diag.schemaVersion === "0.1.0" && diag.status === "success" && diag.terminalReason === "assistant_terminal" && diag.turns === 1, "B(CLI): schemaVersion, status, terminalReason, turns");
  assert(diag.providerAttempts.length === 1 && diag.providerAttempts[0].outcome === "success", "B(CLI): 1 successful attempt");
  assert(diag.provider === "openai-compatible" && diag.requestedModel === "test/model", "B(CLI): provider and model");
  assert(typeof diag.receiptPath === "string" && diag.receiptPath.startsWith("oaf/receipts/"), "B(CLI): receiptPath set");
  assert(diag.tools.length === 0, "B(CLI): no tools");
  assert(!`${result.stdout}${result.stderr}${JSON.stringify(diag)}`.includes(env.OAF_TEST_SECRET) && !`${result.stdout}${result.stderr}${JSON.stringify(diag)}`.includes(env.OAF_PROVIDER_BASE_URL) && !`${result.stdout}${result.stderr}${JSON.stringify(diag)}`.includes("Authorization"), "B(CLI): sentinels absent");
});

// C. PARTIAL + diagnostic written
await scenario((_req, res, _body, number) => { const payload = number === 1 ? { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "nope_1", type: "function", function: { name: "nonexistent", arguments: "{}" } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } : { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "partial done" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); }, async ({ workspace, env }) => {
  const result = await runCli([bin, "agent", "task"], { cwd: workspace, env: { ...env, OAF_DIAGNOSTICS: "1" } });
  const diags = readdirSync(join(workspace, "oaf", "diagnostics")).filter((n) => n.endsWith(".json"));
  const diag = diags.length === 1 ? parseDiagnostic(readFileSync(join(workspace, "oaf", "diagnostics", diags[0]), "utf8")) : EMPTY_DIAGNOSTIC;
  assert(result.status === 1 && diags.length === 1 && diag !== null, "C(CLI): partial triggers diagnostic");
  assert(receiptFiles(workspace).length === 1, "C(CLI): exactly one receipt");
  assert(diag.status === "partial" && diag.terminalReason === "assistant_terminal", "C(CLI): partial status");
  assert(diag.tools.length === 1 && diag.tools[0].outcome === "rejected" && diag.tools[0].toolName === null, "C(CLI): rejected tool");
  assert(diag.providerAttempts.length === 2 && diag.providerAttempts.every((a: { outcome?: unknown }) => a.outcome === "success"), "C(CLI): 2 successful attempts");
});

// D. MAX TURNS + diagnostic written
await scenario((_req, res, _body, number) => { const payload = { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: `loop_${number}`, type: "function", function: { name: "read", arguments: JSON.stringify({ path: "README.md" }) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); }, async ({ workspace, env }) => {
  const result = await runCli([bin, "agent", "loop"], { cwd: workspace, env: { ...env, OAF_DIAGNOSTICS: "1", OAF_MAX_TURNS: "2" } });
  const diags = readdirSync(join(workspace, "oaf", "diagnostics")).filter((n) => n.endsWith(".json"));
  const diag = diags.length === 1 ? parseDiagnostic(readFileSync(join(workspace, "oaf", "diagnostics", diags[0]), "utf8")) : EMPTY_DIAGNOSTIC;
  assert(result.status === 3 && diags.length === 1 && diag !== null, "D(CLI): max turns diagnostic");
  assert(receiptFiles(workspace).length === 1, "D(CLI): exactly one receipt");
  assert(diag.status === "failed" && diag.terminalReason === "max_turns", "D(CLI): failed + max_turns");
  assert(diag.turns === 2 && diag.providerAttempts.length === 2, "D(CLI): 2 turns, 2 attempts");
});

// C(exec): partial with execution_error
await scenario((_req, res, _body, number) => {
  const payload = number === 1
    ? { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "exec_1", type: "function", function: { name: "read", arguments: JSON.stringify({ path: "nonexistent.ts" }) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
    : { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "done exec" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(payload));
}, async ({ workspace, env }) => {
  const result = await runCli([bin, "agent", "task"], { cwd: workspace, env: { ...env, OAF_DIAGNOSTICS: "1" } });
  const diags = readdirSync(join(workspace, "oaf", "diagnostics")).filter((n) => n.endsWith(".json"));
  const diag = diags.length === 1 ? parseDiagnostic(readFileSync(join(workspace, "oaf", "diagnostics", diags[0]), "utf8")) : EMPTY_DIAGNOSTIC;
  assert(result.status === 1 && receiptFiles(workspace).length === 1 && diags.length === 1 && diag !== null, "C(exec): partial + diagnostic");
  assert(diag.status === "partial" && diag.terminalReason === "assistant_terminal", "C(exec): partial status");
  assert(diag.tools.length === 1 && diag.tools[0].toolName === "read" && diag.tools[0].outcome === "execution_error", "C(exec): execution_error on read");
  assert(diag.providerAttempts.length === 2, "C(exec): 2 attempts");
});

// ---------------------------------------------------------------------------
// E. HTTP STATUS MATRIX
// ---------------------------------------------------------------------------
const httpStatusCases: readonly [string, number, string, string, number, string][] = [
  ["401", 401, "authentication_failed", "authentication failed.", 1, "SENTINEL_401_BODY"],
  ["403", 403, "authentication_failed", "authentication failed.", 1, "SENTINEL_403_BODY"],
  ["404", 404, "not_found", "HTTP 404 (not found).", 1, "SENTINEL_404_BODY"],
  ["429", 429, "rate_limited", "HTTP 429 (rate limited).", 1, "SENTINEL_429_BODY"],
  ["500", 500, "http_error", "HTTP 500.", 1, "SENTINEL_500_BODY"],
];
for (const [label, statusCode, expectedOutcome, expectedMsg, expectedExit, sentinel] of httpStatusCases) {
  await scenario((_req, res) => { res.writeHead(statusCode); res.end(sentinel); }, async ({ workspace, env, requests: count }) => {
    const result = await runCli([bin, "agent", "task"], { cwd: workspace, env: { ...env, OAF_DIAGNOSTICS: "1" } });
    const diags = readdirSync(join(workspace, "oaf", "diagnostics")).filter((n) => n.endsWith(".json"));
    const diag = diags.length === 1 ? parseDiagnostic(readFileSync(join(workspace, "oaf", "diagnostics", diags[0]), "utf8")) : EMPTY_DIAGNOSTIC;
    const receipts = receiptFiles(workspace);
    const receipt = receipts.length === 1 ? parseReceipt(readFileSync(join(workspace, "oaf/receipts", receipts[0]), "utf8")) : EMPTY_RECEIPT;
    assert(result.status === expectedExit && receipts.length === 1 && diags.length === 1 && diag !== null && receipt !== null && count() === 1, `E(${label}): 1 request, 1 receipt, 1 diagnostic`);
    assert(diag.status === "failed" && diag.terminalReason === "provider_error", `E(${label}): failed + provider_error`);
    assert(diag.providerAttempts.length === 1 && diag.providerAttempts[0].outcome === expectedOutcome && diag.providerAttempts[0].httpStatus === statusCode, `E(${label}): outcome ${expectedOutcome}, httpStatus ${statusCode}`);
    assert(diag.tools.length === 0, `E(${label}): no tools`);
    assert(typeof diag.receiptPath === "string" && diag.receiptPath.startsWith("oaf/receipts/"), `E(${label}): receiptPath set`);
    assert(receipt.status === "failed" && receipt.terminalReason === "provider_error", `E(${label}): receipt matches`);
    const output = `${result.stdout}${result.stderr}`;
    assert(output.includes(`Provider error: ${expectedMsg}`), `E(${label}): CLI prints "${expectedMsg}"`);
    const all = `${output}${JSON.stringify(diag)}${JSON.stringify(receipt)}`;
    assert(!all.includes(sentinel), `E(${label}): body sentinel absent`);
    assert(!all.includes(env.OAF_TEST_SECRET) && !all.includes(env.OAF_PROVIDER_BASE_URL) && !all.includes("Authorization") && !all.includes(workspace), `E(${label}): sentinels absent`);
  });
}

// ---------------------------------------------------------------------------
// F. PROVIDER FAILURE MATRIX
// ---------------------------------------------------------------------------

// F1: network failure (server destroys socket immediately)
await scenario((_req, res) => { if (res.socket !== null) res.socket.destroy(); }, async ({ workspace, env }) => {
  const result = await runCli([bin, "agent", "task"], { cwd: workspace, env: { ...env, OAF_DIAGNOSTICS: "1" } });
  const diags = readdirSync(join(workspace, "oaf", "diagnostics")).filter((n) => n.endsWith(".json"));
  const diag = diags.length === 1 ? parseDiagnostic(readFileSync(join(workspace, "oaf", "diagnostics", diags[0]), "utf8")) : EMPTY_DIAGNOSTIC;
  const receipts = receiptFiles(workspace);
  assert(result.status === 1 && receipts.length === 1 && diags.length === 1 && diag !== null, "F(net): 1 receipt + 1 diagnostic");
  assert(diag.status === "failed" && diag.terminalReason === "provider_error", "F(net): failed + provider_error");
  assert(diag.providerAttempts.length === 1 && diag.providerAttempts[0].outcome === "network_error", "F(net): network_error outcome");
  assert(diag.providerAttempts[0].httpStatus === null, "F(net): httpStatus null");
});

// F2: invalid JSON (200 with non-JSON body)
await scenario((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("{bad"); }, async ({ workspace, env }) => {
  const result = await runCli([bin, "agent", "task"], { cwd: workspace, env: { ...env, OAF_DIAGNOSTICS: "1" } });
  const diags = readdirSync(join(workspace, "oaf", "diagnostics")).filter((n) => n.endsWith(".json"));
  const diag = diags.length === 1 ? parseDiagnostic(readFileSync(join(workspace, "oaf", "diagnostics", diags[0]), "utf8")) : EMPTY_DIAGNOSTIC;
  const receipts = receiptFiles(workspace);
  assert(result.status === 1 && receipts.length === 1 && diags.length === 1 && diag !== null, "F(json): 1 receipt + 1 diagnostic");
  assert(diag.providerAttempts[0].outcome === "invalid_json", "F(json): invalid_json outcome");
  assert(diag.providerAttempts[0].httpStatus === null, "F(json): httpStatus null");
});

// F3: malformed provider response (valid JSON but missing choices)
await scenario((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ no: "choices" })); }, async ({ workspace, env }) => {
  const result = await runCli([bin, "agent", "task"], { cwd: workspace, env: { ...env, OAF_DIAGNOSTICS: "1" } });
  const diags = readdirSync(join(workspace, "oaf", "diagnostics")).filter((n) => n.endsWith(".json"));
  const diag = diags.length === 1 ? parseDiagnostic(readFileSync(join(workspace, "oaf", "diagnostics", diags[0]), "utf8")) : EMPTY_DIAGNOSTIC;
  const receipts = receiptFiles(workspace);
  assert(result.status === 1 && receipts.length === 1 && diags.length === 1 && diag !== null, "F(malformed): 1 receipt + 1 diagnostic");
  assert(diag.providerAttempts[0].outcome === "invalid_response", "F(malformed): invalid_response outcome");
  assert(diag.providerAttempts[0].httpStatus === null, "F(malformed): httpStatus null");
});

// F4: empty body (parses as invalid JSON)
await scenario((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(); }, async ({ workspace, env }) => {
  const result = await runCli([bin, "agent", "task"], { cwd: workspace, env: { ...env, OAF_DIAGNOSTICS: "1" } });
  const diags = readdirSync(join(workspace, "oaf", "diagnostics")).filter((n) => n.endsWith(".json"));
  const diag = diags.length === 1 ? parseDiagnostic(readFileSync(join(workspace, "oaf", "diagnostics", diags[0]), "utf8")) : EMPTY_DIAGNOSTIC;
  const receipts = receiptFiles(workspace);
  assert(result.status === 1 && receipts.length === 1 && diags.length === 1 && diag !== null, "F(empty): 1 receipt + 1 diagnostic");
  assert(diag.providerAttempts[0].outcome === "invalid_json", "F(empty): invalid_json outcome");
  assert(diag.providerAttempts[0].httpStatus === null, "F(empty): httpStatus null");
});

// ---------------------------------------------------------------------------
// H. DIAGNOSTIC-WRITE FAILURE MATRIX (blocked diagnostics, spawned CLI)
// ---------------------------------------------------------------------------
function blockDiagnostics(ws: string): void {
  rmSync(join(ws, "oaf", "diagnostics"), { recursive: true, force: true });
  writeFileSync(join(ws, "oaf", "diagnostics"), "blocked");
  mkdirSync(join(ws, "oaf", "receipts"), { recursive: true });
}

function assertBlockedDiag(result: CliProcessResult, ws: string, expExit: number, expStatus: string, expReason: string, env: ScenarioEnvironment): void {
  assert(result.status === expExit, `H: exit ${expExit}`);
  assert(receiptFiles(ws).length === 1, "H: exactly one receipt");
  const receipts = receiptFiles(ws);
  const receipt = parseReceipt(readFileSync(join(ws, "oaf/receipts", receipts[0]), "utf8"));
  assert(receipt.status === expStatus, `H: receipt status ${expStatus}`);
  assert(receipt.terminalReason === expReason, `H: receipt reason ${expReason}`);
  const diagStat = statSync(join(ws, "oaf/diagnostics"), { throwIfNoEntry: false });
  assert(diagStat === undefined || !diagStat.isDirectory(), "H: no diagnostic JSON file");
  const warningCount = (result.stderr.match(/Warning: diagnostics could not be written\./g) || []).length;
  assert(warningCount === 1, `H: exactly 1 warning (got ${warningCount})`);
  assert(!result.stdout.includes("Diagnostics:"), "H: no Diagnostics: success line");
  assert(!/EEXIST|ENOTDIR|EACCES/.test(result.stderr), "H: no raw fs error text");
  const all = `${result.stdout}${result.stderr}${JSON.stringify(receipt)}`;
  assert(!all.includes(env.OAF_TEST_SECRET) && !all.includes(env.OAF_PROVIDER_BASE_URL) && !all.includes("Authorization") && !all.includes(ws), "H: sentinels absent");
}

// H1: success
await scenario((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })); }, async ({ workspace, env }) => {
  blockDiagnostics(workspace);
  const result = await runCli([bin, "agent", "task"], { cwd: workspace, env: { ...env, OAF_DIAGNOSTICS: "1" } });
  assertBlockedDiag(result, workspace, 0, "success", "assistant_terminal", env);
});

// H2: partial
await scenario((_req, res, _body, number) => {
  const payload = number === 1
    ? { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "h2_1", type: "function", function: { name: "nonexistent", arguments: "{}" } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
    : { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "partial done" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(payload));
}, async ({ workspace, env }) => {
  blockDiagnostics(workspace);
  const result = await runCli([bin, "agent", "task"], { cwd: workspace, env: { ...env, OAF_DIAGNOSTICS: "1" } });
  assertBlockedDiag(result, workspace, 1, "partial", "assistant_terminal", env);
});

// H3: provider failure (HTTP 500)
await scenario((_req, res) => { res.writeHead(500); res.end("server error"); }, async ({ workspace, env }) => {
  blockDiagnostics(workspace);
  const result = await runCli([bin, "agent", "task"], { cwd: workspace, env: { ...env, OAF_DIAGNOSTICS: "1" } });
  assertBlockedDiag(result, workspace, 1, "failed", "provider_error", env);
});

// H4: max turns
await scenario((_req, res, _body, number) => {
  const payload = { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: `h4_${number}`, type: "function", function: { name: "read", arguments: JSON.stringify({ path: "README.md" }) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(payload));
}, async ({ workspace, env }) => {
  blockDiagnostics(workspace);
  const result = await runCli([bin, "agent", "loop"], { cwd: workspace, env: { ...env, OAF_DIAGNOSTICS: "1", OAF_MAX_TURNS: "2" } });
  assertBlockedDiag(result, workspace, 3, "failed", "max_turns", env);
});

// ---------------------------------------------------------------------------
// EXIT CODE VERIFICATION
// ---------------------------------------------------------------------------
// Exit codes are already verified by existing tests:
//   - 0: success (B, H1, A)
//   - 1: partial (C, C(exec)), provider failure (E, F, H2, H3)
//   - 3: max turns (D, H4)

if (failures) process.exit(1);
console.log("All agent CLI checks passed.");
