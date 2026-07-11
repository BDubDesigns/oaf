import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { copyGeneratedAppFixture } from "./generated-app-fixture-helper.mjs";
import { sanitizeTerminal, usageFrom } from "../lib/agent/cli.mjs";

let failures = 0;
function assert(ok, message) { if (ok) console.log(`PASS  ${message}`); else { console.log(`FAIL  ${message}`); failures++; } }
function runCli(args, options) { return new Promise((resolveChild) => { const child = spawn("node", args, options); let stdout = ""; let stderr = ""; child.stdout.on("data", (data) => { stdout += data; }); child.stderr.on("data", (data) => { stderr += data; }); child.on("close", (status) => resolveChild({ status, stdout, stderr })); }); }
const repo = resolve(import.meta.dirname, "..");
const sanitized = sanitizeTerminal("\x1b[31mRED\x1b[0m\x1b]title\x07\0x\by\rz\n\tok");
assert(sanitized === "REDxyz\n\tok", "terminal sanitizer strips CSI, OSC, controls, and CR");
const unicode = sanitizeTerminal("a".repeat(8190) + "€😀");
assert(Buffer.byteLength(unicode, "utf8") <= 8192 + Buffer.byteLength("\n[response truncated]", "utf8") && unicode.endsWith("[response truncated]"), "terminal sanitizer truncates at Unicode boundary");
const usageFailure = usageFrom({ turns: 1, providerCalls: [] }, { model: " test/model " });
assert(usageFailure.calls === 1 && usageFailure.tokensIn === null && usageFailure.tokensOut === null && usageFailure.model === "test/model", "usage counts failed attempts without fabricated tokens");
const fixture = copyGeneratedAppFixture();
const secret = "OAF_CLI_SECRET_SENTINEL";
let calls = 0;
let auth = null;
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    auth = req.headers.authorization;
    const request = JSON.parse(body);
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
if (failures) process.exit(1);
console.log("All agent CLI checks passed.");
