// Focused test for Alpha 1's sandbox-routed command tool.
// Uses only Node built-ins; no third-party dependencies or container runtime.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCommandExecutor, executeCommand } from "../lib/agent/tool-execution.ts";
import { SandboxError } from "../lib/sandbox.ts";
import type { AgentSandboxCommandOptions, SandboxExecutionResult } from "../lib/agent/contracts.ts";

let failures = 0;
function assert(condition: unknown, message: string): void {
  if (condition) {
    console.log(`PASS  ${message}`);
  } else {
    console.log(`FAIL  ${message}`);
    failures++;
  }
}

function foreignMessage(value: unknown): string {
  const message = value !== null && (typeof value === "object" || typeof value === "function") ? Reflect.get(value, "message") : undefined;
  return typeof message === "string" ? message : "";
}

async function rejects(action: () => Promise<unknown>, predicate: (error: unknown) => boolean, message: string): Promise<void> {
  try {
    await action();
    assert(false, message);
  } catch (error) {
    assert(predicate(error), message);
  }
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = mkdtempSync(join(tmpdir(), "oaf-agent-command-tool-"));

try {
  const calls: { command: string; network: boolean; runtime: string; cwd: string }[] = [];
  const fakeSandbox = async (options: AgentSandboxCommandOptions = {}): Promise<SandboxExecutionResult> => {
    const record = {
      command: "command" in options && typeof options.command === "string" ? options.command : "",
      network: false,
      runtime: "test",
      cwd: workspace,
    };
    calls.push(record);
    if (record.command === "pnpm build") {
      return { exitCode: 17, stdout: "build output\n", stderr: "build error\n", truncated: false };
    }
    return { exitCode: 0, stdout: "test output\n", stderr: "", truncated: false };
  };
  const executeWithFakeSandbox = createCommandExecutor({
    sandboxRunner: fakeSandbox,
  });

  // 1. Command input and workspace root are mandatory before runner access.
  await rejects(
    () => Reflect.apply(executeWithFakeSandbox, undefined, [{ command: "pnpm test" }]),
    (error) => /workspaceRoot is required/.test(foreignMessage(error)),
    "command requires workspaceRoot",
  );
  await rejects(
    () => Reflect.apply(executeWithFakeSandbox, undefined, [{ workspaceRoot: workspace, command: "   " }]),
    (error) => /command must be a non-empty string/.test(foreignMessage(error)),
    "command rejects an empty string",
  );
  await rejects(
    () => Reflect.apply(executeWithFakeSandbox, undefined, [{ workspaceRoot: workspace, command: "pnpm test", mode: "unknown" }]),
    (error) => /unknown sandbox mode/.test(foreignMessage(error)),
    "command rejects an unknown sandbox mode",
  );
  assert(calls.length === 0, "invalid command input does not reach the sandbox seam");

  // 2. Normal execution is routed through the supplied sandbox seam.
  const allowed = await executeWithFakeSandbox({ workspaceRoot: workspace, command: "  pnpm test  " });
  assert(calls.length === 1 && calls[0].command === "pnpm test", "allowed command routes through sandbox seam");
  assert(calls[0].cwd === workspace, "workspaceRoot is forwarded as sandbox cwd");
  assert(!Object.hasOwn(calls[0], "origin"), "agent executor does not expose provenance override to injected runner");
  assert(!Object.hasOwn(calls[0], "approvalGranted") && !Object.hasOwn(calls[0], "networkGranted"), "agent executor does not forward authorization fields");
  assert(allowed.exitCode === 0 && allowed.stdout === "test output\n" && allowed.stderr === "", "stdout and stderr stay separate");

  // 3. Model-era authorization keys are never accepted by the agent executor.
  await rejects(
    () => Reflect.apply(executeWithFakeSandbox, undefined, [{ workspaceRoot: workspace, command: "pnpm test", confirm: true }]),
    (error) => /unexpected argument: confirm/.test(foreignMessage(error)),
    "confirmation claim is rejected before sandbox dispatch",
  );
  await rejects(
    () => Reflect.apply(executeWithFakeSandbox, undefined, [{ workspaceRoot: workspace, command: "pnpm test", network: true }]),
    (error) => /unexpected argument: network/.test(foreignMessage(error)),
    "network claim is rejected before sandbox dispatch",
  );
  assert(calls.length === 1, "authorization claims never reach sandbox seam");

  // 4. Non-zero command exits are returned honestly, not thrown.
  const failed = await executeWithFakeSandbox({ workspaceRoot: workspace, command: "pnpm build" });
  assert(failed.exitCode === 17, "non-zero exit code is preserved");
  assert(failed.stdout === "build output\n" && failed.stderr === "build error\n", "non-zero result preserves separate output");

  // 5. Real policy checks remain in the shared runner and fail closed before a runtime is needed.
  await rejects(
    () => executeCommand({ workspaceRoot: workspace, command: "pnpm install" }),
    (error) => error instanceof SandboxError && error.code === "AGENT_NETWORK_DENIED",
    "network-required agent command fails closed without model approval",
  );

  // 6. A sandbox infrastructure failure propagates; no host fallback exists.
  let failedRunnerCalls = 0;
  const executeWithFailedSandbox = createCommandExecutor({
    sandboxRunner: async () => {
      failedRunnerCalls++;
      throw new SandboxError("SANDBOX_UNAVAILABLE", "unavailable: test sandbox failure");
    },
  });
  await rejects(
    () => executeWithFailedSandbox({ workspaceRoot: workspace, command: "pnpm test" }),
    (error) => error instanceof SandboxError && error.code === "SANDBOX_UNAVAILABLE",
    "sandbox failure propagates without host fallback",
  );
  assert(failedRunnerCalls === 1, "failed sandbox seam is called exactly once");

  // 7. The agent tool module never imports or calls a direct process API.
  const toolSource = readFileSync(join(repoRoot, "lib", "agent", "tool-execution.ts"), "utf8");
  assert(
    !/(node:child_process|\bspawn(?:Sync)?\s*\(|\bexec(?:File|Sync|FileSync)?\s*\()/.test(toolSource),
    "agent command tool adds no direct process-execution API",
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll agent command-tool checks passed.");
