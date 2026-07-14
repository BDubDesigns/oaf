// OAF-owned sandbox policy. Agent proposals never carry authorization facts.

import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { Readable } from "node:stream";
import { BLESSED_PACKAGE_MANAGER, BLESSED_PACKAGE_SCRIPTS, canonicalCommand, isGitInspectionCommand, isVerificationCommand } from "./command-policy.ts";
import { COMMAND_ORIGINS, COMMAND_POLICY_LEVELS, SANDBOX_MODES as SANDBOX_MODE_VALUES, type AgentSandboxCommandOptions, type CommandClassification, type HumanSandboxCommandOptions, type PackageScriptVerification, type SandboxCommandOptions, type SandboxDependencies, type SandboxExecutionCallbacks, type SandboxExecutionResult, type VerificationWorkspace } from "./agent/contracts.ts";

type ContainerRuntime = "docker" | "podman";
type SandboxErrorCode = "PACKAGE_SCRIPT_POLICY" | "SANDBOX_START_FAILED" | "INVALID_MODE" | "INVALID_ORIGIN" | "AGENT_COMMAND_DENIED" | "POLICY_REJECTED" | "AGENT_NETWORK_DENIED" | "AGENT_AUTHORIZATION_REQUIRED" | "SANDBOX_UNAVAILABLE" | "INVALID_AGENT_ARGUMENT";
type ContainerRunOptions = SandboxExecutionCallbacks & { runtime: string; argv: string[]; command: string; network: boolean; cwd: string };
type ExecutionOptions = SandboxCommandOptions & { command?: unknown; cwd?: string; dependencies?: SandboxDependencies };

const IMAGE = process.env.OAF_SANDBOX_IMAGE || "oaf-node:20";
const BLOCK_PATTERNS = [/\bsudo\b/, /\bsu\b(?=\s|$)/, /rm\s+-rf\s+\//, /\bcurl\b[^|]*\|[^|]*\bsh\b/, /\bwget\b[^|]*\|[^|]*\bsh\b/, /\bssh\b/, /\bscp\b/, /\bdocker\b/, /\bpodman\b/, /docker\.sock/, /\.ssh/, /~\/\.config/, /\.\.\//, /\.\.\\/];
const NETWORK_PATTERNS = [/^pnpm\s+(install|add|remove|dlx)\b/, /\bcompose\b/, /\bpull\b/, /\bdocker\b/];
const CONFIRM_PATTERNS = [/^pnpm\s+(install|add|remove|dlx|dev)\b/, /\bcompose\b/, /migrat/, /lockfile/, /\bchmod\b/, /\bchown\b/, /oaf\//, /\brm\b/, /delete/, /move/];

export const SANDBOX_MODES = Object.freeze(SANDBOX_MODE_VALUES);
const [ALLOW, CONFIRM, BLOCK] = COMMAND_POLICY_LEVELS;

export class SandboxError extends Error {
  readonly code: SandboxErrorCode;

  constructor(code: SandboxErrorCode, message: string) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
  }
}

export function classifyCommand(command: string): CommandClassification {
  for (const re of BLOCK_PATTERNS) if (re.test(command)) return { level: BLOCK, network: false, reason: "matches a blocked pattern" };
  const network = NETWORK_PATTERNS.some((re) => re.test(command));
  if (CONFIRM_PATTERNS.some((re) => re.test(command)) || network) return { level: CONFIRM, network, reason: "requires confirmation" };
  if (canonicalCommand(command)) return { level: ALLOW, network: false, reason: "allowlisted" };
  return { level: CONFIRM, network: false, reason: "not in allowlist" };
}

export function detectRuntime(): ContainerRuntime | null {
  for (const runtime of ["docker", "podman"] as const) {
    try {
      if (spawnSync(runtime, ["--version"], { stdio: "ignore", timeout: 5000 }).status === 0) return runtime;
    } catch {}
  }
  return null;
}

export function buildContainerRun(runtime: string, { command, network = false, cwd, readOnly = false, nodeModules = null }: { command: string; network?: boolean; cwd: string; readOnly?: boolean; nodeModules?: string | null }): string[] {
  const target = resolve(cwd);
  const volume = `${target}:/workspace${readOnly ? ":ro" : ""}`;
  const argv = [runtime, "run", "--rm", "--workdir", "/workspace", "--volume", volume];
  if (nodeModules) argv.push("--volume", `${resolve(nodeModules)}:/workspace/node_modules:ro`);
  argv.push("--cap-drop=ALL", "--security-opt", "no-new-privileges", "--pids-limit", "512", "--memory", "4g", "--cpus", "4", "--network", network ? "bridge" : "none", IMAGE, "sh", "-c", command);
  return argv;
}

function isPlainObject(value: unknown): value is object {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function policyFailure(invariant: string): never {
  throw new SandboxError("PACKAGE_SCRIPT_POLICY", `package-script policy rejected: ${invariant}`);
}

// Trust script definitions from OAF code, never from repository metadata alone.
export async function verifyPackageScript(workspaceRoot: string, command: string): Promise<PackageScriptVerification> {
  const script = command.slice("pnpm ".length);
  const blessed = script === "doctor"
    ? BLESSED_PACKAGE_SCRIPTS.doctor
    : script === "test"
      ? BLESSED_PACKAGE_SCRIPTS.test
      : undefined;
  if (blessed === undefined) policyFailure(`script '${script}' is not blessed by OAF`);
  const packagePath = resolve(workspaceRoot, "package.json");
  let packageStat: Awaited<ReturnType<typeof lstat>>;
  try { packageStat = await lstat(packagePath); } catch { policyFailure("package.json is missing"); }
  if (!packageStat.isFile() || packageStat.isSymbolicLink()) policyFailure("package.json must be a regular file");
  let manifest: unknown;
  try { manifest = JSON.parse(await readFile(packagePath, "utf8")); } catch { policyFailure("package.json must be valid JSON"); }
  if (!isPlainRecord(manifest)) policyFailure("package.json must be a plain object");
  if (!isPlainRecord(manifest.scripts)) policyFailure("scripts must be a plain object");
  if (manifest.scripts[script] !== blessed) policyFailure(`script '${script}' does not match OAF's blessed definition`);
  if (Object.hasOwn(manifest.scripts, `pre${script}`) || Object.hasOwn(manifest.scripts, `post${script}`)) policyFailure(`unowned lifecycle hook for '${script}' is present`);
  if (manifest.packageManager !== BLESSED_PACKAGE_MANAGER) policyFailure("packageManager does not match OAF's pinned pnpm version");
  if (existsSync(resolve(workspaceRoot, "pnpm-workspace.yaml"))) policyFailure("pnpm-workspace.yaml is not OAF-owned");
  if (existsSync(resolve(workspaceRoot, ".pnpmfile.mjs")) || existsSync(resolve(workspaceRoot, ".pnpmfile.cjs"))) policyFailure("repository-local pnpm hook is present");
  return { script, command, definition: blessed };
}

function excluded(relativePath: string): boolean {
  const segments = relativePath.split("/");
  const name = segments.at(-1) ?? "";
  return segments.includes(".git") || segments.includes("node_modules") || (segments[0] === "oaf" && segments[1] === "receipts") || name.startsWith(".env") || name === ".npmrc";
}

async function copyProject(source: string, destination: string, base = source): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const rel = relative(base, sourcePath).replaceAll("\\", "/");
    if (excluded(rel)) continue;
    const entryStat = await lstat(sourcePath);
    if (entryStat.isSymbolicLink()) continue;
    const destinationPath = join(destination, entry.name);
    if (entryStat.isDirectory()) {
      await mkdir(destinationPath, { recursive: true });
      await copyProject(sourcePath, destinationPath, base);
    } else if (entryStat.isFile()) {
      await copyFile(sourcePath, destinationPath);
    }
  }
}

export async function createVerificationWorkspace(workspaceRoot: string): Promise<VerificationWorkspace> {
  const root = resolve(workspaceRoot);
  const directory = await mkdtemp(join(tmpdir(), "oaf-verification-"));
  try {
    await copyProject(root, directory);
    const nodeModules = resolve(root, "node_modules");
    const nodeModulesMount = existsSync(nodeModules) && (await lstat(nodeModules)).isDirectory() ? nodeModules : null;
    return { directory, nodeModulesMount, async cleanup(): Promise<void> { await rm(directory, { recursive: true, force: true }); } };
  } catch (error: unknown) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function spawnContainer({ runtime, argv, onStart, onStdout, onStderr, command, network, cwd }: ContainerRunOptions): Promise<SandboxExecutionResult> {
  onStart?.({ command, network, runtime, cwd });
  return new Promise((resolvePromise, rejectPromise) => {
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(runtime, argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error: unknown) {
      rejectPromise(new SandboxError("SANDBOX_START_FAILED", `failed to start sandbox: ${errorMessage(error)}`));
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void): void => { if (!settled) { settled = true; callback(); } };
    child.stdout.on("data", (data: Buffer) => { stdout += data; onStdout?.(data); });
    child.stderr.on("data", (data: Buffer) => { stderr += data; onStderr?.(data); });
    child.on("error", (error: Error) => finish(() => rejectPromise(new SandboxError("SANDBOX_START_FAILED", `failed to start sandbox: ${errorMessage(error)}`))));
    child.on("close", (code: number | null) => finish(() => resolvePromise({ exitCode: code ?? 1, stdout, stderr, truncated: false })));
  });
}

async function executeSandbox({ command, mode, origin, approvalGranted, networkGranted, cwd = process.cwd(), onStart, onStdout, onStderr, dependencies = {} }: ExecutionOptions): Promise<SandboxExecutionResult> {
  if (mode !== undefined && !SANDBOX_MODES.includes(mode)) throw new SandboxError("INVALID_MODE", `unknown sandbox mode: ${mode}`);
  if (!COMMAND_ORIGINS.includes(origin)) throw new SandboxError("INVALID_ORIGIN", "unknown command origin");
  const normalized = typeof command === "string" ? command.trim() : "";
  if (origin === "agent" && normalized === "git diff") throw new SandboxError("AGENT_COMMAND_DENIED", "agent command is not available to the provider");
  const verdict = classifyCommand(normalized);
  if (verdict.level === "block") throw new SandboxError("POLICY_REJECTED", "blocked: command matches a denied pattern.");
  if (origin === "agent" && verdict.network) throw new SandboxError("AGENT_NETWORK_DENIED", "agent commands requiring network are rejected.");
  if (origin === "agent" && verdict.level === "confirm") throw new SandboxError("AGENT_AUTHORIZATION_REQUIRED", "agent commands requiring human approval are rejected.");
  if (origin === "human_cli" && verdict.level === "confirm" && !approvalGranted) throw new SandboxError("POLICY_REJECTED", `requires confirmation: pass --confirm (${verdict.reason}).`);
  if (origin === "human_cli" && verdict.network && !networkGranted) throw new SandboxError("POLICY_REJECTED", `requires network: pass --network (${verdict.reason}).`);

  const root = resolve(cwd);
  let verification: VerificationWorkspace | null = null;
  if (origin === "agent" && isVerificationCommand(normalized)) {
    await verifyPackageScript(root, normalized);
    verification = await (dependencies.createVerificationWorkspace ?? createVerificationWorkspace)(root);
  }
  try {
    const runtime = (dependencies.detectRuntime ?? detectRuntime)();
    if (!runtime) throw new SandboxError("SANDBOX_UNAVAILABLE", "unavailable: no docker or podman found. Install a container runtime to run sandboxed commands.");
    const executionRoot = verification?.directory ?? root;
    const network = origin === "agent" ? false : (networkGranted || verdict.network);
    const argv = buildContainerRun(runtime, { command: normalized, network, cwd: executionRoot, readOnly: origin === "agent" && isGitInspectionCommand(normalized), nodeModules: verification?.nodeModulesMount ?? null });
    return await (dependencies.runContainer ?? spawnContainer)({ runtime, argv, onStart, onStdout, onStderr, command: normalized, network, cwd: executionRoot });
  } finally {
    await verification?.cleanup();
  }
}

// Generic internal entry point: provenance is mandatory and never defaults.
export async function runSandboxCommand(options: SandboxCommandOptions): Promise<SandboxExecutionResult> {
  if (!options || options.origin === undefined) throw new SandboxError("INVALID_ORIGIN", "command origin is required");
  return executeSandbox(options);
}

// The agent entry point permanently owns denied grants and all agent-only
// verification/mount semantics. Provider values cannot override these fields.
export async function runAgentSandboxCommand(options: AgentSandboxCommandOptions = {}): Promise<SandboxExecutionResult> {
  if (options === null || typeof options !== "object" || Array.isArray(options)) throw new SandboxError("INVALID_AGENT_ARGUMENT", "agent sandbox options must be an object");
  const allowed = new Set(["command", "mode", "cwd", "onStart", "onStdout", "onStderr", "dependencies"]);
  for (const key of Object.keys(options)) if (!allowed.has(key)) throw new SandboxError("INVALID_AGENT_ARGUMENT", `agent sandbox received unexpected argument: ${key}`);
  const { command, mode, cwd, onStart, onStdout, onStderr, dependencies } = options;
  return executeSandbox({ command, mode, cwd, onStart, onStdout, onStderr, dependencies, origin: "agent", approvalGranted: false, networkGranted: false });
}

// Human CLI is the only public path that accepts trusted authorization grants.
export async function runHumanSandboxCommand({ command, mode, approvalGranted = false, networkGranted = false, cwd, onStart, onStdout, onStderr, dependencies }: HumanSandboxCommandOptions = {}): Promise<SandboxExecutionResult> {
  return executeSandbox({ command, mode, cwd, onStart, onStdout, onStderr, dependencies, origin: "human_cli", approvalGranted, networkGranted });
}

export async function runSandbox({ command, network = false, confirm = false }: { command: string; network?: boolean; confirm?: boolean }): Promise<number> {
  try {
    const result = await runHumanSandboxCommand({ command, approvalGranted: confirm, networkGranted: network, cwd: process.cwd(), onStart: ({ command: started, network: enabled, runtime, cwd }) => {
      console.log(`[sandbox] command: ${started}`);
      console.log(`[sandbox] mode: network=${enabled ? "on" : "off"}, runtime=${runtime}`);
      console.log(`[sandbox] cwd: ${cwd}`);
    }, onStdout: (data) => process.stdout.write(data), onStderr: (data) => process.stderr.write(data) });
    console.log(`[sandbox] exit: ${result.exitCode}`);
    return result.exitCode;
  } catch (error: unknown) {
    console.error(`[sandbox] ${error instanceof SandboxError ? error.message : `failed: ${errorMessage(error)}`}`);
    return 1;
  }
}

export function sandboxStatus(): void {
  const runtime = detectRuntime();
  console.log(runtime ? `[sandbox] available: ${runtime}` : "[sandbox] unavailable: docker/podman not found");
}
