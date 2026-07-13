import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeGrep, executeList, executeRead, executeWrite } from "../lib/agent/tool-execution.mjs";
import { AgentPathDeniedError, AGENT_PATH_DENIED_MESSAGE } from "../lib/agent/path-policy.mjs";
import { runAgentLoop } from "../lib/agent/loop.ts";
import { runAgentSandboxCommand, SandboxError } from "../lib/sandbox.mjs";
import { writeReceipt } from "../lib/agent/receipt.mjs";
import { copyGeneratedAppFixture } from "./generated-app-fixture-helper.mjs";

let failures = 0;
function assert(ok, message) { if (ok) console.log(`PASS  ${message}`); else { console.log(`FAIL  ${message}`); failures++; } }
async function denied(action, message, sentinel) {
  try { await action(); assert(false, message); }
  catch (error) {
    assert(error instanceof AgentPathDeniedError, `${message}: is AgentPathDeniedError`);
    assert(error.message === AGENT_PATH_DENIED_MESSAGE, `${message}: exact bounded message`);
    if (sentinel !== undefined) assert(!error.message.includes(sentinel), `${message}: message has no sentinel`);
  }
}
function noTempSiblings(workspace, directory) {
  const entries = readdirSync(join(workspace, directory)).filter((name) => name.startsWith("."));
  return entries.filter((name) => name.endsWith(".tmp") || name.includes(".oaf-")).length === 0;
}

const ABS_SENTINEL = "/ABS_SENTINEL_PATH_POLICY_57";
const fixture = copyGeneratedAppFixture();
try {
  const { workspace } = fixture;

  // Setup: create real denied files and one symlink alias.
  const deniedFiles = [".env", ".env.local", "nested/.envrc", ".npmrc", ".netrc", ".git/config", ".ssh/id_ed25519", "private.pem", "service.key", "oaf/receipts/previous.json", "node_modules/example/index.js"];
  for (const path of deniedFiles) { mkdirSync(join(workspace, path, ".."), { recursive: true }); writeFileSync(join(workspace, path), `PATH_SECRET_${path}`); }
  symlinkSync(join(workspace, ".env"), join(workspace, "safe-looking.txt"));
  writeFileSync(join(workspace, "app", "visible.ts"), "VISIBLE_SENTINEL");

  // BLOCKER 1: Requested-path policy is applied before filesystem access.
  // Missing protected paths must be denied with the stable bounded error,
  // not a raw ENOENT or host absolute path.
  const missingProtectedPaths = [".env.missing", "nested/.env-does-not-exist", ".git/missing", "oaf/receipts/missing.json", "node_modules/missing/index.js"];
  for (const path of missingProtectedPaths) {
    await denied(() => executeRead({ workspaceRoot: workspace, path }), `read denies missing ${path}`, workspace);
    await denied(() => executeGrep({ workspaceRoot: workspace, path, pattern: "X" }), `grep denies missing ${path}`, workspace);
  }
  // List of a missing protected path is also denied.
  await denied(() => executeList({ workspaceRoot: workspace, path: ".git/missing" }), "list denies missing .git/missing", workspace);

  // Existing protected reads.
  for (const path of deniedFiles) await denied(() => executeRead({ workspaceRoot: workspace, path }), `read denies ${path}`, workspace);
  await denied(() => executeRead({ workspaceRoot: workspace, path: "safe-looking.txt" }), "symlink alias to env is denied", workspace);

  // List: explicit denied path fails; ordinary entries visible; protected entries hidden.
  await denied(() => executeList({ workspaceRoot: workspace, path: ".git" }), "explicit denied list fails", workspace);
  const root = await executeList({ workspaceRoot: workspace, path: ".", recursive: true });
  assert(root.entries.some((entry) => entry.name === "app"), "ordinary directory is visible");
  for (const hidden of [".env", ".env.local", ".git", ".ssh", "node_modules", ".npmrc", ".netrc"]) {
    assert(!root.entries.some((entry) => entry.name === hidden), `${hidden} is hidden from traversal`);
  }
  assert(!JSON.stringify(root.entries).includes("PATH_SECRET"), "list traversal has no secret content");

  // Grep: finds ordinary source, skips protected files.
  const grep = await executeGrep({ workspaceRoot: workspace, pattern: "SENTINEL" });
  assert(grep.matches.some((match) => match.path === "app/visible.ts"), "grep finds ordinary source");
  assert(!JSON.stringify(grep).includes("PATH_SECRET"), "grep never reads protected file contents");
  await denied(() => executeGrep({ workspaceRoot: workspace, path: ".env", pattern: "SECRET" }), "explicit denied grep root fails", workspace);

  // BLOCKER 2: Symlinked parent write bypass.
  // safe-dir -> oaf; write safe-dir/app.json must be denied.
  symlinkSync(join(workspace, "oaf"), join(workspace, "safe-dir"));
  await denied(() => executeWrite({ workspaceRoot: workspace, path: "safe-dir/app.json", content: "spoof" }), "write denies symlink parent -> oaf", workspace);
  assert(readFileSync(join(workspace, "oaf", "app.json"), "utf8") !== "spoof", "oaf/app.json unchanged by symlink parent write");
  assert(noTempSiblings(workspace, "."), "no temp sibling after symlink parent rejection");

  // Symlink parents to oaf/receipts, .git, node_modules.
  symlinkSync(join(workspace, "oaf", "receipts"), join(workspace, "safe-receipts"));
  await denied(() => executeWrite({ workspaceRoot: workspace, path: "safe-receipts/spoof.json", content: "spoof" }), "write denies symlink parent -> oaf/receipts", workspace);
  symlinkSync(join(workspace, ".git"), join(workspace, "safe-git"));
  await denied(() => executeWrite({ workspaceRoot: workspace, path: "safe-git/config", content: "spoof" }), "write denies symlink parent -> .git", workspace);
  symlinkSync(join(workspace, "node_modules"), join(workspace, "safe-nm"));
  await denied(() => executeWrite({ workspaceRoot: workspace, path: "safe-nm/example/index.js", content: "spoof" }), "write denies symlink parent -> node_modules", workspace);

  // Write denials for protected direct paths.
  for (const path of [".env", ".npmrc", ".git/config", "node_modules/example/index.js", "private.pem", "oaf/app.json", "oaf/receipts/spoof.json"]) {
    await denied(() => executeWrite({ workspaceRoot: workspace, path, content: "spoof" }), `write denies ${path}`, workspace);
  }
  assert(readFileSync(join(workspace, ".env"), "utf8").startsWith("PATH_SECRET"), "denied write leaves existing secret unchanged");

  // Ordinary nested source write still succeeds.
  await executeWrite({ workspaceRoot: workspace, path: "app/visible.ts", content: "ordinary write" });
  assert(readFileSync(join(workspace, "app", "visible.ts"), "utf8") === "ordinary write", "ordinary source write succeeds");
  assert(!existsSync(join(workspace, "oaf", "receipts", "spoof.json")), "model receipt spoof is never created");

  // Error privacy: no host absolute path in errors.
  for (const path of [".env", "safe-looking.txt", ".env.missing", ".npmrc", "safe-dir/app.json"]) {
    try { await executeRead({ workspaceRoot: workspace, path }); }
    catch (error) {
      if (error instanceof AgentPathDeniedError) {
        assert(!error.message.includes(workspace), `error for ${path} contains no workspaceRoot`);
      }
    }
    try { await executeWrite({ workspaceRoot: workspace, path, content: "x" }); }
    catch (error) {
      if (error instanceof AgentPathDeniedError) {
        assert(!error.message.includes(workspace), `write error for ${path} contains no workspaceRoot`);
      }
    }
  }

  // Agent-loop round trip: provider requests protected missing path.
  const sentinelSecret = "LOOP_SENTINEL_SECRET_57";
  let turnCount = 0;
  const provider = {
    complete: async () => {
      if (turnCount++ === 0) return { content: null, toolCalls: [{ id: "tc1", name: "read", args: { path: ".env.missing" } }] };
      return { content: "done", toolCalls: [] };
    },
  };
  const run = await runAgentLoop({ task: "read env", workspaceRoot: workspace, oafRoot: process.cwd(), provider });
  const toolError = run.events.find((event) => event.type === "tool_result" && event.errorCode === "execution_error");
  assert(toolError !== undefined, "tool_result records execution_error code");
  assert(!JSON.stringify(run.events).includes(workspace), "events contain no workspaceRoot absolute path");
  assert(!JSON.stringify(run.events).includes(sentinelSecret), "events contain no secret sentinel");

  // Receipt regression: model write cannot spoof, real receipt still works.
  const receiptDir = join(workspace, "oaf", "receipts");
  const receiptBefore = readdirSync(receiptDir);
  try { await executeWrite({ workspaceRoot: workspace, path: "oaf/receipts/spoof.json", content: "{}" }); }
  catch (error) { assert(error instanceof AgentPathDeniedError, "model cannot spoof receipt"); }
  assert(!existsSync(join(workspace, "oaf", "receipts", "spoof.json")), "spoof receipt never created");
  await writeReceipt({ workspaceRoot: workspace, receipt: { id: "rcpt_test", schemaVersion: "0.1.0", app: "test", oafStack: "0.1.0", docsPack: "stack-0.1", oafVersion: "0.0.0", createdAt: new Date().toISOString(), task: { original: "test", summary: "test", redacted: false }, status: "success", outcome: "test", turns: 1, checks: [], commands: [], touched: [], warnings: [] } });
  const receiptAfter = readdirSync(receiptDir).filter((name) => !receiptBefore.includes(name));
  assert(receiptAfter.length === 1, "exactly one real receipt created");
  assert(receiptAfter[0].endsWith(".json"), "receipt is JSON file");

  // Agent git diff denied before runtime.
  let runtimeCalls = 0;
  try { await runAgentSandboxCommand({ command: "git diff", cwd: workspace, dependencies: { detectRuntime: () => { runtimeCalls++; return "fake"; } } }); assert(false, "agent git diff is denied"); }
  catch (error) { assert(error instanceof SandboxError && error.code === "AGENT_COMMAND_DENIED" && runtimeCalls === 0, "agent git diff is denied before runtime"); }
} finally { fixture.cleanup(); }
if (failures) process.exit(1);
console.log("All agent path-policy checks passed.");
