// Minimal OAF sandbox runner (issue #9).
//
// Establishes the OAF command-execution boundary for Alpha 0. It enforces
// the command policy from docs/sandbox.md BEFORE execution, then (when a
// container runtime is available) runs the command inside a locked-down
// container: only the project directory mounted, network off by default.
//
// This is intentionally minimal and testable. It does NOT implement
// receipts, agent integration, or package allowlist config.

import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Image used for the sandbox container. Must be built/available locally.
// Override with OAF_SANDBOX_IMAGE if you build a different tag.
const IMAGE = process.env.OAF_SANDBOX_IMAGE || "oaf-node:20";

// Commands blocked outright — never executed.
const BLOCK_PATTERNS = [
  /\bsudo\b/,
  /\bsu\b(?=\s|$)/,
  /rm\s+-rf\s+\//,
  /\bcurl\b[^|]*\|[^|]*\bsh\b/,
  /\bwget\b[^|]*\|[^|]*\bsh\b/,
  /\bssh\b/,
  /\bscp\b/,
  /\bdocker\b/,
  /\bpodman\b/,
  /docker\.sock/,
  /\.ssh/,
  /~\/\.config/,
  /\.\.\//,
  /\.\.\\/,
];

// Commands that require network (and therefore --network).
const NETWORK_PATTERNS = [
  /^pnpm\s+(install|add|remove|dlx)\b/,
  /\bcompose\b/,
  /\bpull\b/,
  /\bdocker\b/,
];

// Commands that require explicit confirmation (--confirm).
const CONFIRM_PATTERNS = [
  /^pnpm\s+(install|add|remove|dlx|dev)\b/,
  /\bcompose\b/,
  /migrat/,
  /lockfile/,
  /\bchmod\b/,
  /\bchown\b/,
  /oaf\//,
  /\brm\b/,
  /delete/,
  /move/,
];

// Commands allowed by default (network off, no confirmation needed).
// Exact match only for Alpha 0: because execution uses `sh -c`, prefix
// matching would let `pnpm test; pnpm install` or `pnpm test && ...` slip
// through. Confirmation-required and blocked commands still apply.
const ALLOWED_EXACT = new Set([
  "git status",
  "git diff",
  "git log --oneline",
  "pnpm test",
  "pnpm lint",
  "pnpm typecheck",
  "pnpm build",
]);

// Modes are execution intent supplied by the future agent loop. The minimal
// runner's existing command policy remains the enforcement authority; callers
// use this vocabulary to reject unknown modes before proposing work.
export const SANDBOX_MODES = Object.freeze(["plan", "edit", "test", "browser", "install", "research"]);

export function classifyCommand(command) {
  for (const re of BLOCK_PATTERNS) {
    if (re.test(command)) {
      return { level: "block", network: false, reason: "matches a blocked pattern" };
    }
  }
  const network = NETWORK_PATTERNS.some((re) => re.test(command));
  const confirm = CONFIRM_PATTERNS.some((re) => re.test(command)) || network;
  if (confirm) {
    return { level: "confirm", network, reason: "requires confirmation" };
  }
  if (ALLOWED_EXACT.has(command)) {
    return { level: "allow", network: false, reason: "allowlisted" };
  }
  // Unknown commands are not allowlisted; require explicit confirmation.
  return { level: "confirm", network: false, reason: "not in allowlist" };
}

export function detectRuntime() {
  const probe = (cmd) => {
    try {
      const r = spawnSync(cmd, ["--version"], { stdio: "ignore", timeout: 5000 });
      return r.status === 0;
    } catch {
      return false;
    }
  };
  if (probe("docker")) return "docker";
  if (probe("podman")) return "podman";
  return null;
}

export function buildContainerRun(runtime, { command, network, cwd }) {
  const target = resolve(cwd);
  return [
    runtime,
    "run",
    "--rm",
    "--workdir",
    "/workspace",
    // Mount ONLY the project directory. Never the user home or Docker socket.
    "--volume",
    `${target}:/workspace`,
    "--cap-drop=ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "512",
    "--memory",
    "4g",
    "--cpus",
    "4",
    "--network",
    network ? "bridge" : "none",
    IMAGE,
    "sh",
    "-c",
    command,
  ];
}

export class SandboxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
  }
}

// Shared programmatic sandbox seam. It is the only path that evaluates
// command policy and starts the container. Policy and infrastructure failures
// throw a structured SandboxError; a command that actually runs always returns
// its real exit code, including non-zero codes.
export function runSandboxCommand({
  command,
  mode,
  network = false,
  confirm = false,
  cwd = process.cwd(),
  onStart,
  onStdout,
  onStderr,
}) {
  if (mode !== undefined && !SANDBOX_MODES.includes(mode)) {
    throw new SandboxError("INVALID_MODE", `unknown sandbox mode: ${mode}`);
  }

  const verdict = classifyCommand(command);

  if (verdict.level === "block") {
    throw new SandboxError("POLICY_REJECTED", "blocked: command matches a denied pattern.");
  }
  if (verdict.level === "confirm" && !confirm) {
    throw new SandboxError(
      "POLICY_REJECTED",
      `requires confirmation: pass --confirm (${verdict.reason}).`,
    );
  }
  if (verdict.network && !network) {
    throw new SandboxError("POLICY_REJECTED", `requires network: pass --network (${verdict.reason}).`);
  }

  const runtime = detectRuntime();
  if (!runtime) {
    throw new SandboxError(
      "SANDBOX_UNAVAILABLE",
      "unavailable: no docker or podman found. Install a container runtime to run sandboxed commands.",
    );
  }

  const effectiveNetwork = network || verdict.network;
  const effectiveCwd = resolve(cwd);
  onStart?.({ command, network: effectiveNetwork, runtime, cwd: effectiveCwd });

  const argv = buildContainerRun(runtime, {
    command,
    network: effectiveNetwork,
    cwd: effectiveCwd,
  });

  return new Promise((resolvePromise, rejectPromise) => {
    let child;
    try {
      child = spawn(runtime, argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      rejectPromise(new SandboxError("SANDBOX_START_FAILED", `failed to start sandbox: ${error.message}`));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      callback();
    };

    child.stdout?.on("data", (data) => {
      stdout += data;
      onStdout?.(data);
    });
    child.stderr?.on("data", (data) => {
      stderr += data;
      onStderr?.(data);
    });
    child.on("error", (error) => {
      finish(() => {
        rejectPromise(new SandboxError("SANDBOX_START_FAILED", `failed to start sandbox: ${error.message}`));
      });
    });
    child.on("close", (code) => {
      finish(() => {
        resolvePromise({
          exitCode: code ?? 1,
          stdout,
          stderr,
          truncated: false,
        });
      });
    });
  });
}

// CLI adapter over the shared runner. Preserve the existing CLI's output and
// exit-code contract while keeping policy/execution in runSandboxCommand.
export async function runSandbox({ command, network = false, confirm = false }) {
  try {
    const result = await runSandboxCommand({
      command,
      network,
      confirm,
      cwd: process.cwd(),
      onStart: ({ command: startedCommand, network: startedNetwork, runtime, cwd }) => {
        console.log(`[sandbox] command: ${startedCommand}`);
        console.log(`[sandbox] mode: network=${startedNetwork ? "on" : "off"}, runtime=${runtime}`);
        console.log(`[sandbox] cwd: ${cwd}`);
      },
      onStdout: (data) => process.stdout.write(data),
      onStderr: (data) => process.stderr.write(data),
    });
    console.log(`[sandbox] exit: ${result.exitCode}`);
    return result.exitCode;
  } catch (error) {
    if (error instanceof SandboxError) {
      console.error(`[sandbox] ${error.message}`);
    } else {
      console.error(`[sandbox] failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return 1;
  }
}

export function sandboxStatus() {
  const runtime = detectRuntime();
  if (runtime) {
    console.log(`[sandbox] available: ${runtime}`);
  } else {
    console.log("[sandbox] unavailable: docker/podman not found");
  }
}
