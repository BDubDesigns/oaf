// OAF-owned sandbox policy. Agent proposals never carry authorization facts.

import { spawn, spawnSync } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { CANONICAL_COMMAND_SET, BLESSED_PACKAGE_MANAGER, BLESSED_PACKAGE_SCRIPTS, isGitInspectionCommand, isVerificationCommand } from "./command-policy.mjs";

const IMAGE = process.env.OAF_SANDBOX_IMAGE || "oaf-node:20";
const BLOCK_PATTERNS = [/\bsudo\b/, /\bsu\b(?=\s|$)/, /rm\s+-rf\s+\//, /\bcurl\b[^|]*\|[^|]*\bsh\b/, /\bwget\b[^|]*\|[^|]*\bsh\b/, /\bssh\b/, /\bscp\b/, /\bdocker\b/, /\bpodman\b/, /docker\.sock/, /\.ssh/, /~\/\.config/, /\.\.\//, /\.\.\\/];
const NETWORK_PATTERNS = [/^pnpm\s+(install|add|remove|dlx)\b/, /\bcompose\b/, /\bpull\b/, /\bdocker\b/];
const CONFIRM_PATTERNS = [/^pnpm\s+(install|add|remove|dlx|dev)\b/, /\bcompose\b/, /migrat/, /lockfile/, /\bchmod\b/, /\bchown\b/, /oaf\//, /\brm\b/, /delete/, /move/];

export const SANDBOX_MODES = Object.freeze(["plan", "edit", "test", "browser", "install", "research"]);

export class SandboxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
  }
}

export function classifyCommand(command) {
  for (const re of BLOCK_PATTERNS) if (re.test(command)) return { level: "block", network: false, reason: "matches a blocked pattern" };
  const network = NETWORK_PATTERNS.some((re) => re.test(command));
  if (CONFIRM_PATTERNS.some((re) => re.test(command)) || network) return { level: "confirm", network, reason: "requires confirmation" };
  if (CANONICAL_COMMAND_SET.has(command)) return { level: "allow", network: false, reason: "allowlisted" };
  return { level: "confirm", network: false, reason: "not in allowlist" };
}

export function detectRuntime() {
  for (const runtime of ["docker", "podman"]) {
    try {
      if (spawnSync(runtime, ["--version"], { stdio: "ignore", timeout: 5000 }).status === 0) return runtime;
    } catch {}
  }
  return null;
}

export function buildContainerRun(runtime, { command, network = false, cwd, readOnly = false, nodeModules = null }) {
  const target = resolve(cwd);
  const volume = `${target}:/workspace${readOnly ? ":ro" : ""}`;
  const argv = [runtime, "run", "--rm", "--workdir", "/workspace", "--volume", volume];
  if (nodeModules) argv.push("--volume", `${resolve(nodeModules)}:/workspace/node_modules:ro`);
  argv.push("--cap-drop=ALL", "--security-opt", "no-new-privileges", "--pids-limit", "512", "--memory", "4g", "--cpus", "4", "--network", network ? "bridge" : "none", IMAGE, "sh", "-c", command);
  return argv;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function policyFailure(invariant) {
  throw new SandboxError("PACKAGE_SCRIPT_POLICY", `package-script policy rejected: ${invariant}`);
}

// Trust script definitions from OAF code, never from repository metadata alone.
export async function verifyPackageScript(workspaceRoot, command) {
  const script = command.slice("pnpm ".length);
  const blessed = BLESSED_PACKAGE_SCRIPTS[script];
  if (blessed === undefined) policyFailure(`script '${script}' is not blessed by OAF`);
  const packagePath = resolve(workspaceRoot, "package.json");
  let stat;
  try { stat = await lstat(packagePath); } catch { policyFailure("package.json is missing"); }
  if (!stat.isFile() || stat.isSymbolicLink()) policyFailure("package.json must be a regular file");
  let manifest;
  try { manifest = JSON.parse(await readFile(packagePath, "utf8")); } catch { policyFailure("package.json must be valid JSON"); }
  if (!isPlainObject(manifest)) policyFailure("package.json must be a plain object");
  if (!isPlainObject(manifest.scripts)) policyFailure("scripts must be a plain object");
  if (manifest.scripts[script] !== blessed) policyFailure(`script '${script}' does not match OAF's blessed definition`);
  if (Object.hasOwn(manifest.scripts, `pre${script}`) || Object.hasOwn(manifest.scripts, `post${script}`)) policyFailure(`unowned lifecycle hook for '${script}' is present`);
  if (manifest.packageManager !== BLESSED_PACKAGE_MANAGER) policyFailure("packageManager does not match OAF's pinned pnpm version");
  const npmrc = resolve(workspaceRoot, ".npmrc");
  if (existsSync(npmrc)) {
    let config;
    try {
      const stat = await lstat(npmrc);
      if (!stat.isFile() || stat.isSymbolicLink()) policyFailure(".npmrc must be a regular file");
      config = await readFile(npmrc, "utf8");
    } catch (error) {
      if (error instanceof SandboxError) throw error;
      policyFailure(".npmrc cannot be read safely");
    }
    if (/^\s*script-shell\s*=/mi.test(config)) policyFailure(".npmrc selects a custom script shell");
  }
  if (existsSync(resolve(workspaceRoot, ".pnpmfile.cjs"))) {
    policyFailure("repository-local pnpm hook is present");
  }
  return { script, command, definition: blessed };
}

function excluded(relativePath) {
  const segments = relativePath.split("/");
  const name = segments.at(-1);
  return segments.includes(".git") || segments.includes("node_modules") || (segments[0] === "oaf" && segments[1] === "receipts") || name === ".env" || name.startsWith(".env.");
}

async function copyProject(source, destination, base = source) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const rel = relative(base, sourcePath).replaceAll("\\", "/");
    if (excluded(rel)) continue;
    const stat = await lstat(sourcePath);
    if (stat.isSymbolicLink()) continue;
    const destinationPath = join(destination, entry.name);
    if (stat.isDirectory()) {
      await mkdir(destinationPath, { recursive: true });
      await copyProject(sourcePath, destinationPath, base);
    } else if (stat.isFile()) {
      await copyFile(sourcePath, destinationPath);
    }
  }
}

export async function createVerificationWorkspace(workspaceRoot) {
  const root = resolve(workspaceRoot);
  const directory = await mkdtemp(join(tmpdir(), "oaf-verification-"));
  try {
    await copyProject(root, directory);
    const nodeModules = resolve(root, "node_modules");
    const nodeModulesMount = existsSync(nodeModules) && (await lstat(nodeModules)).isDirectory() ? nodeModules : null;
    return { directory, nodeModulesMount, async cleanup() { await rm(directory, { recursive: true, force: true }); } };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function spawnContainer({ runtime, argv, onStart, command, network, cwd }) {
  onStart?.({ command, network, runtime, cwd });
  return new Promise((resolvePromise, rejectPromise) => {
    let child;
    try { child = spawn(runtime, argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] }); }
    catch (error) { rejectPromise(new SandboxError("SANDBOX_START_FAILED", `failed to start sandbox: ${error.message}`)); return; }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback) => { if (!settled) { settled = true; callback(); } };
    child.stdout?.on("data", (data) => { stdout += data; });
    child.stderr?.on("data", (data) => { stderr += data; });
    child.on("error", (error) => finish(() => rejectPromise(new SandboxError("SANDBOX_START_FAILED", `failed to start sandbox: ${error.message}`))));
    child.on("close", (code) => finish(() => resolvePromise({ exitCode: code ?? 1, stdout, stderr, truncated: false })));
  });
}

// This is the only execution path. `approvalGranted` and `networkGranted`
// originate from trusted host code; they are never provider tool arguments.
export async function runSandboxCommand({ command, mode, origin = "human_cli", approvalGranted = false, networkGranted = false, cwd = process.cwd(), onStart }) {
  if (mode !== undefined && !SANDBOX_MODES.includes(mode)) throw new SandboxError("INVALID_MODE", `unknown sandbox mode: ${mode}`);
  if (origin !== "agent" && origin !== "human_cli") throw new SandboxError("INVALID_ORIGIN", "unknown command origin");
  const normalized = typeof command === "string" ? command.trim() : "";
  const verdict = classifyCommand(normalized);
  if (verdict.level === "block") throw new SandboxError("POLICY_REJECTED", "blocked: command matches a denied pattern.");
  if (origin === "agent" && verdict.network) throw new SandboxError("AGENT_NETWORK_DENIED", "agent commands requiring network are rejected.");
  if (origin === "agent" && verdict.level === "confirm") throw new SandboxError("AGENT_AUTHORIZATION_REQUIRED", "agent commands requiring human approval are rejected.");
  if (origin === "human_cli" && verdict.level === "confirm" && !approvalGranted) throw new SandboxError("POLICY_REJECTED", `requires confirmation: pass --confirm (${verdict.reason}).`);
  if (origin === "human_cli" && verdict.network && !networkGranted) throw new SandboxError("POLICY_REJECTED", `requires network: pass --network (${verdict.reason}).`);

  const root = resolve(cwd);
  let verification = null;
  if (origin === "agent" && isVerificationCommand(normalized)) {
    await verifyPackageScript(root, normalized);
    verification = await createVerificationWorkspace(root);
  }
  try {
    const runtime = detectRuntime();
    if (!runtime) throw new SandboxError("SANDBOX_UNAVAILABLE", "unavailable: no docker or podman found. Install a container runtime to run sandboxed commands.");
    const executionRoot = verification?.directory ?? root;
    const argv = buildContainerRun(runtime, {
      command: normalized,
      network: origin === "agent" ? false : (networkGranted || verdict.network),
      cwd: executionRoot,
      readOnly: origin === "agent" && isGitInspectionCommand(normalized),
      nodeModules: verification?.nodeModulesMount ?? null,
    });
    return await spawnContainer({ runtime, argv, onStart, command: normalized, network: origin === "agent" ? false : (networkGranted || verdict.network), cwd: executionRoot });
  } finally {
    await verification?.cleanup();
  }
}

export async function runSandbox({ command, network = false, confirm = false }) {
  try {
    const result = await runSandboxCommand({ command, origin: "human_cli", approvalGranted: confirm, networkGranted: network, cwd: process.cwd(), onStart: ({ command: started, network: enabled, runtime, cwd }) => {
      console.log(`[sandbox] command: ${started}`);
      console.log(`[sandbox] mode: network=${enabled ? "on" : "off"}, runtime=${runtime}`);
      console.log(`[sandbox] cwd: ${cwd}`);
    } });
    console.log(`[sandbox] exit: ${result.exitCode}`);
    return result.exitCode;
  } catch (error) {
    console.error(`[sandbox] ${error instanceof SandboxError ? error.message : `failed: ${error instanceof Error ? error.message : String(error)}`}`);
    return 1;
  }
}

export function sandboxStatus() {
  const runtime = detectRuntime();
  console.log(runtime ? `[sandbox] available: ${runtime}` : "[sandbox] unavailable: docker/podman not found");
}
