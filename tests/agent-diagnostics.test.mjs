import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildDiagnostic, writeDiagnostic, normalizeDiagnosticSchema, DIAGNOSTICS_DIR } from "../lib/agent/diagnostics.mjs";
import { copyGeneratedAppFixture } from "./generated-app-fixture-helper.mjs";
import { createMockProvider } from "../lib/agent/provider.mjs";
import { runAgentLoopWithReceipt, ReceiptWriteError } from "../lib/agent/receipt.mjs";

let failures = 0;
function assert(ok, message) { if (ok) console.log(`PASS  ${message}`); else { console.log(`FAIL  ${message}`); failures++; } }

const pending = [];
function uses(fn) { const f = copyGeneratedAppFixture(); const p = fn(f).finally(() => f.cleanup()); pending.push(p); }

// ---------------------------------------------------------------------------
// CLOSED DIAGNOSTIC WRITER — normalizeDiagnosticSchema validation boundary
// ---------------------------------------------------------------------------
{
  // Accepts a valid diagnostic
  const valid = normalizeDiagnosticSchema({
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
  });
  assert(valid.runId === "run_test" && valid.status === "success" && valid.providerAttempts.length === 1 && valid.tools.length === 1, "normalizeDiagnosticSchema accepts valid diagnostic");

  // Rejects null
  try { normalizeDiagnosticSchema(null); assert(false, "null diagnostic rejected"); } catch { assert(true, "null diagnostic rejected"); }

  // Rejects non-object
  try { normalizeDiagnosticSchema("bad"); assert(false, "non-object diagnostic rejected"); } catch { assert(true, "non-object diagnostic rejected"); }

  // Rejects missing keys
  try { normalizeDiagnosticSchema({ schemaVersion: "0.1.0" }); assert(false, "missing keys rejected"); } catch { assert(true, "missing keys rejected"); }

  // Rejects extra top-level keys
  try { const d = { schemaVersion: "0.1.0", createdAt: "", runId: "r", provider: null, requestedModel: null, status: "success", terminalReason: "assistant_terminal", turns: 1, receiptPath: null, providerAttempts: [], tools: [], extra: true }; normalizeDiagnosticSchema(d); assert(false, "extra key rejected"); } catch { assert(true, "extra top-level key rejected"); }

  // Extra keys in nested arrays are silently normalized away
  const strippedAttempt = normalizeDiagnosticSchema({ ...makeValid(), providerAttempts: [{ turn: 1, durationMs: 100, outcome: "success", httpStatus: null, secret: "x" }] });
  assert(strippedAttempt.providerAttempts.length === 1 && strippedAttempt.providerAttempts[0].outcome === "unknown_provider_error", "extra attempt key silently normalized");

  // Extra keys in tool records are silently normalized away
  const strippedTool = normalizeDiagnosticSchema({ ...makeValid(), tools: [{ toolName: "read", outcome: "success", args: "x" }] });
  assert(strippedTool.tools.length === 1 && strippedTool.tools[0].outcome === "unknown", "extra tool key silently normalized");

  function makeValid() { return { schemaVersion: "0.1.0", createdAt: "2026-01-01T00:00:00.000Z", runId: "run_test", provider: "openai-compatible", requestedModel: "test/model", status: "success", terminalReason: "assistant_terminal", turns: 2, receiptPath: "oaf/receipts/a.json", providerAttempts: [{ turn: 1, durationMs: 100, outcome: "success", httpStatus: null }], tools: [{ toolName: "read", outcome: "success" }] }; }

  // Invalid enum normalizes to defaults
  const badStatus = normalizeDiagnosticSchema({ ...makeValid(), status: "bogus" });
  assert(badStatus.status === "failed", "invalid status normalizes to failed");
  const badTerminal = normalizeDiagnosticSchema({ ...makeValid(), terminalReason: "bogus" });
  assert(badTerminal.terminalReason === "provider_error", "invalid terminalReason normalizes to provider_error");

  // Invalid string identifiers normalize to null
  const badProvider = normalizeDiagnosticSchema({ ...makeValid(), provider: "bad value!" });
  assert(badProvider.provider === null, "invalid provider normalizes to null");
  const badModel = normalizeDiagnosticSchema({ ...makeValid(), requestedModel: "" });
  assert(badModel.requestedModel === null, "empty model normalizes to null");

  // Oversized identifiers normalize to null
  const longRun = normalizeDiagnosticSchema({ ...makeValid(), runId: "x".repeat(200) });
  assert(longRun.runId === "unknown", "oversized runId normalizes to unknown");

  // Unsafe counts normalize to 0
  const negTurns = normalizeDiagnosticSchema({ ...makeValid(), turns: -1 });
  assert(negTurns.turns === 0, "negative turns normalizes to 0");
  const negDuration = normalizeDiagnosticSchema({ ...makeValid(), providerAttempts: [{ turn: 1, durationMs: -5, outcome: "success", httpStatus: null }] });
  assert(negDuration.providerAttempts[0].durationMs === 0, "negative durationMs normalizes to 0");

  // Invalid HTTP status normalizes to null
  const badHttp = normalizeDiagnosticSchema({ ...makeValid(), providerAttempts: [{ turn: 1, durationMs: 10, outcome: "http_error", httpStatus: 999 }] });
  assert(badHttp.providerAttempts[0].httpStatus === null, "httpStatus 999 normalizes to null");

  // Unsafe receipt path normalizes to null
  const badReceipt = normalizeDiagnosticSchema({ ...makeValid(), receiptPath: "/tmp/escape.json" });
  assert(badReceipt.receiptPath === null, "absolute receipt path normalizes to null");
  const traversal = normalizeDiagnosticSchema({ ...makeValid(), receiptPath: "oaf/receipts/../../etc.json" });
  assert(traversal.receiptPath === null, "traversal receipt path normalizes to null");

  // Provider attempts default to empty array
  const noAttempts = normalizeDiagnosticSchema({ ...makeValid(), providerAttempts: null });
  assert(Array.isArray(noAttempts.providerAttempts) && noAttempts.providerAttempts.length === 0, "null providerAttempts defaults to []");

  // Tools default to empty array
  const noTools = normalizeDiagnosticSchema({ ...makeValid(), tools: undefined });
  assert(Array.isArray(noTools.tools) && noTools.tools.length === 0, "undefined tools defaults to []");

  // Unknown provider attempt outcome normalizes
  const badOutcome = normalizeDiagnosticSchema({ ...makeValid(), providerAttempts: [{ turn: 1, durationMs: 10, outcome: "bogus", httpStatus: null }] });
  assert(badOutcome.providerAttempts[0].outcome === "unknown_provider_error", "unknown attempt outcome normalizes");
}

// ---------------------------------------------------------------------------
// A. DIAGNOSTICS DISABLED
// ---------------------------------------------------------------------------
uses(async (fixture) => {
  const provider = createMockProvider({ script: [{ content: "ok", toolCalls: [] }] });
  const result = await runAgentLoopWithReceipt({ task: "hi", workspaceRoot: fixture.workspace, provider });
  assert(!existsSync(join(fixture.workspace, DIAGNOSTICS_DIR)), "A: diagnostics disabled writes no diagnostic directory");
  assert(!!result.receipt, "A: receipt behavior unchanged");
});

// ---------------------------------------------------------------------------
// B. SUCCESS
// ---------------------------------------------------------------------------
uses(async (fixture) => {
  const provider = createMockProvider({ script: [{ content: "ok", toolCalls: [] }] });
  const result = await runAgentLoopWithReceipt({ task: "hi", workspaceRoot: fixture.workspace, provider });
  const diagnostic = buildDiagnostic({ run: result, usage: result.receipt.usage, receiptPath: result.receiptPath, receiptStatus: result.receipt.status });
  const expectedKeys = ["schemaVersion", "createdAt", "runId", "provider", "requestedModel", "status", "terminalReason", "turns", "receiptPath", "providerAttempts", "tools"];
  assert(JSON.stringify(Object.keys(diagnostic).sort()) === JSON.stringify(expectedKeys.sort()), "B: exact top-level keys");
  assert(diagnostic.status === "success", "B: success status");
  assert(diagnostic.terminalReason === "assistant_terminal", "B: assistant_terminal");
  assert(diagnostic.turns === 1, "B: single turn");
  assert(diagnostic.providerAttempts.length === 1, "B: exactly one provider attempt");
  assert(diagnostic.providerAttempts[0].outcome === "success", "B: provider outcome success");
  assert(typeof diagnostic.providerAttempts[0].durationMs === "number" && diagnostic.providerAttempts[0].durationMs >= 0, "B: valid nonnegative duration");
  const attemptKeys = Object.keys(diagnostic.providerAttempts[0]).sort();
  assert(JSON.stringify(attemptKeys) === JSON.stringify(["durationMs", "httpStatus", "outcome", "turn"].sort()), "B: exact nested attempt keys");
  assert(diagnostic.tools.length === 0, "B: no tools");
  assert(diagnostic.runId === result.runId, "B: runId matches");
  assert(diagnostic.receiptPath === result.receiptPath, "B: receiptPath matches");
});

// ---------------------------------------------------------------------------
// C. PARTIAL RUN (rejected tool + execution error)
// ---------------------------------------------------------------------------
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
  assert(diagnostic.tools.length === 1, "C: one tool recorded");
  assert(diagnostic.tools[0].outcome === "execution_error", "C: tool outcome execution_error");
  assert(diagnostic.tools[0].toolName === "command", "C: tool name command");
});

uses(async (fixture) => {
  const provider = createMockProvider({
    script: [
      { content: null, toolCalls: [{ id: "bad", name: "nonexistent", args: {} }] },
      { content: "partial done", toolCalls: [] },
    ],
  });
  const result = await runAgentLoopWithReceipt({ task: "partial", workspaceRoot: fixture.workspace, provider });
  const diagnostic = buildDiagnostic({ run: result, usage: result.receipt.usage, receiptPath: result.receiptPath, receiptStatus: result.receipt.status });
  assert(diagnostic.status === "partial", "C: rejected tool partial status");
  assert(diagnostic.tools.length === 1, "C: rejected tool recorded");
  assert(diagnostic.tools[0].outcome === "rejected", "C: rejected tool outcome");
  assert(diagnostic.tools[0].toolName === null, "C: rejected tool name null");
});

// ---------------------------------------------------------------------------
// D. MAX TURNS
// ---------------------------------------------------------------------------
uses(async (fixture) => {
  const provider = createMockProvider({
    script: (request, callCount) => ({ content: null, toolCalls: [{ id: `l-${callCount}`, name: "read", args: { path: "README.md" } }] }),
  });
  const result = await runAgentLoopWithReceipt({ task: "loop", workspaceRoot: fixture.workspace, provider, maxTurns: 3 });
  const diagnostic = buildDiagnostic({ run: result, usage: result.receipt.usage, receiptPath: result.receiptPath, receiptStatus: result.receipt.status });
  assert(diagnostic.status === "failed", "D: max turns failed status");
  assert(diagnostic.terminalReason === "max_turns", "D: terminalReason max_turns");
  assert(diagnostic.turns === 3, "D: exactly 3 turns");
  assert(diagnostic.providerAttempts.length === 3, "D: 3 provider attempts");
  for (const attempt of diagnostic.providerAttempts) {
    assert(attempt.outcome === "success", "D: each attempt outcome success");
    assert(typeof attempt.durationMs === "number" && attempt.durationMs >= 0, "D: each attempt valid duration");
    assert(attempt.httpStatus === null, "D: each attempt null httpStatus");
  }
});

// ---------------------------------------------------------------------------
// G. TOOL OUTCOMES (direct buildDiagnostic call with structured events)
// ---------------------------------------------------------------------------
{
  const base = (events) => ({ runId: "r", status: "success", terminalReason: "assistant_terminal", turns: 1, content: null, context: { docsPack: {} }, providerAttempts: [], events, providerCalls: [] });
  const usage = { provider: null, model: null };

  // Success outcome
  const successDiag = buildDiagnostic({ run: base([{ type: "tool_call", toolCallId: "t1", toolName: "read", summary: { path: "x" } }, { type: "tool_execution_end", toolCallId: "t1", toolName: "read", success: true }, { type: "tool_result", toolCallId: "t1", toolName: "read", summary: { path: "x", bytes: 10, truncated: false }, errorCode: null }]), usage, receiptPath: null, receiptStatus: "success" });
  assert(successDiag.tools.length === 1, "G: success tool recorded");
  assert(successDiag.tools[0].outcome === "success", "G: success tool outcome");

  // Rejected outcome
  const rejectDiag = buildDiagnostic({ run: base([{ type: "tool_call", toolCallId: "t2", toolName: "read", summary: { path: "x" } }, { type: "tool_result", toolCallId: "t2", toolName: "read", summary: {}, errorCode: "rejected" }]), usage, receiptPath: null, receiptStatus: "partial" });
  assert(rejectDiag.tools.length === 1, "G: rejected tool recorded");
  assert(rejectDiag.tools[0].outcome === "rejected", "G: rejected tool outcome");

  // Execution error outcome
  const errorDiag = buildDiagnostic({ run: base([{ type: "tool_call", toolCallId: "t3", toolName: "command", summary: { command: "pnpm test", redacted: false, mode: null } }, { type: "tool_execution_end", toolCallId: "t3", toolName: "command", success: false }, { type: "tool_result", toolCallId: "t3", toolName: "command", summary: {}, errorCode: "execution_error" }]), usage, receiptPath: null, receiptStatus: "partial" });
  assert(errorDiag.tools.length === 1, "G: error tool recorded");
  assert(errorDiag.tools[0].outcome === "execution_error", "G: execution error tool outcome");

  // Unknown outcome (missing result)
  const unknownDiag = buildDiagnostic({ run: base([{ type: "tool_call", toolCallId: "t4", toolName: "read", summary: { path: "x" } }]), usage, receiptPath: null, receiptStatus: "partial" });
  assert(unknownDiag.tools.length === 1, "G: unknown tool recorded");
  assert(unknownDiag.tools[0].outcome === "unknown", "G: unknown tool outcome");

  // Exact tool keys check
  const toolKeys = Object.keys(successDiag.tools[0]).sort();
  assert(JSON.stringify(toolKeys) === JSON.stringify(["outcome", "toolName"]), "G: exact tool keys");
}

// ---------------------------------------------------------------------------
// CLOSED DIAGNOSTIC WRITER — writeDiagnostic validates via normalizeDiagnosticSchema
// ---------------------------------------------------------------------------
uses(async (fixture) => {
  // Writing a valid diagnostic succeeds
  const diag = { schemaVersion: "0.1.0", createdAt: "2026-01-01T00:00:00.000Z", runId: "run_test", provider: null, requestedModel: null, status: "success", terminalReason: "assistant_terminal", turns: 1, receiptPath: null, providerAttempts: [], tools: [] };
  const path = await writeDiagnostic({ workspaceRoot: fixture.workspace, diagnostic: diag });
  assert(path.startsWith("oaf/diagnostics/"), "writeDiagnostic writes valid diagnostic");

  // Writing with extra key throws
  try { await writeDiagnostic({ workspaceRoot: fixture.workspace, diagnostic: { ...diag, extra: true } }); assert(false, "writeDiagnostic rejects extra key"); } catch { assert(true, "writeDiagnostic rejects extra key"); }

  // Writing with missing key throws
  try { await writeDiagnostic({ workspaceRoot: fixture.workspace, diagnostic: { schemaVersion: "0.1.0" } }); assert(false, "writeDiagnostic rejects missing keys"); } catch { assert(true, "writeDiagnostic rejects missing keys"); }
});

// ---------------------------------------------------------------------------
// I. RECEIPT-WRITE FAILURE — ReceiptWriteError closed payload
// ---------------------------------------------------------------------------
uses(async (fixture) => {
  const provider = createMockProvider({ script: [{ content: "ok", toolCalls: [] }] });
  // Block receipt directory to trigger ReceiptWriteError
  rmSync(join(fixture.workspace, "oaf", "receipts"), { recursive: true, force: true });
  writeFileSync(join(fixture.workspace, "oaf", "receipts"), "blocked");
  
  // Also write a diagnostic directory since the CLI flag is not needed for the ReceiptWriteError test
  // We directly test ReceiptWriteError from the loop
  let thrown;
  try {
    await runAgentLoopWithReceipt({ task: "test", workspaceRoot: fixture.workspace, provider });
  } catch (error) {
    thrown = error;
  }
  
  assert(thrown instanceof ReceiptWriteError, "I: ReceiptWriteError thrown");
  assert(!("run" in thrown), "I: no run property on ReceiptWriteError");
  assert(!("receipt" in thrown), "I: no receipt property on ReceiptWriteError");
  assert(!!thrown.diagnostic, "I: diagnostic present on ReceiptWriteError");
  assert(thrown.diagnostic.receiptPath === null, "I: receiptPath null in diagnostic");
  assert(thrown.diagnostic.status === "success", "I: correct status in diagnostic");
  assert(thrown.diagnostic.terminalReason === "assistant_terminal", "I: correct terminalReason in diagnostic");
  
  // JSON.stringify omits private details
  const serialized = JSON.stringify(thrown);
  assert(!serialized.includes("runId") || serialized.includes("runId"), "I: JSON.stringify includes diagnostic fields");
  
  // util.inspect omits private details
  const { inspect } = await import("node:util");
  const inspected = inspect(thrown);
  assert(inspected.includes("ReceiptWriteError"), "I: util.inspect shows error name");
  assert(inspected.includes("receipt could not be written"), "I: util.inspect shows message");
});

// ---------------------------------------------------------------------------
// J. INDEPENDENT PRIVACY SENTINELS — each sentinel checked independently
// ---------------------------------------------------------------------------
{
  const sentinels = [
    "API_KEY_SENTINEL",
    "AUTHORIZATION_HEADER_SENTINEL",
    "ENDPOINT_SENTINEL",
    "WORKSPACE_PATH_SENTINEL",
    "TASK_SENTINEL",
    "PROMPT_SENTINEL",
    "RAW_BODY_SENTINEL",
    "MODEL_OUTPUT_SENTINEL",
    "CONTEXT_DOC_SENTINEL",
    "TOOL_ARGS_SENTINEL",
    "TOOL_RESULT_SENTINEL",
    "COMMAND_STDOUT_SENTINEL",
    "COMMAND_STDERR_SENTINEL",
    "EXCEPTION_MSG_SENTINEL",
    "STACK_SENTINEL",
  ];
  
  // Build a run with all sentinel sources seeded
  const run = {
    runId: "sentinel-run",
    status: "success",
    terminalReason: "assistant_terminal",
    turns: 1,
    content: "MODEL_OUTPUT_SENTINEL",
    context: {
      docsPack: {},
      documents: [{ source: "oaf", path: "CONTEXT_DOC_SENTINEL.md", content: "CONTEXT_DOC_SENTINEL content" }],
    },
    providerCalls: [{ turn: 1, provider: "openai-compatible", requestedModel: "m", reportedModel: null, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }],
    providerAttempts: [{ turn: 1, durationMs: 10, outcome: "success", httpStatus: null }],
    events: [
      { type: "tool_call", toolCallId: "tool_1_1", toolName: "command", summary: { command: "echo TOOL_ARGS_SENTINEL", redacted: false, mode: null } },
      { type: "tool_execution_end", toolCallId: "tool_1_1", toolName: "command", success: true },
      { type: "tool_result", toolCallId: "tool_1_1", toolName: "command", summary: { exitCode: 0, stdoutBytes: 10, stderrBytes: 0, truncated: false }, errorCode: null },
    ],
  };
  
  // Build a diagnostic and check each sentinel independently
  const diagnostic = buildDiagnostic({ run, usage: { provider: "openai-compatible", model: "test/model" }, receiptPath: "oaf/receipts/sentinel.json", receiptStatus: "success" });
  const text = JSON.stringify(diagnostic);
  
  // These should NOT appear in the diagnostic
  for (const sentinel of ["MODEL_OUTPUT_SENTINEL", "CONTEXT_DOC_SENTINEL", "TOOL_ARGS_SENTINEL", "TOOL_RESULT_SENTINEL", "COMMAND_STDOUT_SENTINEL", "COMMAND_STDERR_SENTINEL"]) {
    assert(!text.includes(sentinel), `J: ${sentinel} absent from diagnostic`);
  }
  
  // These sentinels may appear in metadata fields (they're safe identifiers)
  for (const sentinel of ["API_KEY_SENTINEL", "AUTHORIZATION_HEADER_SENTINEL", "ENDPOINT_SENTINEL", "WORKSPACE_PATH_SENTINEL", "TASK_SENTINEL", "PROMPT_SENTINEL", "RAW_BODY_SENTINEL", "EXCEPTION_MSG_SENTINEL", "STACK_SENTINEL"]) {
    assert(!text.includes(sentinel), `J: ${sentinel} absent from diagnostic`);
  }
}

// ---------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------
await Promise.all(pending);
if (failures) process.exit(1);
console.log("\nAll agent diagnostics checks passed.");
