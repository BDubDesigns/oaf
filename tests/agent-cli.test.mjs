import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { copyGeneratedAppFixture } from "./generated-app-fixture-helper.mjs";
import { sanitizeTerminal, usageFrom } from "../lib/agent/cli.mjs";

let failures = 0;
function assert(ok, message) { if (ok) console.log(`PASS  ${message}`); else { console.log(`FAIL  ${message}`); failures++; } }
function runCli(args, options) { return new Promise((resolveChild, reject) => { const child = spawn("node", args, options); let stdout = ""; let stderr = ""; child.stdout.on("data", (data) => { stdout += data; }); child.stderr.on("data", (data) => { stderr += data; }); child.on("error", reject); child.on("close", (status) => resolveChild({ status, stdout, stderr })); }); }
const repo = resolve(import.meta.dirname, "..");
const bin = join(repo, "bin/oaf.mjs");
function receiptFiles(workspace) { const dir = join(workspace, "oaf/receipts"); return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")) : []; }
async function scenario(responder, callback) {
  let requests = 0;
  const server = createServer((req, res) => { let body = ""; req.on("data", (chunk) => { body += chunk; }); req.on("end", () => { requests++; responder(req, res, body, requests); }); });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const fixture = copyGeneratedAppFixture();
  const env = { ...process.env, OAF_PROVIDER: "openai-compatible", OAF_PROVIDER_BASE_URL: `http://127.0.0.1:${server.address().port}`, OAF_MODEL: "test/model", OAF_API_KEY_ENV: "OAF_TEST_SECRET", OAF_TEST_SECRET: "SCENARIO_KEY_59", OAF_MAX_TURNS: "3" };
  try { await callback({ workspace: fixture.workspace, env, requests: () => requests }); }
  finally { await new Promise((done) => server.close(done)); fixture.cleanup(); }
}
const sanitized = sanitizeTerminal("\x1b[31mRED\x1b[0m\x1b]title\x07\0x\by\rz\n\tok");
assert(sanitized === "REDxyz\n\tok", "terminal sanitizer strips CSI, OSC, controls, and CR");
const unicode = sanitizeTerminal("a".repeat(8190) + "€😀");
assert(Buffer.byteLength(unicode, "utf8") <= 8192 && unicode.endsWith("[response truncated]"), "terminal sanitizer truncates at Unicode boundary within final byte limit");
const usageFailure = usageFrom({ turns: 1, providerCalls: [] }, { model: " test/model " });
assert(usageFailure.calls === 1 && usageFailure.tokensIn === null && usageFailure.tokensOut === null && usageFailure.model === "test/model", "usage counts failed attempts without fabricated tokens");
const fixture = copyGeneratedAppFixture();
const secret = "OAF_CLI_SECRET_SENTINEL";
let calls = 0;
let auth = null;
const requests = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    auth = req.headers.authorization;
    const request = JSON.parse(body);
    requests.push(request);
    const payload = calls++ === 0
      ? { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "cli_tool_1", type: "function", function: { name: "write", arguments: JSON.stringify({ path: "app/oaf-cli-test.txt", content: "cli wrote this" }) } }] } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }
      : { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "CLI terminal response" } }], usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 } };
    assert(Array.isArray(request.tools) && request.tools.length === 5, "CLI sends fixed tool definitions");
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(payload));
  });
});
await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
try {
  const port = server.address().port;
  const env = { ...process.env, OAF_PROVIDER: "openai-compatible", OAF_PROVIDER_BASE_URL: `http://127.0.0.1:${port}`, OAF_MODEL: "test/model", OAF_API_KEY_ENV: "OAF_TEST_SECRET", OAF_TEST_SECRET: secret, OAF_MAX_TURNS: "4" };
  const success = await runCli([join(repo, "bin/oaf.mjs"), "agent", "write", "a", "file"], { cwd: fixture.workspace, env });
  const output = success.stdout + success.stderr;
  assert(success.status === 0, "successful CLI round trip exits 0");
  assert(existsSync(join(fixture.workspace, "app/oaf-cli-test.txt")), "provider tool call writes allowed file");
  const secondMessages = requests[1]?.messages ?? [];
  const assistantToolCall = secondMessages.find((message) => message.role === "assistant" && message.tool_calls?.[0]?.id === "cli_tool_1");
  const toolResult = secondMessages.find((message) => message.role === "tool" && message.tool_call_id === "cli_tool_1");
  assert(Boolean(assistantToolCall) && Boolean(toolResult) && toolResult.content.includes("app/oaf-cli-test.txt") && toolResult.content.includes("bytes"), "second request preserves exact tool-call/result protocol");
  assert(!JSON.stringify(secondMessages).includes(secret) && !JSON.stringify(secondMessages).includes(fixture.workspace), "tool-result protocol omits key and host path");
  assert(/Receipt: oaf\/receipts\/.+\.json/.test(output), "CLI prints project-relative receipt path");
  assert(/Response:\nCLI terminal response/.test(output), "CLI prints established terminal content under response heading");
  assert(auth === `Bearer ${secret}`, "API key sentinel appears only in Authorization header");
  assert(!output.includes(secret), "API key sentinel absent from CLI output");
  const receipts = readdirSync(join(fixture.workspace, "oaf/receipts")).filter((name) => name.endsWith(".json"));
  assert(receipts.length === 1, "successful CLI writes exactly one receipt");
  const receipt = JSON.parse(readFileSync(join(fixture.workspace, "oaf/receipts", receipts[0]), "utf8"));
  assert(receipt.status === "success" && receipt.terminalReason === "assistant_terminal", "receipt records successful terminal run");
  assert(receipt.usage.provider === "openai-compatible" && receipt.usage.model === "test/model" && receipt.usage.calls === 2 && receipt.usage.tokensIn === 8 && receipt.usage.tokensOut === 6, "receipt records trusted provider usage");
  assert(!JSON.stringify(receipt).includes(secret) && !JSON.stringify(receipt).includes("CLI terminal response"), "receipt omits key and raw model response");
  const missing = await runCli([join(repo, "bin/oaf.mjs"), "agent"], { cwd: fixture.workspace, env });
  assert(missing.status === 2 && /task is required/.test(missing.stderr), "missing task exits 2 before provider");
  const invalidConfig = await runCli([join(repo, "bin/oaf.mjs"), "agent", "x"], { cwd: fixture.workspace, env: { ...env, OAF_PROVIDER: "other" } });
  assert(invalidConfig.status === 2 && !invalidConfig.stdout.includes(secret), "invalid provider exits 2 without key leakage");
} finally { await new Promise((resolveServer) => server.close(resolveServer)); fixture.cleanup(); }

// Preflight/config scenarios must never contact the local provider or write receipts.
await scenario((_req, res) => { res.writeHead(500); res.end("unused"); }, async ({ workspace, env, requests: count }) => {
  for (const key of ["OAF_PROVIDER", "OAF_PROVIDER_BASE_URL", "OAF_MODEL", "OAF_API_KEY_ENV", "OAF_TEST_SECRET"]) {
    const next = { ...env }; delete next[key];
    const result = await runCli([bin, "agent", "task"], { cwd: workspace, env: next });
    assert(result.status === 2 && count() === 0 && receiptFiles(workspace).length === 0 && !`${result.stdout}${result.stderr}`.includes(env.OAF_TEST_SECRET) && !`${result.stdout}${result.stderr}`.includes(workspace), `missing ${key} fails before provider`);
  }
  for (const value of ["", " ", "+1", "-1", "0", "17", "1.5", "1e1", "1x"]) {
    const result = await runCli([bin, "agent", "task"], { cwd: workspace, env: { ...env, OAF_MAX_TURNS: value } });
    assert(result.status === 2 && count() === 0 && receiptFiles(workspace).length === 0, `invalid max turns ${JSON.stringify(value)} exits 2`);
  }
  const badName = await runCli([bin, "agent", "task"], { cwd: workspace, env: { ...env, OAF_API_KEY_ENV: "bad-name" } });
  const option = await runCli([bin, "agent", "--bad"], { cwd: workspace, env });
  assert(badName.status === 2 && option.status === 2 && count() === 0, "invalid key name and unsupported option fail preflight");
});
const invalidWorkspace = copyGeneratedAppFixture();
try { rmSync(join(invalidWorkspace.workspace, "oaf"), { recursive: true }); const result = await runCli([bin, "agent", "task"], { cwd: invalidWorkspace.workspace, env: { ...process.env, OAF_PROVIDER: "openai-compatible", OAF_PROVIDER_BASE_URL: "http://127.0.0.1:9", OAF_MODEL: "test/model", OAF_API_KEY_ENV: "NO_KEY", NO_KEY: "x" } }); assert(result.status === 2 && !`${result.stdout}${result.stderr}`.includes(invalidWorkspace.workspace), "invalid workspace exits 2 without host path"); } finally { invalidWorkspace.cleanup(); }

await scenario((_req, res) => { res.writeHead(500); res.end("RAW_HTTP_BODY_SECRET"); }, async ({ workspace, env, requests: count }) => {
  const result = await runCli([bin, "agent", "task"], { cwd: workspace, env }); const files = receiptFiles(workspace); const receipt = JSON.parse(readFileSync(join(workspace, "oaf/receipts", files[0]), "utf8"));
  assert(result.status === 1 && count() === 1 && files.length === 1 && receipt.terminalReason === "provider_error" && receipt.usage.calls === 1 && receipt.usage.tokensIn === null && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes("RAW_HTTP_BODY_SECRET"), "HTTP failure writes one safe failed receipt");
});
await scenario((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("{bad response body}"); }, async ({ workspace, env, requests: count }) => {
  const result = await runCli([bin, "agent", "task"], { cwd: workspace, env }); const files = receiptFiles(workspace); const receipt = JSON.parse(readFileSync(join(workspace, "oaf/receipts", files[0]), "utf8"));
  assert(result.status === 1 && count() === 1 && files.length === 1 && receipt.usage.calls === 1 && receipt.usage.tokensOut === null && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes("bad response body"), "malformed response writes one safe failed receipt");
});
await scenario((_req, res, _body, number) => { const payload = { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: `turn_${number}`, type: "function", function: { name: "read", arguments: JSON.stringify({ path: "README.md" }) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); }, async ({ workspace, env, requests: count }) => {
  const result = await runCli([bin, "agent", "loop"], { cwd: workspace, env: { ...env, OAF_MAX_TURNS: "2" } }); const files = receiptFiles(workspace); const receipt = JSON.parse(readFileSync(join(workspace, "oaf/receipts", files[0]), "utf8"));
  assert(result.status === 3 && count() === 2 && files.length === 1 && receipt.terminalReason === "max_turns" && receipt.usage.calls === 2 && /exhausted/.test(result.stdout), "max turns exits 3 with one exhausted receipt");
});
await scenario((_req, res, _body, number) => { const payload = number === 1 ? { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "protected_1", type: "function", function: { name: "read", arguments: JSON.stringify({ path: ".env.missing" }) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } : { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "partial done" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); }, async ({ workspace, env, requests: count }) => {
  const result = await runCli([bin, "agent", "protected"], { cwd: workspace, env }); const files = receiptFiles(workspace); const receipt = JSON.parse(readFileSync(join(workspace, "oaf/receipts", files[0]), "utf8"));
  assert(result.status === 1 && count() === 2 && receipt.status === "partial" && !`${result.stdout}${result.stderr}${JSON.stringify(receipt)}`.includes(workspace), "protected path becomes partial without host-path leakage");
});
await scenario((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "receipt failure" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })); }, async ({ workspace, env, requests: count }) => {
  rmSync(join(workspace, "oaf", "receipts"), { recursive: true }); writeFileSync(join(workspace, "oaf", "receipts"), "blocked");
  const result = await runCli([bin, "agent", "receipt"], { cwd: workspace, env });
  assert(result.status === 1 && count() === 1 && /receipt could not be written/.test(result.stderr) && !/Receipt:/.test(result.stdout) && !`${result.stdout}${result.stderr}`.includes(workspace), "receipt-write failure is bounded with no receipt claim or retry");
});
const commandFixture = copyGeneratedAppFixture();
try {
  const help = await runCli([bin, "--help"], { cwd: commandFixture.workspace, env: process.env });
  const doctor = await runCli([bin, "doctor"], { cwd: commandFixture.workspace, env: process.env });
  const sandbox = await runCli([bin, "sandbox", "run", "sudo rm -rf /"], { cwd: commandFixture.workspace, env: process.env });
  assert(help.status === 0 && /agent/.test(help.stdout) && doctor.status === 0 && /valid OAF/.test(doctor.stdout) && sandbox.status !== 0 && /blocked/i.test(`${sandbox.stdout}${sandbox.stderr}`), "help, doctor, and sandbox policy dispatch remain functional");
} finally { commandFixture.cleanup(); }
if (failures) process.exit(1);
console.log("All agent CLI checks passed.");
