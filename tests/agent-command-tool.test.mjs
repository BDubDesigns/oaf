// Focused test for Alpha 1's sandbox-routed command tool.
// Uses only Node built-ins; no third-party dependencies or container runtime.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCommandExecutor, executeCommand } from "../lib/agent/tool-execution.mjs";
import { SandboxError } from "../lib/sandbox.mjs";

let failures = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`PASS  ${message}`);
  } else {
    console.log(`FAIL  ${message}`);
    failures++;
  }
}

async function rejects(action, predicate, message) {
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
  const calls = [];
  const executeWithFakeSandbox = createCommandExecutor({
    sandboxRunner: async (options) => {
      calls.push(options);
      if (options.command === "pnpm build") {
        return { exitCode: 17, stdout: "build output\n", stderr: "build error\n", truncated: false };
      }
      return { exitCode: 0, stdout: "test output\n", stderr: "", truncated: false };
    },
  });

  // 1. Command input and workspace root are mandatory before runner access.
  await rejects(
    () => executeWithFakeSandbox({ command: "pnpm test" }),
    (error) => /workspaceRoot is required/.test(error.message),
    "command requires workspaceRoot",
  );
  await rejects(
    () => executeWithFakeSandbox({ workspaceRoot: workspace, command: "   " }),
    (error) => /command must be a non-empty string/.test(error.message),
    "command rejects an empty string",
  );
  await rejects(
    () => executeWithFakeSandbox({ workspaceRoot: workspace, command: "pnpm test", mode: "unknown" }),
    (error) => /unknown sandbox mode/.test(error.message),
    "command rejects an unknown sandbox mode",
  );
  assert(calls.length === 0, "invalid command input does not reach the sandbox seam");

  // 2. Normal execution is routed through the supplied sandbox seam.
  const allowed = await executeWithFakeSandbox({ workspaceRoot: workspace, command: "  pnpm test  " });
  assert(calls.length === 1 && calls[0].command === "pnpm test", "allowed command routes through sandbox seam");
  assert(calls[0].cwd === workspace, "workspaceRoot is forwarded as sandbox cwd");
  assert(calls[0].network === false, "network defaults off");
  assert(calls[0].confirm === false, "confirmation defaults off");
  assert(allowed.exitCode === 0 && allowed.stdout === "test output\n" && allowed.stderr === "", "stdout and stderr stay separate");

  // 3. Explicit approval is forwarded to the shared runner.
  await executeWithFakeSandbox({
    workspaceRoot: workspace,
    command: "pnpm install",
    mode: "install",
    network: true,
    confirm: true,
  });
  assert(
    calls[1].mode === "install" && calls[1].network === true && calls[1].confirm === true,
    "mode, network, and explicit confirmation are forwarded",
  );

  // 4. Non-zero command exits are returned honestly, not thrown.
  const failed = await executeWithFakeSandbox({ workspaceRoot: workspace, command: "pnpm build" });
  assert(failed.exitCode === 17, "non-zero exit code is preserved");
  assert(failed.stdout === "build output\n" && failed.stderr === "build error\n", "non-zero result preserves separate output");

  // 5. Real policy checks remain in the shared runner and fail closed before a runtime is needed.
  await rejects(
    () => executeCommand({ workspaceRoot: workspace, command: "pnpm install" }),
    (error) => error instanceof SandboxError && error.code === "POLICY_REJECTED" && /confirmation/.test(error.message),
    "confirmation-required command fails closed without confirmation",
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
  const toolSource = readFileSync(join(repoRoot, "lib", "agent", "tool-execution.mjs"), "utf8");
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
