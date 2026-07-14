// Command authorization and repository-script trust checks. No container daemon
// is required: policy failures occur before runtime discovery.
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildContainerRun, createVerificationWorkspace, runAgentSandboxCommand, runHumanSandboxCommand, runSandboxCommand, SandboxError, verifyPackageScript } from "../lib/sandbox.ts";
import { runAgentLoop } from "../lib/agent/loop.ts";
import { copyGeneratedAppFixture } from "./generated-app-fixture-helper.ts";

let failures = 0;
function assert(condition, message) { if (condition) console.log(`PASS  ${message}`); else { console.log(`FAIL  ${message}`); failures++; } }
async function rejects(action, code, message) {
  try { await action(); assert(false, message); }
  catch (error) { assert(error instanceof SandboxError && error.code === code, message); }
}
function manifest(workspace) { return JSON.parse(readFileSync(join(workspace, "package.json"), "utf8")); }
function writeManifest(workspace, value) { writeFileSync(join(workspace, "package.json"), JSON.stringify(value, null, 2)); }

async function providerCall(args) {
  let calls = 0;
  return { complete: async () => calls++ === 0 ? { content: null, toolCalls: [{ id: "provider-call", name: "command", args }] } : { content: "done", toolCalls: [] } };
}

const fixture = copyGeneratedAppFixture();
try {
  // Provider authorization claims are rejected by the registry validator before dispatch.
  for (const key of ["confirm", "network"]) {
    let executions = 0;
    const run = await runAgentLoop({ task: "test", workspaceRoot: fixture.workspace, oafRoot: process.cwd(), provider: await providerCall({ command: "pnpm test", [key]: true }), commandExecutor: async () => { executions++; return { exitCode: 0, stdout: "", stderr: "", truncated: false }; } });
    assert(executions === 0, `provider ${key} claim never reaches executor`);
    assert(run.events.some((event) => event.type === "tool_result" && event.errorCode === "rejected"), `provider ${key} claim is rejected`);
  }
  await verifyPackageScript(fixture.workspace, "pnpm test");
  assert(true, "untouched generated pnpm test definition is accepted");

  const cases = [
    ["modified test script", (m) => { m.scripts.test = "node malicious.mjs"; }, "PACKAGE_SCRIPT_POLICY"],
    ["pretest hook", (m) => { m.scripts.pretest = "node malicious.mjs"; }, "PACKAGE_SCRIPT_POLICY"],
    ["posttest hook", (m) => { m.scripts.posttest = "node malicious.mjs"; }, "PACKAGE_SCRIPT_POLICY"],
    ["missing test script", (m) => { delete m.scripts.test; }, "PACKAGE_SCRIPT_POLICY"],
    ["wrong package manager", (m) => { m.packageManager = "pnpm@0.0.0"; }, "PACKAGE_SCRIPT_POLICY"],
  ];
  for (const [name, mutate, code] of cases) {
    const copy = copyGeneratedAppFixture();
    try { const value = manifest(copy.workspace); mutate(value); writeManifest(copy.workspace, value); await rejects(() => verifyPackageScript(copy.workspace, "pnpm test"), code, `${name} fails closed`); }
    finally { copy.cleanup(); }
  }
  for (const command of ["pnpm lint", "pnpm typecheck", "pnpm build"]) await rejects(() => verifyPackageScript(fixture.workspace, command), "PACKAGE_SCRIPT_POLICY", `${command} lacks a blessed generated script`);

  const malformed = copyGeneratedAppFixture();
  try { writeFileSync(join(malformed.workspace, "package.json"), "{"); await rejects(() => verifyPackageScript(malformed.workspace, "pnpm test"), "PACKAGE_SCRIPT_POLICY", "malformed package.json fails closed"); } finally { malformed.cleanup(); }
  const workspaceConfig = copyGeneratedAppFixture();
  try { writeFileSync(join(workspaceConfig.workspace, "pnpm-workspace.yaml"), "scriptShell: /bin/sh\nshellEmulator: true\n"); await rejects(() => verifyPackageScript(workspaceConfig.workspace, "pnpm test"), "PACKAGE_SCRIPT_POLICY", "pnpm 11 workspace configuration fails closed"); } finally { workspaceConfig.cleanup(); }
  const hookMjs = copyGeneratedAppFixture();
  try { writeFileSync(join(hookMjs.workspace, ".pnpmfile.mjs"), "export default {}\n"); await rejects(() => verifyPackageScript(hookMjs.workspace, "pnpm test"), "PACKAGE_SCRIPT_POLICY", "pnpm mjs hook fails closed"); } finally { hookMjs.cleanup(); }
  const hook = copyGeneratedAppFixture();
  try { writeFileSync(join(hook.workspace, ".pnpmfile.cjs"), "module.exports = {}\n"); await rejects(() => verifyPackageScript(hook.workspace, "pnpm test"), "PACKAGE_SCRIPT_POLICY", "repository pnpm hook fails closed"); } finally { hook.cleanup(); }
  const linked = copyGeneratedAppFixture();
  try { const packagePath = join(linked.workspace, "package.json"); rmSync(packagePath); symlinkSync(join(linked.workspace, "README.md"), packagePath); await rejects(() => verifyPackageScript(linked.workspace, "pnpm test"), "PACKAGE_SCRIPT_POLICY", "symlinked package.json fails closed"); } finally { linked.cleanup(); }

  // Package verification copies only safe regular project files and always cleans up.
  mkdirSync(join(fixture.workspace, ".git"));
  mkdirSync(join(fixture.workspace, "node_modules"));
  for (const name of [".env", ".env.local", ".envrc", ".environment", ".env-secrets"]) {
    writeFileSync(join(fixture.workspace, name), `SECRET_${name}`);
    mkdirSync(join(fixture.workspace, "nested"), { recursive: true });
    writeFileSync(join(fixture.workspace, "nested", name), `SECRET_${name}`);
  }
  writeFileSync(join(fixture.workspace, ".npmrc"), "NPM_AUTH_SENTINEL");
  writeFileSync(join(fixture.workspace, "oaf", "receipts", "secret.json"), "SECRET");
  symlinkSync(join(fixture.workspace, "README.md"), join(fixture.workspace, "linked.txt"));
  const verification = await createVerificationWorkspace(fixture.workspace);
  try {
    assert(!lstatSync(join(verification.directory, ".git"), { throwIfNoEntry: false }), "git metadata is not copied");
    for (const name of [".env", ".env.local", ".envrc", ".environment", ".env-secrets"]) assert(!lstatSync(join(verification.directory, name), { throwIfNoEntry: false }) && !lstatSync(join(verification.directory, "nested", name), { throwIfNoEntry: false }), `${name} files are not copied at any depth`);
    assert(!lstatSync(join(verification.directory, ".npmrc"), { throwIfNoEntry: false }), "npm auth config is not copied");
    assert(!lstatSync(join(verification.directory, "node_modules"), { throwIfNoEntry: false }), "node_modules is not copied");
    assert(!lstatSync(join(verification.directory, "oaf", "receipts"), { throwIfNoEntry: false }), "receipts are not copied");
    assert(!lstatSync(join(verification.directory, "linked.txt"), { throwIfNoEntry: false }), "symlinks are not followed or copied");
    writeFileSync(join(verification.directory, "app", "page.tsx"), "changed only in disposable copy");
    writeFileSync(join(verification.directory, "sentinel"), "temporary");
    assert(!readFileSync(join(fixture.workspace, "app", "page.tsx"), "utf8").includes("changed only"), "disposable writes do not alter authoritative project");
    assert(!lstatSync(join(fixture.workspace, "sentinel"), { throwIfNoEntry: false }), "disposable sentinel never reaches authoritative project");
    const argv = buildContainerRun("docker", { command: "pnpm test", cwd: verification.directory, nodeModules: verification.nodeModulesMount });
    assert(argv.includes(`${verification.directory}:/workspace`) && argv.includes(`${join(fixture.workspace, "node_modules")}:/workspace/node_modules:ro`), "verification mount is writable copy with read-only authoritative node_modules");
    assert(argv[argv.indexOf("--network") + 1] === "none", "verification command network is none");
  } finally {
    const path = verification.directory;
    await verification.cleanup();
    assert(!lstatSync(path, { throwIfNoEntry: false }), "disposable workspace cleanup removes temporary files");
  }
  const gitArgv = buildContainerRun("docker", { command: "git status", cwd: fixture.workspace, readOnly: true });
  assert(gitArgv.includes(`${fixture.workspace}:/workspace:ro`), "git inspection mount is read-only");

  await rejects(() => Reflect.apply(runSandboxCommand, undefined, [{ command: "pnpm test", cwd: fixture.workspace }]), "INVALID_ORIGIN", "omitted generic origin fails closed");
  let invalidCalls = 0;
  const invalidDependencies = { detectRuntime: () => { invalidCalls++; return "fake"; }, runContainer: async () => { invalidCalls++; return { exitCode: 0, stdout: "", stderr: "", truncated: false }; } };
  for (const key of ["approvalGranted", "networkGranted", "origin", "confirm", "network", "unknown"]) {
    await rejects(() => runAgentSandboxCommand({ command: "pnpm test", cwd: fixture.workspace, [key]: true, dependencies: invalidDependencies }), "INVALID_AGENT_ARGUMENT", `agent entry rejects ${key}`);
  }
  assert(invalidCalls === 0, "invalid agent entry fields never reach runtime or container seams");
  let compatibleCalls = 0;
  const compatibleDependencies = { detectRuntime: () => { compatibleCalls++; return "fake"; }, runContainer: async () => { compatibleCalls++; return { exitCode: 0, stdout: "", stderr: "", truncated: false }; } };
  class CompatibleOptions { constructor() { this.command = "git status"; this.cwd = fixture.workspace; this.dependencies = compatibleDependencies; } }
  await Reflect.apply(runAgentSandboxCommand, undefined, [new CompatibleOptions()]);
  assert(compatibleCalls === 2, "class instance with allowed fields reaches dependency path");
  const nullPrototypeOptions = Object.create(null);
  nullPrototypeOptions.command = "git status";
  nullPrototypeOptions.cwd = fixture.workspace;
  nullPrototypeOptions.dependencies = compatibleDependencies;
  await Reflect.apply(runAgentSandboxCommand, undefined, [nullPrototypeOptions]);
  assert(compatibleCalls === 4, "null-prototype record with allowed fields reaches dependency path");
  let rejectedRuntimeCalls = 0;
  let rejectedWorkspaceCalls = 0;
  let rejectedContainerCalls = 0;
  const rejectedDependencies = { detectRuntime: () => { rejectedRuntimeCalls++; return "fake"; }, createVerificationWorkspace: async () => { rejectedWorkspaceCalls++; throw new Error("must not run"); }, runContainer: async () => { rejectedContainerCalls++; return { exitCode: 0, stdout: "", stderr: "", truncated: false }; } };
  class UnexpectedOptions { constructor() { this.command = "git status"; this.dependencies = rejectedDependencies; this.unexpected = true; } }
  await rejects(() => Reflect.apply(runAgentSandboxCommand, undefined, [new UnexpectedOptions()]), "INVALID_AGENT_ARGUMENT", "class instance unexpected field is rejected");
  const nullPrototypeUnexpected = Object.create(null);
  nullPrototypeUnexpected.command = "git status";
  nullPrototypeUnexpected.dependencies = rejectedDependencies;
  nullPrototypeUnexpected.unexpected = true;
  await rejects(() => Reflect.apply(runAgentSandboxCommand, undefined, [nullPrototypeUnexpected]), "INVALID_AGENT_ARGUMENT", "null-prototype unexpected field is rejected");
  assert(rejectedRuntimeCalls === 0 && rejectedWorkspaceCalls === 0 && rejectedContainerCalls === 0, "unexpected agent fields never invoke dependencies");
  for (const value of [null, [], () => {}, "options", 1, true, Symbol("options")]) {
    await rejects(() => Reflect.apply(runAgentSandboxCommand, undefined, [value]), "INVALID_AGENT_ARGUMENT", `abnormal agent options are rejected: ${typeof value}`);
  }
  await rejects(() => runAgentSandboxCommand({ command: "pnpm install", cwd: fixture.workspace }), "AGENT_NETWORK_DENIED", "agent entry cannot execute network command");
  await rejects(() => runAgentSandboxCommand({ command: "unknown command", cwd: fixture.workspace }), "AGENT_AUTHORIZATION_REQUIRED", "agent entry cannot execute unknown command");
  await rejects(() => runHumanSandboxCommand({ command: "pnpm install", approvalGranted: false, networkGranted: false, cwd: fixture.workspace }), "POLICY_REJECTED", "human CLI requires trusted flags");
  let humanRuntimeCalls = 0;
  let humanContainerCalls = 0;
  let humanOptions = null;
  const humanResult = await runHumanSandboxCommand({ command: "pnpm install", approvalGranted: true, networkGranted: true, cwd: fixture.workspace, dependencies: {
    detectRuntime: () => { humanRuntimeCalls++; return "fake-runtime"; },
    runContainer: async (options) => { humanContainerCalls++; humanOptions = options; return { exitCode: 0, stdout: "human out", stderr: "human err", truncated: false }; },
  } });
  assert(humanRuntimeCalls === 1 && humanContainerCalls === 1 && humanOptions.command === "pnpm install" && humanOptions.network === true && humanOptions.argv[humanOptions.argv.indexOf("--network") + 1] === "bridge", "trusted human grants reach injected enabled-network sandbox path");
  assert(humanResult.exitCode === 0 && humanResult.stdout === "human out" && humanResult.stderr === "human err", "human injected runner returns deterministic result without real runtime or mutation");

  // Exercise the real agent entry path with a fake container executor.
  let disposablePath = null;
  const malicious = await runAgentSandboxCommand({ command: "pnpm test", cwd: fixture.workspace, dependencies: {
    detectRuntime: () => "fake",
    runContainer: async ({ cwd, argv }) => {
      disposablePath = cwd;
      writeFileSync(join(cwd, "app", "page.tsx"), "malicious rewrite");
      unlinkSync(join(cwd, "app", "layout.tsx"));
      writeFileSync(join(cwd, "malicious-sentinel"), "created");
      assert(argv.includes(`${cwd}:/workspace`) && argv[argv.indexOf("--network") + 1] === "none", "real agent path mounts disposable workspace with network none");
      return { exitCode: 0, stdout: "NPM_AUTH_SENTINEL absent", stderr: "", truncated: false };
    },
  } });
  assert(malicious.exitCode === 0 && malicious.stdout === "NPM_AUTH_SENTINEL absent", "agent runner preserves successful command output");
  assert(!readFileSync(join(fixture.workspace, "app", "page.tsx"), "utf8").includes("malicious") && existsSync(join(fixture.workspace, "app", "layout.tsx")) && !existsSync(join(fixture.workspace, "malicious-sentinel")), "malicious verification cannot alter authoritative project");
  assert(!existsSync(disposablePath), "agent disposable workspace cleans after success");
  let failedPath = null;
  const nonzero = await runAgentSandboxCommand({ command: "pnpm test", cwd: fixture.workspace, dependencies: { detectRuntime: () => "fake", runContainer: async ({ cwd }) => { failedPath = cwd; return { exitCode: 7, stdout: "out", stderr: "err", truncated: false }; } } });
  assert(nonzero.exitCode === 7 && nonzero.stdout === "out" && nonzero.stderr === "err" && !existsSync(failedPath), "nonzero verification result and cleanup are preserved");
  let startupPath = null;
  await rejects(() => runAgentSandboxCommand({ command: "pnpm test", cwd: fixture.workspace, dependencies: { detectRuntime: () => "fake", runContainer: async ({ cwd }) => { startupPath = cwd; throw new SandboxError("SANDBOX_START_FAILED", "test startup failure"); } } }), "SANDBOX_START_FAILED", "container startup failure propagates");
  assert(!existsSync(startupPath), "disposable workspace cleans after startup failure");
  let runtimeCalls = 0;
  const invalid = copyGeneratedAppFixture();
  try { const value = manifest(invalid.workspace); value.scripts.test = "node malicious.mjs"; writeManifest(invalid.workspace, value); await rejects(() => runAgentSandboxCommand({ command: "pnpm test", cwd: invalid.workspace, dependencies: { detectRuntime: () => { runtimeCalls++; return "fake"; } } }), "PACKAGE_SCRIPT_POLICY", "script policy rejects before runtime startup"); assert(runtimeCalls === 0, "script policy does not invoke runtime or container"); } finally { invalid.cleanup(); }
  let gitCwd = null;
  await runAgentSandboxCommand({ command: "git status", cwd: fixture.workspace, dependencies: { detectRuntime: () => "fake", runContainer: async ({ cwd, argv }) => { gitCwd = cwd; assert(argv.includes(`${fixture.workspace}:/workspace:ro`) && argv[argv.indexOf("--network") + 1] === "none", "git runner uses authoritative read-only mount"); return { exitCode: 0, stdout: "", stderr: "", truncated: false }; } } });
  assert(gitCwd === fixture.workspace, "git inspection creates no disposable workspace");
  const stdout = []; const stderr = [];
  await runHumanSandboxCommand({ command: "pnpm test", cwd: fixture.workspace, onStdout: (data) => stdout.push(String(data)), onStderr: (data) => stderr.push(String(data)), dependencies: { detectRuntime: () => "fake", runContainer: async ({ onStdout, onStderr }) => { onStdout?.(Buffer.from("stdout")); onStderr?.(Buffer.from("stderr")); return { exitCode: 0, stdout: "stdout", stderr: "stderr", truncated: false }; } } });
  assert(stdout.join("") === "stdout" && stderr.join("") === "stderr", "human stdout and stderr callbacks route once");
} finally { fixture.cleanup(); }

if (failures > 0) { console.error(`\n${failures} authorization check(s) failed.`); process.exit(1); }
console.log("\nAll agent command-authorization checks passed.");
