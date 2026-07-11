// Focused test for the first OAF build-receipt emitter (issue #32).
// Uses only Node built-ins; no real provider, API key, or network.
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, symlinkSync, mkdtempSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runAgentLoopWithReceipt,
  buildReceipt,
  writeReceipt,
  receiptFileName,
  RECEIPT_SCHEMA_VERSION,
   OAF_VERSION,
   validateReceiptUsage,
} from "../lib/agent/receipt.mjs";
import { createMockProvider } from "../lib/agent/provider.mjs";
import { copyGeneratedAppFixture } from "./generated-app-fixture-helper.mjs";

let failures = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`PASS  ${message}`);
  } else {
    console.log(`FAIL  ${message}`);
    failures++;
  }
}
assert(validateReceiptUsage({ provider: "openai-compatible", model: "test/model", runMode: "agent", calls: 1, tokensIn: null, tokensOut: 2 }).calls === 1, "valid receipt usage is retained");
try { validateReceiptUsage({ provider: "openai-compatible", model: "test/model", runMode: "agent", calls: 1, tokensIn: null, tokensOut: null, extra: true }); assert(false, "malformed receipt usage rejected"); } catch { assert(true, "malformed receipt usage rejected"); }
for (const invalid of [null, false, 0, "", { provider: "openai-compatible", model: "test/model", runMode: "wrong", calls: 1, tokensIn: null, tokensOut: null }, { provider: "x".repeat(65), model: "test/model", runMode: "agent", calls: 1, tokensIn: null, tokensOut: null }, { provider: "openai-compatible", model: "test/model", runMode: "agent", calls: Number.MAX_SAFE_INTEGER + 1, tokensIn: null, tokensOut: null }]) { try { validateReceiptUsage(invalid); assert(false, "invalid explicit usage rejected"); } catch { assert(true, "invalid explicit usage rejected"); } }

const fixtures = [];
const outsideDirs = [];
const symlinks = [];

function withFixture() {
  const fixture = copyGeneratedAppFixture();
  fixtures.push(fixture);
  return fixture.workspace;
}

function readReceipts(workspace) {
  const dir = join(workspace, "oaf", "receipts");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({ name, receipt: JSON.parse(readFileSync(join(dir, name), "utf8")) }));
}

try {
  // 1. A successful mock tool-call run writes exactly one parseable JSON receipt.
  {
    const workspace = withFixture();
    const provider = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: "c1", name: "read", args: { path: "README.md" } }] },
        { content: "done", toolCalls: [] },
      ],
    });
    const result = await runAgentLoopWithReceipt({ task: "read the readme", workspaceRoot: workspace, provider });

    const receipts = readReceipts(workspace);
    assert(receipts.length === 1, "exactly one receipt JSON file is written");
    assert(typeof receipts[0].receipt.id === "string" && receipts[0].receipt.schemaVersion === RECEIPT_SCHEMA_VERSION,
      "receipt is parseable JSON with id and schemaVersion");
  }

  // 2. The receipt is inside oaf/receipts/.
  {
    const workspace = withFixture();
    const provider = createMockProvider({ script: [{ content: "ok", toolCalls: [] }] });
    const result = await runAgentLoopWithReceipt({ task: "hi", workspaceRoot: workspace, provider });
    assert(result.receiptPath.startsWith("oaf/receipts/") && result.receiptPath.endsWith(".json"),
      "receipt path is under oaf/receipts/ and is .json");
    assert(readdirSync(join(workspace, "oaf", "receipts")).includes(result.receiptPath.split("/")[2]),
      "receipt file exists inside the workspace receipts dir");
  }

  // 3. Filename is safe and unique across separate runs.
  {
    const workspace = withFixture();
    const provider = createMockProvider({ script: [{ content: "ok", toolCalls: [] }] });
    const a = await runAgentLoopWithReceipt({ task: "a", workspaceRoot: workspace, provider });
    const b = await runAgentLoopWithReceipt({ task: "b", workspaceRoot: workspace, provider });
    const nameA = a.receiptPath.split("/")[2];
    const nameB = b.receiptPath.split("/")[2];
    assert(nameA !== nameB, "two runs produce distinct receipt filenames");
    for (const name of [nameA, nameB]) {
      assert(!name.includes("/") && !name.includes("..") && !name.includes("\\"), `filename is safe: ${name}`);
      assert(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[0-9a-f]+\.json$/i.test(name), `filename matches safe pattern: ${name}`);
    }
  }

  // 4. app, stack, and docs-pack metadata come from the loaded OAF context.
  {
    const workspace = withFixture();
    const provider = createMockProvider({ script: [{ content: "ok", toolCalls: [] }] });
    const result = await runAgentLoopWithReceipt({ task: "hi", workspaceRoot: workspace, provider });
    assert(result.receipt.app.name === "generated-app-fixture", "app name comes from oaf/app.json");
    assert(result.receipt.app.oafStack === "0.1.0", "stack id comes from context");
    assert(result.receipt.app.docsPack === "stack-0.1", "docs-pack id comes from context");
    assert(typeof OAF_VERSION === "string" && OAF_VERSION.length > 0, "oafVersion is resolved");
  }

  // 4b. HONESTY FIX: an unreadable/invalid oafVersion becomes null with a warning.
  {
    const receipt = buildReceipt({
      run: { runId: "r", status: "success", terminalReason: "assistant_terminal", turns: 1, content: null, context: { docsPack: {} }, events: [] },
      task: "x",
      oafVersion: null,
    });
    assert(receipt.oafVersion === null, "oafVersion is null when it cannot be read/validated");
    assert(receipt.warnings.some((w) => /oafVersion/i.test(w)), "a warning records the missing oafVersion");

    const invalid = buildReceipt({
      run: { runId: "r", status: "success", terminalReason: "assistant_terminal", turns: 1, content: null, context: { docsPack: {} }, events: [] },
      task: "x",
      oafVersion: "1.2.3garbage",
    });
    assert(invalid.oafVersion === null, "invalid explicitly supplied oafVersion is rejected");
    assert(invalid.warnings.some((w) => /oafVersion/i.test(w)), "invalid explicitly supplied oafVersion adds a warning");
  }

  // 5. original task and terminal result are present.
  {
    const workspace = withFixture();
    const provider = createMockProvider({ script: [{ content: "all good", toolCalls: [] }] });
    const result = await runAgentLoopWithReceipt({ task: "do the thing", workspaceRoot: workspace, provider });
    assert(result.receipt.task.summary === "do the thing", "original task is recorded");
    assert(result.receipt.status === "success" && result.receipt.terminalReason === "assistant_terminal",
      "terminal status/reason recorded");
    assert(result.receipt.outcome !== "all good", "outcome is not the raw model content");
    assert(typeof result.receipt.outcome === "string" && result.receipt.outcome.length > 0,
      "outcome is a deterministic summary built from run facts");
    assert(result.receipt.outcome.startsWith("Agent reached a terminal response with no recorded tool or check failures."),
      "clean terminal run uses the audited-success outcome wording");
  }

  // 5b. BLOCKER 1: raw model output is never persisted; in-memory run keeps it.
  {
    const workspace = withFixture();
    const provider = createMockProvider({ script: [{ content: "MODEL_OUTPUT_SENTINEL_XYZ", toolCalls: [] }] });
    const result = await runAgentLoopWithReceipt({ task: "do thing", workspaceRoot: workspace, provider });
    const serialized = JSON.stringify(result.receipt);
    assert(!serialized.includes("MODEL_OUTPUT_SENTINEL_XYZ"), "raw model output sentinel absent from receipt");
    assert(typeof result.content === "string" && result.content.includes("MODEL_OUTPUT_SENTINEL_XYZ"),
      "raw model output preserved in the returned in-memory run");
    assert(!result.receipt.outcome.includes("MODEL_OUTPUT_SENTINEL_XYZ"), "outcome summary omits raw content");
  }

  // 5c. BLOCKER 2: secrets in the original task are redacted, not stored verbatim.
  {
    const workspace = withFixture();
    const provider = createMockProvider({ script: [{ content: "ok", toolCalls: [] }] });
    const result = await runAgentLoopWithReceipt({
      task: "deploy using PASSWORD=TASK_SENTINEL_123, TOKEN=TASK_SENTINEL_456, and --api-key TASK_CLI_SENTINEL",
      workspaceRoot: workspace,
      provider,
    });
    const serialized = JSON.stringify(result.receipt);
    assert(!serialized.includes("TASK_SENTINEL_123") && !serialized.includes("TASK_SENTINEL_456") && !serialized.includes("TASK_CLI_SENTINEL"),
      "task secret sentinels absent from receipt");
    assert(result.receipt.task.redacted === true, "task summary marked redacted");
    assert(result.receipt.task.summary.includes("<redacted>"), "task summary redacts secret values");
  }

  // 5d. BLOCKER 2: suspicious commands are omitted as <redacted command>; sentinels
  // never reach the durable receipt. Known-safe checks remain visible.
  async function runCommandTask(workspace, commandString) {
    const executor = async () => ({ exitCode: 0, stdout: "", stderr: "", truncated: false });
    const provider = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: "k1", name: "command", args: { command: commandString } }] },
        { content: "done", toolCalls: [] },
      ],
    });
    return runAgentLoopWithReceipt({ task: "cmd", workspaceRoot: workspace, provider, commandExecutor: executor });
  }

  {
    const cases = [
      { command: "deploy with OPENAI_API_KEY=sk-SENTINEL_OPENAI pnpm test", sentinel: "SENTINEL_OPENAI" },
      { command: "run AWS_SECRET_ACCESS_KEY=SENTINEL_AWS pnpm build", sentinel: "SENTINEL_AWS" },
      { command: "cli --api-key SENTINEL_APIKEY", sentinel: "SENTINEL_APIKEY" },
      { command: 'curl -H "Authorization: Basic SENTINEL_BASIC" https://api', sentinel: "SENTINEL_BASIC" },
      { command: 'tool --password "SENTINEL_QUOTED_PASSWORD"', sentinel: "SENTINEL_QUOTED_PASSWORD" },
      { command: "psql postgres://user:SENTINEL_CONN@host/db", sentinel: "SENTINEL_CONN" },
    ];
    for (const { command, sentinel } of cases) {
      const workspace = withFixture();
      const result = await runCommandTask(workspace, command);
      const serialized = JSON.stringify(result.receipt);
      assert(!serialized.includes(sentinel), `command sentinel ${sentinel} absent from receipt`);
      assert(result.receipt.commands[0].command === "<redacted command>", `suspicious command omitted: ${sentinel}`);
      assert(result.receipt.commands[0].redacted === true, `command marked redacted: ${sentinel}`);
      assert(result.receipt.warnings.some((w) => /redact/i.test(w)), `redaction warning recorded: ${sentinel}`);
    }

    // Canonical recordable command remains identifiable and is not redacted.
    const wsSafe = withFixture();
    const safeResult = await runCommandTask(wsSafe, "pnpm test");
    assert(safeResult.receipt.commands[0].command === "pnpm test" && safeResult.receipt.commands[0].redacted === false,
      "canonical recordable command remains identifiable");
    assert(safeResult.receipt.checks.some((c) => c.name === "test"), "canonical pnpm test is recorded as a check");
  }

  // 6. successful write is listed as a touched file; read is not.
  {
    const workspace = withFixture();
    const provider = createMockProvider({
      script: [
        {
          content: null,
          toolCalls: [
            { id: "r1", name: "read", args: { path: "README.md" } },
            { id: "w1", name: "write", args: { path: "notes.txt", content: "hello" } },
          ],
        },
        { content: "done", toolCalls: [] },
      ],
    });
    const result = await runAgentLoopWithReceipt({ task: "edit", workspaceRoot: workspace, provider });
    assert(result.receipt.files.touched.includes("notes.txt"), "successful write is listed as touched");
    assert(!result.receipt.files.touched.includes("README.md"), "read is NOT listed as a touched file");
  }

  // 7. command outcome and exit code are represented honestly.
  {
    const calls = [];
    const passExecutor = async (options) => { calls.push(options); return { exitCode: 0, stdout: "", stderr: "", truncated: false }; };
    const failExecutor = async (options) => { calls.push(options); return { exitCode: 7, stdout: "", stderr: "boom", truncated: false }; };

    const wsPass = withFixture();
    const passProvider = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: "k1", name: "command", args: { command: "pnpm test" } }] },
        { content: "done", toolCalls: [] },
      ],
    });
    const passResult = await runAgentLoopWithReceipt({ task: "t", workspaceRoot: wsPass, provider: passProvider, commandExecutor: passExecutor });
    assert(passResult.receipt.commands.length === 1 && passResult.receipt.commands[0].exitCode === 0 && passResult.receipt.commands[0].status === "pass",
      "exit code 0 is recorded as pass");

    const wsFail = withFixture();
    const failProvider = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: "k2", name: "command", args: { command: "pnpm build" } }] },
        { content: "done", toolCalls: [] },
      ],
    });
    const failResult = await runAgentLoopWithReceipt({ task: "t", workspaceRoot: wsFail, provider: failProvider, commandExecutor: failExecutor });
    assert(failResult.receipt.commands[0].exitCode === 7 && failResult.receipt.commands[0].status === "fail",
      "non-zero exit code is recorded as fail (not success)");
    assert(failResult.receipt.status === "partial" && failResult.receipt.terminalReason === "assistant_terminal",
      "terminal response after a non-zero build is partial, not success");
    assert(!failResult.receipt.outcome.includes("Agent completed the task"),
      "partial build outcome does not claim task completion");
    assert(failResult.receipt.warnings.some((w) => /Partial terminal run: 0 failed\/rejected\/missing tool action\(s\).*1 command\(s\) did not pass, 1 check\(s\) did not pass/.test(w)),
      "partial warning exposes the failed command and check counts");
  }

  // 7b. A rejected tool and a missing paired result both make terminal runs partial.
  {
    const workspace = withFixture();
    const provider = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: "bad", name: "unknown_tool", args: {} }] },
        { content: "done", toolCalls: [] },
      ],
    });
    const rejected = await runAgentLoopWithReceipt({ task: "x", workspaceRoot: workspace, provider });
    assert(rejected.receipt.status === "partial" && rejected.receipt.terminalReason === "assistant_terminal",
      "terminal response after a rejected tool is partial");
    assert(rejected.receipt.outcome.startsWith("Agent reached a terminal response, but one or more tool actions or checks did not complete successfully."),
      "rejected-tool outcome uses partial wording");
    assert(rejected.receipt.warnings.some((w) => /Partial terminal run: 1 failed\/rejected\/missing tool action\(s\).*0 check\(s\) did not pass/.test(w)),
      "partial warning exposes the rejected tool count");

    const missing = buildReceipt({
      run: {
        runId: "missing-result",
        status: "success",
        terminalReason: "assistant_terminal",
        turns: 1,
        content: "ignored",
        context: { docsPack: {} },
        events: [{ type: "tool_call", toolCallId: "missing", toolName: "read", summary: { path: "README.md" }, seq: 1, ts: "2000-01-01T00:00:00.000Z" }],
      },
      task: "x",
    });
    assert(missing.status === "partial", "missing tool_result makes a terminal receipt partial");
    assert(missing.warnings.some((w) => /1 failed\/rejected\/missing tool action\(s\) \(1 missing result\(s\)\)/.test(w)),
      "partial warning counts missing tool results");
  }

  // 8. a run with no checks does not claim checks passed.
  {
    const workspace = withFixture();
    const provider = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: "w1", name: "write", args: { path: "x.txt", content: "y" } }] },
        { content: "done", toolCalls: [] },
      ],
    });
    const result = await runAgentLoopWithReceipt({ task: "write only", workspaceRoot: workspace, provider });
    assert(Array.isArray(result.receipt.checks) && result.receipt.checks.length === 0, "no checks run => empty checks array");
    assert(result.receipt.status === "success", "success run with no checks is still honest success");
  }

  // 9. usage remains explicitly unavailable rather than fabricated.
  {
    const workspace = withFixture();
    const provider = createMockProvider({ script: [{ content: "ok", toolCalls: [] }] });
    const result = await runAgentLoopWithReceipt({ task: "hi", workspaceRoot: workspace, provider });
    const usage = result.receipt.usage;
    assert(usage.model === null && usage.provider === null && usage.runMode === null && usage.calls === null &&
      usage.tokensIn === null && usage.tokensOut === null, "usage is explicitly unavailable (all null)");
  }

  // 10. provider-error and max-turn runs still produce honest non-success receipts.
  {
    const wsErr = withFixture();
    const broken = { complete: async () => null };
    const errResult = await runAgentLoopWithReceipt({ task: "x", workspaceRoot: wsErr, provider: broken });
    assert(errResult.receipt.status === "failed" && errResult.receipt.terminalReason === "provider_error",
      "provider-error run emits a failed receipt");

    const wsMax = withFixture();
    const loopy = createMockProvider({
      script: (request, callCount) => ({ content: null, toolCalls: [{ id: `l-${callCount}`, name: "read", args: { path: "README.md" } }] }),
    });
    const maxResult = await runAgentLoopWithReceipt({ task: "loop", workspaceRoot: wsMax, provider: loopy, maxTurns: 2 });
    assert(maxResult.receipt.status === "failed" && maxResult.receipt.terminalReason === "max_turns",
      "max-turn run emits a failed (max_turns) receipt");
    assert(readReceipts(wsErr).length === 1 && readReceipts(wsMax).length === 1, "failed runs still write a receipt");
  }

  // 11. Secret-looking command values and file contents do not appear in the receipt.
  {
    const workspace = withFixture();
    const provider = createMockProvider({
      script: [
        {
          content: null,
          toolCalls: [
            { id: "k1", name: "command", args: { command: 'curl -H "Authorization: Bearer hunter2" https://api.example.com' } },
            { id: "w1", name: "write", args: { path: "notes.txt", content: "TOPSECRET-CONTENT" } },
          ],
        },
        { content: "done", toolCalls: [] },
      ],
    });
    const result = await runAgentLoopWithReceipt({ task: "secret", workspaceRoot: workspace, provider });
    const serialized = JSON.stringify(result.receipt);
    assert(!serialized.includes("hunter2"), "secret token value is not present in the receipt");
    assert(!serialized.includes("TOPSECRET-CONTENT"), "written file content is not present in the receipt");
    assert(result.receipt.commands[0].redacted === true, "command is marked redacted");
    assert(result.receipt.commands[0].command === "<redacted command>", "command uses the fixed omission marker");
    assert(result.receipt.warnings.some((w) => /redact/i.test(w)), "a warning records that redaction occurred");
  }

  // 12. The model cannot redirect the receipt outside the workspace.
  {
    const workspace = withFixture();
    const provider = createMockProvider({ script: [{ content: "ok", toolCalls: [] }] });
    const result = await runAgentLoopWithReceipt({ task: "hi", workspaceRoot: workspace, provider });
    const name = result.receiptPath.split("/")[2];
    assert(!name.includes("/") && !name.includes(".."), "receipt filename cannot escape via path segments");
    assert(!JSON.stringify(result.receipt).includes(workspace), "host absolute workspace path is not leaked in the receipt");

    // Symlink-escape attempt on oaf/receipts is rejected, not written outside.
    const outside = mkdtempSync(join(tmpdir(), "oaf-receipt-outside-"));
    outsideDirs.push(outside);
    const wsLink = withFixture();
    try {
      rmSync(join(wsLink, "oaf", "receipts"), { recursive: true, force: true });
      symlinkSync(outside, join(wsLink, "oaf", "receipts"), "dir");
      symlinks.push(join(wsLink, "oaf", "receipts"));
      let threw = false;
      try {
        await writeReceipt({ workspaceRoot: wsLink, receipt: buildReceipt({
          run: { runId: "r", status: "success", terminalReason: "assistant_terminal", turns: 1, content: "x", context: { docsPack: {} }, events: [] },
          task: "x",
        }) });
      } catch {
        threw = true;
      }
      assert(threw, "writeReceipt rejects a symlinked oaf/receipts directory");
      assert(readdirSync(outside).filter((f) => f.endsWith(".json")).length === 0, "no receipt is written outside the workspace");
    } catch (error) {
      if (error.code === "EPERM" || error.code === "EACCES" || error.code === "ENOTSUP") {
        console.log(`SKIP  symlink receipt-escape test unavailable: ${error.code}`);
      } else {
        throw error;
      }
    }
  }

  // 13. receipt_emitted occurs only after a successful write, after agent_end.
  {
    const workspace = withFixture();
    const provider = createMockProvider({ script: [{ content: "ok", toolCalls: [] }] });
    const result = await runAgentLoopWithReceipt({ task: "hi", workspaceRoot: workspace, provider });
    const types = result.events.map((e) => e.type);
    const iAgentEnd = types.lastIndexOf("agent_end");
    const iReceipt = types.indexOf("receipt_emitted");
    assert(iAgentEnd > -1 && iReceipt > -1 && iAgentEnd < iReceipt, "receipt_emitted follows agent_end");
    const emitted = result.events[iReceipt];
    assert(emitted.path === result.receiptPath && emitted.receiptId === result.receipt.id,
      "receipt_emitted carries the written path and receipt id");
    assert(emitted.seq === result.events[iAgentEnd].seq + 1,
      "receipt_emitted.seq is exactly one greater than the previous event sequence");
    assert(typeof emitted.ts === "string" && !Number.isNaN(Date.parse(emitted.ts)),
      "receipt_emitted.ts is a parseable ISO timestamp");
  }

  // 14. A receipt-write failure does NOT emit receipt_emitted and writes nothing.
  {
    const workspace = withFixture();
    // Replace the receipts directory with a regular file so the write fails.
    rmSync(join(workspace, "oaf", "receipts"), { recursive: true, force: true });
    writeFileSync(join(workspace, "oaf", "receipts"), "not a directory");

    let threw = false;
    try {
      await runAgentLoopWithReceipt({ task: "hi", workspaceRoot: workspace, provider: createMockProvider({ script: [{ content: "ok", toolCalls: [] }] }) });
    } catch {
      threw = true;
    }
    assert(threw, "a failing receipt write propagates the error");
    const receiptsPath = join(workspace, "oaf", "receipts");
    assert(existsSync(receiptsPath) && !statSync(receiptsPath).isDirectory(),
      "oaf/receipts remains a non-directory; no receipt JSON was written when the write failed");
  }

  // 15. Existing agent-loop shape is preserved on the returned run.
  {
    const workspace = withFixture();
    const provider = createMockProvider({ script: [{ content: "ok", toolCalls: [] }] });
    const result = await runAgentLoopWithReceipt({ task: "hi", workspaceRoot: workspace, provider });
    assert(typeof result.runId === "string" && result.status === "success" && typeof result.turns === "number",
      "returned run preserves loop fields (runId/status/turns)");
    assert(Array.isArray(result.receipt.eventSummary.byType) === false && typeof result.receipt.eventSummary.byType === "object",
      "raw AgentEvent stream is summarized, not dumped");
  }
} finally {
  for (const fixture of fixtures) fixture.cleanup();
  for (const dir of outsideDirs) rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} receipt check(s) failed.`);
  process.exit(1);
}
console.log("\nAll agent-receipt checks passed.");
