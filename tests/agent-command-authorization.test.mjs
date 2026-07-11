// Command authorization and repository-script trust checks. No container daemon
// is required: policy failures occur before runtime discovery.
import { lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildContainerRun, createVerificationWorkspace, runSandboxCommand, SandboxError, verifyPackageScript } from "../lib/sandbox.mjs";
import { runAgentLoop } from "../lib/agent/loop.mjs";
import { copyGeneratedAppFixture } from "./generated-app-fixture-helper.mjs";

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
  const shell = copyGeneratedAppFixture();
  try { writeFileSync(join(shell.workspace, ".npmrc"), "script-shell=/bin/sh\n"); await rejects(() => verifyPackageScript(shell.workspace, "pnpm test"), "PACKAGE_SCRIPT_POLICY", "custom script shell fails closed"); } finally { shell.cleanup(); }
  const hook = copyGeneratedAppFixture();
  try { writeFileSync(join(hook.workspace, ".pnpmfile.cjs"), "module.exports = {}\n"); await rejects(() => verifyPackageScript(hook.workspace, "pnpm test"), "PACKAGE_SCRIPT_POLICY", "repository pnpm hook fails closed"); } finally { hook.cleanup(); }
  const linked = copyGeneratedAppFixture();
  try { const packagePath = join(linked.workspace, "package.json"); rmSync(packagePath); symlinkSync(join(linked.workspace, "README.md"), packagePath); await rejects(() => verifyPackageScript(linked.workspace, "pnpm test"), "PACKAGE_SCRIPT_POLICY", "symlinked package.json fails closed"); } finally { linked.cleanup(); }

  // Package verification copies only safe regular project files and always cleans up.
  mkdirSync(join(fixture.workspace, ".git"));
  mkdirSync(join(fixture.workspace, "node_modules"));
  writeFileSync(join(fixture.workspace, ".env"), "SECRET");
  writeFileSync(join(fixture.workspace, "oaf", "receipts", "secret.json"), "SECRET");
  symlinkSync(join(fixture.workspace, "README.md"), join(fixture.workspace, "linked.txt"));
  const verification = await createVerificationWorkspace(fixture.workspace);
  try {
    assert(!lstatSync(join(verification.directory, ".git"), { throwIfNoEntry: false }), "git metadata is not copied");
    assert(!lstatSync(join(verification.directory, ".env"), { throwIfNoEntry: false }), "env files are not copied");
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

  await rejects(() => runSandboxCommand({ command: "pnpm install", origin: "agent", approvalGranted: true, networkGranted: true, cwd: fixture.workspace }), "AGENT_NETWORK_DENIED", "agent cannot self-authorize network command");
  await rejects(() => runSandboxCommand({ command: "unknown command", origin: "agent", approvalGranted: true, cwd: fixture.workspace }), "AGENT_AUTHORIZATION_REQUIRED", "agent cannot self-authorize unknown command");
  await rejects(() => runSandboxCommand({ command: "pnpm install", origin: "human_cli", approvalGranted: false, networkGranted: false, cwd: fixture.workspace }), "POLICY_REJECTED", "human CLI requires trusted flags");
  let humanAuthorizationReached = false;
  try {
    await runSandboxCommand({ command: "pnpm install", origin: "human_cli", approvalGranted: true, networkGranted: true, cwd: fixture.workspace });
    humanAuthorizationReached = true;
  } catch (error) {
    humanAuthorizationReached = error instanceof SandboxError && error.code === "SANDBOX_UNAVAILABLE";
  }
  assert(humanAuthorizationReached, "trusted human CLI flags reach sandbox authorization path");
} finally { fixture.cleanup(); }

if (failures > 0) { console.error(`\n${failures} authorization check(s) failed.`); process.exit(1); }
console.log("\nAll agent command-authorization checks passed.");
