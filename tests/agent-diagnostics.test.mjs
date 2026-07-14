import { existsSync, statSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildDiagnostic, writeDiagnostic, normalizeDiagnosticSchema, DIAGNOSTICS_DIR } from "../lib/agent/diagnostics.ts";
import { copyGeneratedAppFixture } from "./generated-app-fixture-helper.ts";
import { createMockProvider, ProviderFailure } from "../lib/agent/provider.ts";
import { runAgentLoopWithReceipt, ReceiptWriteError } from "../lib/agent/receipt.ts";
import { createOpenAICompatibleProvider, MAX_BODY_BYTES } from "../lib/agent/openai-compatible-provider.ts";
import { createEvent, createEventCollector } from "../lib/agent/events.ts";

let failures = 0;
/** @param {unknown} ok @param {string} message */
function assert(ok, message) { if (ok) console.log(`PASS  ${message}`); else { console.log(`FAIL  ${message}`); failures++; } }

/** @typedef {ReturnType<typeof copyGeneratedAppFixture>} Fixture */
/** @type {Promise<void>[]} */
const pending = [];
/** @param {(fixture: Fixture) => Promise<void>} fn */
function uses(fn) { const f = copyGeneratedAppFixture(); const p = fn(f).finally(() => f.cleanup()); pending.push(p); }

/** @param {...import("../lib/agent/contracts.ts").AgentEvent} events */
function createRecordedEvents(...events) {
  const collector = createEventCollector();
  for (const event of events) collector.record(event);
  return collector.all();
}

// -------------------------------------------------------------------
// DIAGNOSTIC SCHEMA — normalizeDiagnosticSchema
// -------------------------------------------------------------------

schema: {
  const VALID = {
    schemaVersion: "0.1.0",
    createdAt: "2026-01-01T00:00:00.000Z",
    runId: "run_test",
    provider: "openai-compatible",
    requestedModel: "test/model",
    status: "success",
    terminalReason: "assistant_terminal",
    turns: 2,
    receiptPath: "oaf/receipts/a.json",
    providerAttempts: [{ turn: 1, durationMs: 100, outcome: "success", httpStatus: null }],
    tools: [{ toolName: "read", outcome: "success" }],
  };

  const accepted = normalizeDiagnosticSchema(VALID);
  assert(accepted.runId === "run_test" && accepted.status === "success" && accepted.providerAttempts.length === 1 && accepted.tools.length === 1, "accepts valid diagnostic");

  // null / non-object
  try { normalizeDiagnosticSchema(null); assert(false, "null rejected"); } catch { assert(true, "null rejected"); }
  try { normalizeDiagnosticSchema("bad"); assert(false, "non-object rejected"); } catch { assert(true, "non-object rejected"); }

  // missing / extra top-level keys
  try { normalizeDiagnosticSchema({ schemaVersion: "0.1.0" }); assert(false, "missing keys rejected"); } catch { assert(true, "missing keys rejected"); }
  try { const d = { ...mk(), extra: true }; normalizeDiagnosticSchema(d); assert(false, "extra key rejected"); } catch { assert(true, "extra top-level key rejected"); }

  // Extra nested keys silently normalize to unknown
  const strippedAttempt = normalizeDiagnosticSchema({ ...mk(), providerAttempts: [{ turn: 1, durationMs: 100, outcome: "success", httpStatus: null, secret: "x" }] });
  assert(strippedAttempt.providerAttempts[0].outcome === "unknown_provider_error", "extra attempt key silently normalized");
  const strippedTool = normalizeDiagnosticSchema({ ...mk(), tools: [{ toolName: "read", outcome: "success", args: "x" }] });
  assert(strippedTool.tools[0].outcome === "unknown", "extra tool key silently normalized");

  // --- TIGHTENED SCHEMA (item 4) ---

  // schemaVersion must be exactly "0.1.0"
  try { normalizeDiagnosticSchema({ ...mk(), schemaVersion: "0.2.0" }); assert(false, "wrong schemaVersion rejected"); } catch { assert(true, "wrong schemaVersion rejected"); }
  try { normalizeDiagnosticSchema({ ...mk(), schemaVersion: "0.1" }); assert(false, "partial schemaVersion rejected"); } catch { assert(true, "partial schemaVersion rejected"); }

  // createdAt must be valid ISO-8601
  const badCreated = normalizeDiagnosticSchema({ ...mk(), createdAt: "not-a-date" });
  assert(badCreated.createdAt !== "not-a-date" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(badCreated.createdAt), "invalid createdAt replaced with valid ISO");
  const noCreated = normalizeDiagnosticSchema({ ...mk(), createdAt: 123 });
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(noCreated.createdAt), "non-string createdAt replaced with valid ISO");

  // provider must be null or "openai-compatible"
  const nullProv = normalizeDiagnosticSchema({ ...mk(), provider: null });
  assert(nullProv.provider === null, "null provider accepted");
  const badProv = normalizeDiagnosticSchema({ ...mk(), provider: "anthropic" });
  assert(badProv.provider === null, "non-openai provider normalizes to null");

  // toolName must be null or one of the 5 valid tools
  const nullTool = normalizeDiagnosticSchema({ ...mk(), tools: [{ toolName: null, outcome: "success" }] });
  assert(nullTool.tools[0].toolName === null, "null toolName accepted");
  const badTool = normalizeDiagnosticSchema({ ...mk(), tools: [{ toolName: "delete", outcome: "success" }] });
  assert(badTool.tools[0].toolName === null, "invalid toolName normalizes to null");

  // receiptPath canonicalization
  const absPath = normalizeDiagnosticSchema({ ...mk(), receiptPath: "/tmp/escape.json" });
  assert(absPath.receiptPath === null, "absolute receiptPath normalized to null");
  const travPath = normalizeDiagnosticSchema({ ...mk(), receiptPath: "oaf/receipts/../../etc.json" });
  assert(travPath.receiptPath === null, "traversal receiptPath normalized to null");
  const backslashPath = normalizeDiagnosticSchema({ ...mk(), receiptPath: "oaf\\receipts\\a.json" });
  assert(backslashPath.receiptPath === null, "backslash receiptPath normalized to null");
  const dirPath = normalizeDiagnosticSchema({ ...mk(), receiptPath: "oaf/receipts/sub/dir.json" });
  assert(dirPath.receiptPath === null, "nested receiptPath normalized to null");
  const noExt = normalizeDiagnosticSchema({ ...mk(), receiptPath: "oaf/receipts/readme" });
  assert(noExt.receiptPath === null, "non-JSON receiptPath normalized to null");
  const validCanon = normalizeDiagnosticSchema({ ...mk(), receiptPath: "oaf/receipts/abc-123.json" });
  assert(validCanon.receiptPath === "oaf/receipts/abc-123.json", "valid receiptPath preserved");

  // Invalid enum normalizes to defaults
  const badStatus = normalizeDiagnosticSchema({ ...mk(), status: "bogus" });
  assert(badStatus.status === "success", "assistant terminal reason normalizes status to success");
  const badTerminal = normalizeDiagnosticSchema({ ...mk(), terminalReason: "bogus" });
  assert(badTerminal.terminalReason === "provider_error", "invalid terminalReason normalizes to provider_error");
  const badOutcome = normalizeDiagnosticSchema({ ...mk(), providerAttempts: [{ turn: 1, durationMs: 10, outcome: "bogus", httpStatus: null }] });
  assert(badOutcome.providerAttempts[0].outcome === "unknown_provider_error", "unknown attempt outcome normalizes");

  // Oversized identifiers normalize
  const longRun = normalizeDiagnosticSchema({ ...mk(), runId: "x".repeat(200) });
  assert(longRun.runId === "unknown", "oversized runId normalizes");

  // Unsafe counts normalize to 0
  const negTurns = normalizeDiagnosticSchema({ ...mk(), turns: -1 });
  assert(negTurns.turns === 0, "negative turns normalizes to 0");

  // Invalid HTTP status normalizes to null
  const badHttp = normalizeDiagnosticSchema({ ...mk(), providerAttempts: [{ turn: 1, durationMs: 10, outcome: "http_error", httpStatus: 999 }] });
  assert(badHttp.providerAttempts[0].outcome === "unknown_provider_error" && badHttp.providerAttempts[0].httpStatus === null, "invalid HTTP status normalizes to a non-HTTP failure");

  // Provider attempts and tools default to empty array
  const noAttempts = normalizeDiagnosticSchema({ ...mk(), providerAttempts: null });
  assert(Array.isArray(noAttempts.providerAttempts) && noAttempts.providerAttempts.length === 0, "null providerAttempts defaults to []");
  const noTools = normalizeDiagnosticSchema({ ...mk(), tools: undefined });
  assert(Array.isArray(noTools.tools) && noTools.tools.length === 0, "undefined tools defaults to []");

  function mk() { return { ...VALID }; }
}

// -------------------------------------------------------------------
// PROVIDER FAILURE — hardened non-enumerable contract (item 1)
// -------------------------------------------------------------------
{
  const S_CAUSE = "SENTINEL_PROVIDER_CAUSE";

  // Basic outcome/httpStatus
  const pf = new ProviderFailure("timeout");
  assert(pf.outcome === "timeout", "ProviderFailure outcome preserved");
  assert(pf.httpStatus === null, "ProviderFailure httpStatus null for timeout");
  assert(pf.message === "timeout", "ProviderFailure message equals outcome");
  assert(pf.name === "ProviderFailure", "ProviderFailure name");

  // Object.keys returns only outcome and httpStatus
  const keys = Object.keys(pf).sort();
  assert(JSON.stringify(keys) === JSON.stringify(["httpStatus", "outcome"]), "ProviderFailure Object.keys = outcome + httpStatus");

  // Cause through real constructor — stored as non-enumerable _cause
  const pfWithCause = new ProviderFailure("http_error", { httpStatus: 500, cause: S_CAUSE });
  assert(Object.getOwnPropertyDescriptor(pfWithCause, "_cause")?.value === S_CAUSE, "ProviderFailure _cause accessible");
  assert(!Object.keys(pfWithCause).includes("_cause"), "ProviderFailure _cause not enumerable");
  assert(!JSON.stringify(pfWithCause).includes(S_CAUSE), "ProviderFailure JSON.stringify omits cause");

  // util.inspect omits non-enumerable _cause (Node.js only shows `cause` keyword specially)
  const { inspect } = await import("node:util");
  const inspected = inspect(pfWithCause);
  assert(!inspected.includes(S_CAUSE), "ProviderFailure util.inspect omits cause");

  // name and message also non-enumerable
  assert(!Object.keys(pf).includes("name"), "ProviderFailure name not enumerable");
  assert(!Object.keys(pf).includes("message"), "ProviderFailure message not enumerable");

  const pfHttp = new ProviderFailure("http_error", { httpStatus: 429 });
  assert(pfHttp.outcome === "http_error", "ProviderFailure http_error outcome");
  assert(pfHttp.httpStatus === 429, "ProviderFailure httpStatus preserved");

  const pf2 = new ProviderFailure("authentication_failed");
  assert(pf2.message === "authentication_failed", "ProviderFailure message equals outcome, not caller-supplied text");

  const pf3 = new ProviderFailure("bogus_outcome");
  assert(pf3.outcome === "unknown_provider_error", "ProviderFailure unknown outcome normalizes");
}

// -------------------------------------------------------------------
// PROVIDER FAILURE LEAK TEST — cause through real constructor (item 1)
// -------------------------------------------------------------------
uses(async (fixture) => {
  const S_CAUSE = "SENTINEL_PROVIDER_CAUSE";

  const provider = {
    callCount: 0,
    async complete() {
      this.callCount++;
      // Throw through real constructor with non-enumerable cause
      throw new ProviderFailure("http_error", { httpStatus: 500, cause: S_CAUSE });
    },
  };

  const result = await runAgentLoopWithReceipt({ task: "leak", workspaceRoot: fixture.workspace, provider, maxTurns: 3 });
  const diagnostic = buildDiagnostic({ run: result, usage: result.receipt.usage, receiptPath: result.receiptPath, receiptStatus: result.receipt.status });

  const all = `${JSON.stringify(result.providerAttempts)}${JSON.stringify(result.events)}${JSON.stringify(result.receipt)}${JSON.stringify(diagnostic)}`;

  assert(!all.includes(S_CAUSE), "K: provider cause not leaked");
  assert(diagnostic.status === "failed", "K: diagnostic status failed");
  assert(diagnostic.terminalReason === "provider_error", "K: terminalReason provider_error");
  assert(diagnostic.providerAttempts.length === 1, "K: 1 attempt");
  assert(diagnostic.providerAttempts[0].outcome === "http_error", "K: outcome http_error");
  assert(diagnostic.providerAttempts[0].httpStatus === 500, "K: httpStatus 500");
});

// -------------------------------------------------------------------
// F5-F7: additional transport-seam scenarios
// -------------------------------------------------------------------

// F5: timeout via transport that never responds
uses(async (fixture) => {
  const transport = async () => new Promise(() => {});
  const provider = createOpenAICompatibleProvider({ baseUrl: "http://127.0.0.1:9", model: "test/model", apiKeyEnv: "OAF_TEST_SECRET", env: { OAF_TEST_SECRET: "x" }, transport, timeoutMs: 50 });
  const result = await runAgentLoopWithReceipt({ task: "timeout", workspaceRoot: fixture.workspace, provider, maxTurns: 3 });
  const diagnostic = buildDiagnostic({ run: result, usage: result.receipt.usage, receiptPath: result.receiptPath, receiptStatus: result.receipt.status });
  assert(diagnostic.status === "failed" && diagnostic.terminalReason === "provider_error", "F5: failed + provider_error");
  assert(diagnostic.providerAttempts.length === 1 && diagnostic.providerAttempts[0].outcome === "timeout", "F5: timeout outcome");
  assert(diagnostic.providerAttempts[0].httpStatus === null, "F5: httpStatus null");
  assert(!existsSync(join(fixture.workspace, DIAGNOSTICS_DIR)), "F5: no diag dir before write");
  const f5path = await writeDiagnostic({ workspaceRoot: fixture.workspace, diagnostic });
  const f5files = readdirSync(join(fixture.workspace, DIAGNOSTICS_DIR)).filter((n) => n.endsWith(".json"));
  assert(f5files.length === 1, "F5: exactly one diagnostic");
  const f5reread = JSON.parse(readFileSync(join(fixture.workspace, f5path), "utf8"));
  assert(f5reread.providerAttempts[0].outcome === "timeout", "F5: reread timeout");
  assert(f5reread.providerAttempts[0].httpStatus === null, "F5: reread httpStatus null");
  assert(!JSON.stringify(f5reread).includes(fixture.workspace), "F5: workspace absent");
});

// F6: oversized response (transport returns > MAX_BODY_BYTES)
uses(async (fixture) => {
  const bigBody = "x".repeat(MAX_BODY_BYTES + 1);
  const transport = async () => ({ status: 200, body: bigBody });
  const provider = createOpenAICompatibleProvider({ baseUrl: "http://127.0.0.1:9", model: "test/model", apiKeyEnv: "OAF_TEST_SECRET", env: { OAF_TEST_SECRET: "x" }, transport });
  const result = await runAgentLoopWithReceipt({ task: "oversized", workspaceRoot: fixture.workspace, provider, maxTurns: 3 });
  const diagnostic = buildDiagnostic({ run: result, usage: result.receipt.usage, receiptPath: result.receiptPath, receiptStatus: result.receipt.status });
  assert(diagnostic.status === "failed" && diagnostic.terminalReason === "provider_error", "F6: failed + provider_error");
  assert(diagnostic.providerAttempts.length === 1 && diagnostic.providerAttempts[0].outcome === "response_too_large", "F6: response_too_large outcome");
  assert(diagnostic.providerAttempts[0].httpStatus === null, "F6: httpStatus null");
  assert(!existsSync(join(fixture.workspace, DIAGNOSTICS_DIR)), "F6: no diag dir before write");
  const f6path = await writeDiagnostic({ workspaceRoot: fixture.workspace, diagnostic });
  const f6files = readdirSync(join(fixture.workspace, DIAGNOSTICS_DIR)).filter((n) => n.endsWith(".json"));
  assert(f6files.length === 1, "F6: exactly one diagnostic");
  const f6reread = JSON.parse(readFileSync(join(fixture.workspace, f6path), "utf8"));
  assert(f6reread.providerAttempts[0].outcome === "response_too_large", "F6: reread outcome");
  assert(f6reread.providerAttempts[0].httpStatus === null, "F6: reread httpStatus null");
  assert(!JSON.stringify(f6reread).includes(fixture.workspace), "F6: workspace absent");
});

// F7: arbitrary unknown thrown value (non-ProviderFailure)
uses(async (fixture) => {
  const provider = {
    async complete() { throw "SENTINEL_UNKNOWN_THROWN"; },
  };
  const result = await runAgentLoopWithReceipt({ task: "unknown", workspaceRoot: fixture.workspace, provider, maxTurns: 3 });
  const diagnostic = buildDiagnostic({ run: result, usage: result.receipt.usage, receiptPath: result.receiptPath, receiptStatus: result.receipt.status });
  assert(diagnostic.status === "failed" && diagnostic.terminalReason === "provider_error", "F7: failed + provider_error");
  assert(diagnostic.providerAttempts.length === 1 && diagnostic.providerAttempts[0].outcome === "unknown_provider_error", "F7: unknown_provider_error outcome");
  assert(diagnostic.providerAttempts[0].httpStatus === null, "F7: httpStatus null");
  const f7all = `${JSON.stringify(diagnostic)}${JSON.stringify(result.receipt)}`;
  assert(!f7all.includes("SENTINEL_UNKNOWN_THROWN"), "F7: thrown value not leaked");
  assert(!existsSync(join(fixture.workspace, DIAGNOSTICS_DIR)), "F7: no diag dir before write");
  const f7path = await writeDiagnostic({ workspaceRoot: fixture.workspace, diagnostic });
  const f7files = readdirSync(join(fixture.workspace, DIAGNOSTICS_DIR)).filter((n) => n.endsWith(".json"));
  assert(f7files.length === 1, "F7: exactly one diagnostic");
  const f7reread = JSON.parse(readFileSync(join(fixture.workspace, f7path), "utf8"));
  assert(f7reread.providerAttempts[0].outcome === "unknown_provider_error", "F7: reread outcome");
  assert(f7reread.providerAttempts[0].httpStatus === null, "F7: reread httpStatus null");
  assert(!JSON.stringify(f7reread).includes(fixture.workspace), "F7: workspace absent");
});

// -------------------------------------------------------------------
// F8-F11: malformed transport result matrix (item 2)
// -------------------------------------------------------------------

// F8: transport returns null
uses(async (fixture) => {
  const transport = async () => null;
  const provider = createOpenAICompatibleProvider({ baseUrl: "http://127.0.0.1:9", model: "test/model", apiKeyEnv: "OAF_TEST_SECRET", env: { OAF_TEST_SECRET: "x" }, transport });
  const result = await runAgentLoopWithReceipt({ task: "null-tport", workspaceRoot: fixture.workspace, provider, maxTurns: 3 });
  const diagnostic = buildDiagnostic({ run: result, usage: result.receipt.usage, receiptPath: result.receiptPath, receiptStatus: result.receipt.status });
  assert(diagnostic.providerAttempts.length === 1 && diagnostic.providerAttempts[0].outcome === "invalid_response", "F8: null transport outcome");
  assert(diagnostic.providerAttempts[0].httpStatus === null, "F8: httpStatus null");
  assert(!existsSync(join(fixture.workspace, DIAGNOSTICS_DIR)), "F8: no diag dir before write");
  const f8path = await writeDiagnostic({ workspaceRoot: fixture.workspace, diagnostic });
  const f8files = readdirSync(join(fixture.workspace, DIAGNOSTICS_DIR)).filter((n) => n.endsWith(".json"));
  assert(f8files.length === 1, "F8: exactly one diagnostic");
  const f8reread = JSON.parse(readFileSync(join(fixture.workspace, f8path), "utf8"));
  assert(f8reread.providerAttempts[0].outcome === "invalid_response", "F8: reread outcome");
  assert(f8reread.providerAttempts[0].httpStatus === null, "F8: reread httpStatus null");
  assert(!JSON.stringify(f8reread).includes(fixture.workspace), "F8: workspace absent");
});

// F9: transport returns empty object
uses(async (fixture) => {
  const transport = async () => ({});
  const provider = createOpenAICompatibleProvider({ baseUrl: "http://127.0.0.1:9", model: "test/model", apiKeyEnv: "OAF_TEST_SECRET", env: { OAF_TEST_SECRET: "x" }, transport });
  const result = await runAgentLoopWithReceipt({ task: "empty-tport", workspaceRoot: fixture.workspace, provider, maxTurns: 3 });
  const diagnostic = buildDiagnostic({ run: result, usage: result.receipt.usage, receiptPath: result.receiptPath, receiptStatus: result.receipt.status });
  assert(diagnostic.providerAttempts.length === 1 && diagnostic.providerAttempts[0].outcome === "invalid_response", "F9: empty object outcome");
  assert(diagnostic.providerAttempts[0].httpStatus === null, "F9: httpStatus null");
  assert(!existsSync(join(fixture.workspace, DIAGNOSTICS_DIR)), "F9: no diag dir before write");
  const f9path = await writeDiagnostic({ workspaceRoot: fixture.workspace, diagnostic });
  const f9files = readdirSync(join(fixture.workspace, DIAGNOSTICS_DIR)).filter((n) => n.endsWith(".json"));
  assert(f9files.length === 1, "F9: exactly one diagnostic");
  const f9reread = JSON.parse(readFileSync(join(fixture.workspace, f9path), "utf8"));
  assert(f9reread.providerAttempts[0].outcome === "invalid_response", "F9: reread outcome");
  assert(f9reread.providerAttempts[0].httpStatus === null, "F9: reread httpStatus null");
  assert(!JSON.stringify(f9reread).includes(fixture.workspace), "F9: workspace absent");
});

// F10: transport returns non-integer status
uses(async (fixture) => {
  const transport = async () => ({ status: "abc" });
  const provider = createOpenAICompatibleProvider({ baseUrl: "http://127.0.0.1:9", model: "test/model", apiKeyEnv: "OAF_TEST_SECRET", env: { OAF_TEST_SECRET: "x" }, transport });
  const result = await runAgentLoopWithReceipt({ task: "bad-status", workspaceRoot: fixture.workspace, provider, maxTurns: 3 });
  const diagnostic = buildDiagnostic({ run: result, usage: result.receipt.usage, receiptPath: result.receiptPath, receiptStatus: result.receipt.status });
  assert(diagnostic.providerAttempts.length === 1 && diagnostic.providerAttempts[0].outcome === "invalid_response", "F10: non-int status outcome");
  assert(diagnostic.providerAttempts[0].httpStatus === null, "F10: httpStatus null");
  assert(!existsSync(join(fixture.workspace, DIAGNOSTICS_DIR)), "F10: no diag dir before write");
  const f10path = await writeDiagnostic({ workspaceRoot: fixture.workspace, diagnostic });
  const f10files = readdirSync(join(fixture.workspace, DIAGNOSTICS_DIR)).filter((n) => n.endsWith(".json"));
  assert(f10files.length === 1, "F10: exactly one diagnostic");
  const f10reread = JSON.parse(readFileSync(join(fixture.workspace, f10path), "utf8"));
  assert(f10reread.providerAttempts[0].outcome === "invalid_response", "F10: reread outcome");
  assert(f10reread.providerAttempts[0].httpStatus === null, "F10: reread httpStatus null");
  assert(!JSON.stringify(f10reread).includes(fixture.workspace), "F10: workspace absent");
});

// F11: transport returns status 200 with non-string body
uses(async (fixture) => {
  const transport = async () => ({ status: 200, body: 123 });
  const provider = createOpenAICompatibleProvider({ baseUrl: "http://127.0.0.1:9", model: "test/model", apiKeyEnv: "OAF_TEST_SECRET", env: { OAF_TEST_SECRET: "x" }, transport });
  const result = await runAgentLoopWithReceipt({ task: "nonstring-body", workspaceRoot: fixture.workspace, provider, maxTurns: 3 });
  const diagnostic = buildDiagnostic({ run: result, usage: result.receipt.usage, receiptPath: result.receiptPath, receiptStatus: result.receipt.status });
  assert(diagnostic.providerAttempts.length === 1 && diagnostic.providerAttempts[0].outcome === "invalid_response", "F11: non-string body outcome");
  assert(diagnostic.providerAttempts[0].httpStatus === null, "F11: httpStatus null");
  assert(!existsSync(join(fixture.workspace, DIAGNOSTICS_DIR)), "F11: no diag dir before write");
  const f11path = await writeDiagnostic({ workspaceRoot: fixture.workspace, diagnostic });
  const f11files = readdirSync(join(fixture.workspace, DIAGNOSTICS_DIR)).filter((n) => n.endsWith(".json"));
  assert(f11files.length === 1, "F11: exactly one diagnostic");
  const f11reread = JSON.parse(readFileSync(join(fixture.workspace, f11path), "utf8"));
  assert(f11reread.providerAttempts[0].outcome === "invalid_response", "F11: reread outcome");
  assert(f11reread.providerAttempts[0].httpStatus === null, "F11: reread httpStatus null");
  assert(!JSON.stringify(f11reread).includes(fixture.workspace), "F11: workspace absent");
});

// -------------------------------------------------------------------
// H: DIAGNOSTIC-WRITE FAILURE — all exit codes with blocked diagnostics
// -------------------------------------------------------------------

// H1: success exit 0 with blocked diagnostics
uses(async (fixture) => {
  rmSync(join(fixture.workspace, "oaf", "diagnostics"), { recursive: true, force: true });
  writeFileSync(join(fixture.workspace, "oaf", "diagnostics"), "blocked");
  mkdirSync(join(fixture.workspace, "oaf", "receipts"), { recursive: true });

  const provider = createMockProvider({ script: [{ content: "ok", toolCalls: [] }] });
  const result = await runAgentLoopWithReceipt({ task: "hi", workspaceRoot: fixture.workspace, provider });
  assert(!!result.receipt, "H1: receipt written");
  const diagStat = statSync(join(fixture.workspace, DIAGNOSTICS_DIR), { throwIfNoEntry: false });
  assert(diagStat === undefined || !diagStat.isDirectory(), "H1: no diagnostic dir");
  // Build diagnostic after the fact — it would have failed during write
  const diag = buildDiagnostic({ run: result, usage: result.receipt.usage, receiptPath: result.receiptPath, receiptStatus: result.receipt.status });
  assert(diag.status === "success", "H1: status success still correct");
});

// -------------------------------------------------------------------
// A. DIAGNOSTICS DISABLED
// -------------------------------------------------------------------
uses(async (fixture) => {
  const provider = createMockProvider({ script: [{ content: "ok", toolCalls: [] }] });
  const result = await runAgentLoopWithReceipt({ task: "hi", workspaceRoot: fixture.workspace, provider });
  assert(!existsSync(join(fixture.workspace, DIAGNOSTICS_DIR)), "A: no diagnostic directory written");
  assert(!!result.receipt, "A: receipt written");
});

// -------------------------------------------------------------------
// B. SUCCESS
// -------------------------------------------------------------------
uses(async (fixture) => {
  const provider = createMockProvider({ script: [{ content: "ok", toolCalls: [] }] });
  const result = await runAgentLoopWithReceipt({ task: "hi", workspaceRoot: fixture.workspace, provider });
  const diagnostic = buildDiagnostic({ run: result, usage: result.receipt.usage, receiptPath: result.receiptPath, receiptStatus: result.receipt.status });

  const expectedKeys = ["schemaVersion", "createdAt", "runId", "provider", "requestedModel", "status", "terminalReason", "turns", "receiptPath", "providerAttempts", "tools"];
  assert(JSON.stringify(Object.keys(diagnostic).sort()) === JSON.stringify(expectedKeys.sort()), "B: exact top-level keys");
  assert(diagnostic.schemaVersion === "0.1.0", "B: schemaVersion");
  assert(diagnostic.status === "success", "B: status");
  assert(diagnostic.terminalReason === "assistant_terminal", "B: terminalReason");
  assert(diagnostic.turns === 1, "B: turns");
  assert(diagnostic.providerAttempts.length === 1, "B: 1 provider attempt");
  assert(diagnostic.providerAttempts[0].outcome === "success", "B: outcome success");
  assert(typeof diagnostic.providerAttempts[0].durationMs === "number" && diagnostic.providerAttempts[0].durationMs >= 0, "B: valid durationMs");
  const attemptKeys = Object.keys(diagnostic.providerAttempts[0]).sort();
  assert(JSON.stringify(attemptKeys) === JSON.stringify(["durationMs", "httpStatus", "outcome", "turn"]), "B: exact attempt keys");
  assert(diagnostic.tools.length === 0, "B: no tools");
  assert(diagnostic.runId === result.runId, "B: runId");
  assert(diagnostic.receiptPath === result.receiptPath, "B: receiptPath");
  assert(diagnostic.provider === null, "B: provider null when no receiptUsage");
});

// -------------------------------------------------------------------
// C. PARTIAL
// -------------------------------------------------------------------
// C1: execution_error
uses(async (fixture) => {
  const provider = createMockProvider({
    script: [
      { content: null, toolCalls: [{ id: "c1", name: "command", args: { command: "pnpm test", mode: "test" } }] },
      { content: "done with error", toolCalls: [] },
    ],
  });
  const executor = async () => { throw new Error("executor blew up"); };
  const result = await runAgentLoopWithReceipt({ task: "partial", workspaceRoot: fixture.workspace, provider, commandExecutor: executor });
  const diagnostic = buildDiagnostic({ run: result, usage: result.receipt.usage, receiptPath: result.receiptPath, receiptStatus: result.receipt.status });
  assert(diagnostic.status === "partial", "C: partial status");
  assert(diagnostic.tools.length === 1, "C: one tool");
  assert(diagnostic.tools[0].outcome === "execution_error", "C: execution_error outcome");
  assert(diagnostic.tools[0].toolName === "command", "C: toolName command");
});

// C2: rejected tool
uses(async (fixture) => {
  const provider = createMockProvider({
    script: [
      { content: null, toolCalls: [{ id: "bad", name: "nonexistent", args: {} }] },
      { content: "partial done", toolCalls: [] },
    ],
  });
  const result = await runAgentLoopWithReceipt({ task: "partial", workspaceRoot: fixture.workspace, provider });
  const diagnostic = buildDiagnostic({ run: result, usage: result.receipt.usage, receiptPath: result.receiptPath, receiptStatus: result.receipt.status });
  assert(diagnostic.status === "partial", "C: rejected partial status");
  assert(diagnostic.tools.length === 1, "C: rejected tool");
  assert(diagnostic.tools[0].outcome === "rejected", "C: rejected outcome");
  assert(diagnostic.tools[0].toolName === null, "C: rejected toolName null");
});

// -------------------------------------------------------------------
// D. MAX TURNS
// -------------------------------------------------------------------
uses(async (fixture) => {
  const provider = createMockProvider({
    script: (request, callCount) => ({ content: null, toolCalls: [{ id: `l-${callCount}`, name: "read", args: { path: "README.md" } }] }),
  });
  const result = await runAgentLoopWithReceipt({ task: "loop", workspaceRoot: fixture.workspace, provider, maxTurns: 3 });
  const diagnostic = buildDiagnostic({ run: result, usage: result.receipt.usage, receiptPath: result.receiptPath, receiptStatus: result.receipt.status });
  assert(diagnostic.status === "failed", "D: failed status");
  assert(diagnostic.terminalReason === "max_turns", "D: max_turns");
  assert(diagnostic.turns === 3, "D: 3 turns");
  assert(diagnostic.providerAttempts.length === 3, "D: 3 attempts");
  for (const attempt of diagnostic.providerAttempts) {
    assert(attempt.outcome === "success", "D: each success");
    assert(attempt.httpStatus === null, "D: each httpStatus null");
  }
});

// -------------------------------------------------------------------
// G. TOOL OUTCOMES — direct buildDiagnostic with structured events
// -------------------------------------------------------------------
{
  /** @param {import("../lib/agent/contracts.ts").RecordedAgentEvent[]} events @returns {import("../lib/agent/contracts.ts").AgentRunResult} */
  const base = (events) => ({ runId: "r", status: "success", terminalReason: "assistant_terminal", turns: 1, content: null, context: { workspaceRoot: "/tmp/workspace", docsPack: { id: "stack-0.1", oafStack: "0.1.0" }, documents: [], totalBytes: 0 }, providerAttempts: [], events, providerCalls: [] });
  /** @type {import("../lib/agent/contracts.ts").ReceiptUsage} */
  const usage = { provider: null, model: null, runMode: null, calls: null, tokensIn: null, tokensOut: null };

  // success
  const s = buildDiagnostic({ run: base(createRecordedEvents(createEvent("tool_call", { toolCallId: "t1", toolName: "read", summary: { path: "x" } }), createEvent("tool_execution_end", { toolCallId: "t1", toolName: "read", success: true }), createEvent("tool_result", { toolCallId: "t1", toolName: "read", summary: { path: "x", bytes: 10, truncated: false }, errorCode: null }))), usage, receiptPath: null, receiptStatus: "success" });
  assert(s.tools.length === 1 && s.tools[0].outcome === "success", "G: success outcome");

  // rejected
  const r = buildDiagnostic({ run: base(createRecordedEvents(createEvent("tool_call", { toolCallId: "t2", toolName: "read", summary: { path: "x" } }), createEvent("tool_result", { toolCallId: "t2", toolName: "read", summary: {}, errorCode: "rejected" }))), usage, receiptPath: null, receiptStatus: "partial" });
  assert(r.tools.length === 1 && r.tools[0].outcome === "rejected", "G: rejected outcome");

  // execution_error
  const e = buildDiagnostic({ run: base(createRecordedEvents(createEvent("tool_call", { toolCallId: "t3", toolName: "command", summary: { command: "pnpm test", redacted: false, mode: null } }), createEvent("tool_execution_end", { toolCallId: "t3", toolName: "command", success: false }), createEvent("tool_result", { toolCallId: "t3", toolName: "command", summary: {}, errorCode: "execution_error" }))), usage, receiptPath: null, receiptStatus: "partial" });
  assert(e.tools.length === 1 && e.tools[0].outcome === "execution_error", "G: execution_error outcome");

  // unknown
  const u = buildDiagnostic({ run: base(createRecordedEvents(createEvent("tool_call", { toolCallId: "t4", toolName: "read", summary: { path: "x" } }))), usage, receiptPath: null, receiptStatus: "partial" });
  assert(u.tools.length === 1 && u.tools[0].outcome === "unknown", "G: unknown outcome");

  // exact tool keys
  assert(JSON.stringify(Object.keys(s.tools[0]).sort()) === JSON.stringify(["outcome", "toolName"]), "G: exact tool keys");
}

// -------------------------------------------------------------------
// CLOSED DIAGNOSTIC WRITER — writeDiagnostic
// -------------------------------------------------------------------
uses(async (fixture) => {
  const diag = normalizeDiagnosticSchema({ schemaVersion: "0.1.0", createdAt: "2026-01-01T00:00:00.000Z", runId: "run_test", provider: null, requestedModel: null, status: "success", terminalReason: "assistant_terminal", turns: 1, receiptPath: null, providerAttempts: [], tools: [] });
  const path = await writeDiagnostic({ workspaceRoot: fixture.workspace, diagnostic: diag });
  assert(path.startsWith("oaf/diagnostics/"), "writeDiagnostic writes valid diagnostic");

  // Extra top-level key throws
  try { await Reflect.apply(writeDiagnostic, undefined, [{ workspaceRoot: fixture.workspace, diagnostic: { ...diag, extra: true } }]); assert(false, "writeDiagnostic rejects extra key"); } catch { assert(true, "writeDiagnostic rejects extra key"); }

  // Missing keys throw
  try { await Reflect.apply(writeDiagnostic, undefined, [{ workspaceRoot: fixture.workspace, diagnostic: { schemaVersion: "0.1.0" } }]); assert(false, "writeDiagnostic rejects missing keys"); } catch { assert(true, "writeDiagnostic rejects missing keys"); }

  // Wrong schemaVersion throws
  try { await Reflect.apply(writeDiagnostic, undefined, [{ workspaceRoot: fixture.workspace, diagnostic: { ...diag, schemaVersion: "0.2.0" } }]); assert(false, "writeDiagnostic rejects wrong schemaVersion"); } catch { assert(true, "writeDiagnostic rejects wrong schemaVersion"); }
});

// -------------------------------------------------------------------
// I. RECEIPT-WRITE FAILURE — ReceiptWriteError closed payload with
//    real seeded sentinels (item 2)
// -------------------------------------------------------------------
uses(async (fixture) => {
  const TASK_SENTINEL = "SENTINEL_TASK_CONTENT";
  const MODEL_OUTPUT_SENTINEL = "SENTINEL_MODEL_OUTPUT";
  const TOOL_ARGS_SENTINEL = "SENTINEL_TOOL_ARGS";
  const EXEC_ERROR_SENTINEL = "SENTINEL_EXEC_ERROR";

  const provider = createMockProvider({
    script: [
      { content: null, toolCalls: [{ id: "i1", name: "command", args: { command: TOOL_ARGS_SENTINEL, mode: "test" } }] },
      { content: MODEL_OUTPUT_SENTINEL, toolCalls: [] },
    ],
  });
  const executor = async () => {
    const err = new Error(EXEC_ERROR_SENTINEL);
    Object.defineProperty(err, "secretCause", { value: "SENTINEL_CAUSE" });
    throw err;
  };
  // Block receipt directory
  rmSync(join(fixture.workspace, "oaf", "receipts"), { recursive: true, force: true });
  writeFileSync(join(fixture.workspace, "oaf", "receipts"), "blocked");

  /** @type {unknown} */
  let thrown;
  try {
    await runAgentLoopWithReceipt({ task: `write ${TASK_SENTINEL}`, workspaceRoot: fixture.workspace, provider, commandExecutor: executor });
  } catch (error) {
    thrown = error;
  }

  assert(thrown instanceof ReceiptWriteError, "I: ReceiptWriteError thrown");
  if (!(thrown instanceof ReceiptWriteError)) throw new Error("ReceiptWriteError was not thrown");

  // Exact enumerable properties: only code and diagnostic
  const ownKeys = Object.keys(thrown).sort();
  assert(JSON.stringify(ownKeys) === JSON.stringify(["code", "diagnostic"]), "I: exactly 2 own enumerable properties (code, diagnostic)");
  assert(!ownKeys.includes("run"), "I: no run property");
  assert(!ownKeys.includes("receipt"), "I: no receipt property");
  assert(!ownKeys.includes("context"), "I: no context property");
  assert(!ownKeys.includes("events"), "I: no events property");
  assert(!ownKeys.includes("providerCalls"), "I: no providerCalls");
  assert(!ownKeys.includes("content"), "I: no content");

  // Standard Error metadata
  assert(thrown.code === "RECEIPT_WRITE_FAILED", "I: code is RECEIPT_WRITE_FAILED");
  assert(thrown.message === "receipt could not be written", "I: message fixed");
  assert(thrown.name === "ReceiptWriteError", "I: name is ReceiptWriteError");

  // Diagnostic is normalized
  assert(!!thrown.diagnostic, "I: diagnostic present");
  assert(thrown.diagnostic.receiptPath === null, "I: receiptPath null");
  assert(thrown.diagnostic.status === "partial", "I: partial status");
  assert(thrown.diagnostic.terminalReason === "assistant_terminal", "I: terminalReason");
  assert(thrown.diagnostic.schemaVersion === "0.1.0", "I: schemaVersion");
  assert(JSON.stringify(Object.keys(thrown.diagnostic).sort()) === JSON.stringify(["schemaVersion", "createdAt", "runId", "provider", "requestedModel", "status", "terminalReason", "turns", "receiptPath", "providerAttempts", "tools"].sort()), "I: exact diagnostic keys");

  // No sentinel leakage in JSON.stringify
  const serialized = JSON.stringify(thrown);
  for (const s of [TASK_SENTINEL, MODEL_OUTPUT_SENTINEL, TOOL_ARGS_SENTINEL, EXEC_ERROR_SENTINEL, "SENTINEL_CAUSE", fixture.workspace]) {
    assert(!serialized.includes(s), `I: ${s} absent from JSON.stringify(error)`);
  }

  // No sentinel leakage in util.inspect
  const { inspect } = await import("node:util");
  const inspected = inspect(thrown);
  assert(inspected.includes("ReceiptWriteError"), "I: util.inspect shows error name");
  assert(inspected.includes("receipt could not be written"), "I: util.inspect shows message");
  for (const s of [TASK_SENTINEL, MODEL_OUTPUT_SENTINEL, TOOL_ARGS_SENTINEL, EXEC_ERROR_SENTINEL, "SENTINEL_CAUSE", fixture.workspace]) {
    assert(!inspected.includes(s), `I: ${s} absent from util.inspect(error)`);
  }

  // No sentinel leakage in error.diagnostic
  const diagText = JSON.stringify(thrown.diagnostic);
  for (const s of ["SENTINEL", fixture.workspace]) {
    assert(!diagText.includes(s), `I: ${s} absent from error.diagnostic`);
  }
});

// -------------------------------------------------------------------
// J. PRIVACY SENTINELS — each source field seeded independently (item 3)
// -------------------------------------------------------------------
{
  const S_MODEL_OUTPUT = "SENTINEL_MODEL_TERMINAL_OUTPUT";
  const S_DOC_CONTENT = "SENTINEL_DOCUMENT_CONTENT";
  const S_TOOL_ARGS = "SENTINEL_TOOL_ARGUMENTS";

  // Every sentinel below is placed in data that buildDiagnostic actually reads.
  const rawRun = {
    runId: "sentinel-run-test",
    status: "success",
    terminalReason: "assistant_terminal",
    turns: 2,
    content: S_MODEL_OUTPUT,
    context: {
      docsPack: {},
      documents: [
        { source: "oaf", path: "oaf/config.json", content: S_DOC_CONTENT },
      ],
    },
    providerCalls: [{ turn: 1, provider: "openai-compatible", requestedModel: "m", reportedModel: null, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }],
    providerAttempts: [
      { turn: 1, durationMs: 5, outcome: "success", httpStatus: null },
      { turn: 2, durationMs: 3, outcome: "success", httpStatus: null },
    ],
    events: [
      // tool_call: summary.command contains tool arguments from malformed runtime input.
      { type: "tool_call", toolCallId: "tool_1_1", toolName: "command", summary: { command: S_TOOL_ARGS, redacted: false, mode: null } },
      { type: "tool_execution_start", toolCallId: "tool_1_1", toolName: "command" },
      { type: "tool_execution_end", toolCallId: "tool_1_1", toolName: "command", success: true },
      { type: "tool_result", toolCallId: "tool_1_1", toolName: "command", summary: { exitCode: 0, stdoutBytes: 999, stderrBytes: 99, truncated: false }, errorCode: null },
    ],
  };

  const diagnostic = Reflect.apply(buildDiagnostic, undefined, [{
    run: rawRun,
    usage: { provider: "openai-compatible", model: "test/model", runMode: "agent", calls: 1, tokensIn: null, tokensOut: null },
    receiptPath: "oaf/receipts/sentinel-test.json",
    receiptStatus: "success",
  }]);

  const text = JSON.stringify(diagnostic);

  // -- Sentinels seeded INTO run fields that buildDiagnostic DOES receive --
  // Model terminal output (run.content)
  assert(!text.includes(S_MODEL_OUTPUT), `J: ${S_MODEL_OUTPUT} absent from diagnostic`);

  // Context document content
  assert(!text.includes(S_DOC_CONTENT), `J: ${S_DOC_CONTENT} absent from diagnostic`);

  // Tool arguments (tool_call summary)
  assert(!text.includes(S_TOOL_ARGS), `J: ${S_TOOL_ARGS} absent from diagnostic`);

  // -- Safe metadata must still be present --
  assert(diagnostic.runId === "sentinel-run-test", "J: runId preserved");
  assert(diagnostic.provider === "openai-compatible", "J: provider preserved");
  assert(diagnostic.status === "success", "J: status preserved");
  assert(diagnostic.turns === 2, "J: turns preserved");
  assert(diagnostic.providerAttempts.length === 2, "J: providerAttempts preserved");
  assert(diagnostic.tools.length === 1, "J: 1 tool preserved");
  assert(diagnostic.tools.some((t) => t.outcome === "success"), "J: command success");
  assert(diagnostic.receiptPath === "oaf/receipts/sentinel-test.json", "J: receiptPath preserved");
}

// -------------------------------------------------------------------
// SUMMARY
// -------------------------------------------------------------------
await Promise.all(pending);
if (failures) process.exit(1);
console.log("\nAll agent diagnostics checks passed.");
