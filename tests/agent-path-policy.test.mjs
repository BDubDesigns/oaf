import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeGrep, executeList, executeRead, executeWrite } from "../lib/agent/tool-execution.mjs";
import { AgentPathDeniedError } from "../lib/agent/path-policy.mjs";
import { runAgentSandboxCommand, SandboxError } from "../lib/sandbox.mjs";
import { copyGeneratedAppFixture } from "./generated-app-fixture-helper.mjs";

let failures = 0;
function assert(ok, message) { if (ok) console.log(`PASS  ${message}`); else { console.log(`FAIL  ${message}`); failures++; } }
async function denied(action, message) { try { await action(); assert(false, message); } catch (error) { assert(error instanceof AgentPathDeniedError && error.message === "requested project path is not available to the agent", message); } }
const fixture = copyGeneratedAppFixture();
try {
  const { workspace } = fixture;
  const deniedFiles = [".env", ".env.local", "nested/.envrc", ".npmrc", ".netrc", ".git/config", ".ssh/id_ed25519", "private.pem", "service.key", "oaf/receipts/previous.json", "node_modules/example/index.js"];
  for (const path of deniedFiles) { mkdirSync(join(workspace, path, ".."), { recursive: true }); writeFileSync(join(workspace, path), `PATH_SECRET_${path}`); }
  symlinkSync(join(workspace, ".env"), join(workspace, "safe-looking.txt"));
  for (const path of deniedFiles) await denied(() => executeRead({ workspaceRoot: workspace, path }), `read denies ${path}`);
  await denied(() => executeRead({ workspaceRoot: workspace, path: "safe-looking.txt" }), "symlink alias to env is denied");
  const root = await executeList({ workspaceRoot: workspace, path: ".", recursive: true });
  assert(root.entries.some((entry) => entry.name === "app") && !root.entries.some((entry) => [".env", ".env.local", ".git", ".ssh", "node_modules", "oaf/receipts"].includes(entry.name)), "list keeps ordinary entries and hides protected traversal");
  await denied(() => executeList({ workspaceRoot: workspace, path: ".git" }), "explicit denied list fails");
  writeFileSync(join(workspace, "app", "visible.ts"), "VISIBLE_SENTINEL");
  const grep = await executeGrep({ workspaceRoot: workspace, pattern: "SENTINEL" });
  assert(grep.matches.some((match) => match.path === "app/visible.ts") && !JSON.stringify(grep).includes("PATH_SECRET"), "grep finds ordinary source and omits protected sentinels");
  await denied(() => executeGrep({ workspaceRoot: workspace, path: ".env", pattern: "SECRET" }), "explicit denied grep root fails");
  for (const path of [".env", ".npmrc", ".git/config", "node_modules/example/index.js", "private.pem", "oaf/app.json", "oaf/receipts/spoof.json"]) await denied(() => executeWrite({ workspaceRoot: workspace, path, content: "spoof" }), `write denies ${path}`);
  assert(readFileSync(join(workspace, ".env"), "utf8").startsWith("PATH_SECRET"), "denied write leaves existing secret unchanged");
  await executeWrite({ workspaceRoot: workspace, path: "app/visible.ts", content: "ordinary write" });
  assert(readFileSync(join(workspace, "app", "visible.ts"), "utf8") === "ordinary write", "ordinary source write succeeds");
  assert(!existsSync(join(workspace, "oaf", "receipts", "spoof.json")), "model receipt spoof is never created");
  let runtimeCalls = 0;
  try { await runAgentSandboxCommand({ command: "git diff", cwd: workspace, dependencies: { detectRuntime: () => { runtimeCalls++; return "fake"; } } }); assert(false, "agent git diff is denied"); }
  catch (error) { assert(error instanceof SandboxError && error.code === "AGENT_COMMAND_DENIED" && runtimeCalls === 0, "agent git diff is denied before runtime"); }
} finally { fixture.cleanup(); }
if (failures) process.exit(1);
console.log("All agent path-policy checks passed.");
