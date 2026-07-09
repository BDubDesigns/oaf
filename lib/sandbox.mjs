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
  /^pnpm\s+(install|add|remove|dlx)\b/,
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
const ALLOWED_PREFIXES = [
  "git status",
  "git diff",
  "git log --oneline",
  "pnpm test",
  "pnpm lint",
  "pnpm typecheck",
  "pnpm build",
  "pnpm dev",
];

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
  const allowed = ALLOWED_PREFIXES.some((p) => command.startsWith(p));
  if (allowed) {
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

// Runs the sandbox. Returns the child exit code (or 1 for policy/availability
// rejections). Prints a short execution-metadata summary.
export function runSandbox({ command, network, confirm }) {
  const verdict = classifyCommand(command);

  if (verdict.level === "block") {
    console.error(`[sandbox] blocked: command matches a denied pattern.`);
    return 1;
  }
  if (verdict.level === "confirm" && !confirm) {
    console.error(
      `[sandbox] requires confirmation: pass --confirm (${verdict.reason}).`,
    );
    return 1;
  }
  if (verdict.network && !network) {
    console.error(`[sandbox] requires network: pass --network (${verdict.reason}).`);
    return 1;
  }

  const runtime = detectRuntime();
  if (!runtime) {
    console.error(
      "[sandbox] unavailable: no docker or podman found. Install a container runtime to run sandboxed commands.",
    );
    return 1;
  }

  const effectiveNetwork = network || verdict.network;
  console.log(`[sandbox] command: ${command}`);
  console.log(`[sandbox] mode: network=${effectiveNetwork ? "on" : "off"}, runtime=${runtime}`);
  console.log(`[sandbox] cwd: ${resolve(process.cwd())}`);

  const argv = buildContainerRun(runtime, {
    command,
    network: effectiveNetwork,
    cwd: process.cwd(),
  });
  const child = spawn(runtime, argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });

  let out = "";
  child.stdout.on("data", (d) => {
    process.stdout.write(d);
    out += d;
  });
  child.stderr.on("data", (d) => {
    process.stderr.write(d);
    out += d;
  });

  return new Promise((resolvePromise) => {
    child.on("close", (code) => {
      console.log(`[sandbox] exit: ${code ?? 1}`);
      resolvePromise(code ?? 1);
    });
  });
}

export function sandboxStatus() {
  const runtime = detectRuntime();
  if (runtime) {
    console.log(`[sandbox] available: ${runtime}`);
  } else {
    console.log("[sandbox] unavailable: docker/podman not found");
  }
}
