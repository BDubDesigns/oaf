import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { SpawnSyncReturns } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binary = join(root, "bin", "oaf.ts");
const usage = `OAF — Opinionated App Factory (Alpha 0)

Usage:
  oaf init <app-name>   Create a new OAF app skeleton
  oaf doctor            Check the current directory is an OAF app
  oaf agent <task>      Run one configured agent task
  oaf --help            Show this help\n`;
let failures = 0;

/** @param {boolean} condition @param {string} message */
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`PASS  ${message}`);
  else {
    console.log(`FAIL  ${message}`);
    failures++;
  }
}

/** @param {string[]} args @param {string} [cwd] */
function runNode(args: string[], cwd: string = root): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [binary, ...args], { cwd, encoding: "utf8" });
}

/** @param {string[]} args @param {string} [cwd] */
function runDirect(args: string[], cwd: string = root): SpawnSyncReturns<string> {
  return spawnSync("./bin/oaf.ts", args, { cwd, encoding: "utf8" });
}

assert(existsSync(binary), "TypeScript root binary exists");
assert(!existsSync(join(root, "bin", "oaf.mjs")), "JavaScript root compatibility binary is absent");
assert((statSync(binary).mode & 0o111) !== 0, "TypeScript root binary is executable");

const nodeHelp = runNode(["--help"]);
const directHelp = runDirect(["--help"]);
assert(nodeHelp.status === 0 && directHelp.status === 0, "Node and direct TypeScript help invocations succeed");
assert(nodeHelp.stdout === directHelp.stdout && nodeHelp.stderr === directHelp.stderr && nodeHelp.status === directHelp.status, "Node and direct invocations have identical output and status");
assert(nodeHelp.stdout === usage && nodeHelp.stderr === "", "help output is byte-for-byte exact");

for (const args of [[], ["--help"], ["-h"], ["--help", "ignored"], ["-h", "ignored"]]) {
  const result = runNode(args);
  assert(result.status === 0 && result.stdout === usage && result.stderr === "", `help dispatch is exact for ${args.join(" ") || "no command"}`);
}

const unknown = runNode(["unknown"]);
assert(unknown.status === 1 && unknown.stdout === usage && unknown.stderr === "Unknown command: unknown\n\n", "unknown command preserves streams, blank line, and status");

const temporary = mkdtempSync(join(tmpdir(), "oaf-binary-"));
try {
  const missing = runNode(["init"], temporary);
  assert(missing.status === 1 && missing.stdout === "" && missing.stderr === `Error: app name is required.\n\n${usage}`, "missing app name preserves usage failure output");
  for (const [name, message] of [["..", "Error: app name must not contain \"..\".\n"], ["one/two", "Error: app name must not contain path separators.\n"], ["one\\two", "Error: app name must not contain path separators.\n"]]) {
    const result = runNode(["init", name], temporary);
    assert(result.status === 1 && result.stdout === "" && result.stderr === message, `init rejects ${name} with exact preflight output`);
  }

  const occupied = join(temporary, "occupied");
  mkdirSync(occupied);
  writeFileSync(join(occupied, "marker"), "x");
  const conflict = runNode(["init", "occupied"], temporary);
  assert(conflict.status === 1 && conflict.stdout === "" && conflict.stderr === `Error: target path already exists and is not empty: ${occupied}\n`, "init rejects non-empty targets exactly");

  mkdirSync(join(temporary, "empty"));
  const empty = runNode(["init", "empty"], temporary);
  assert(empty.status === 0 && empty.stdout === `Created OAF app "empty" at ${join(temporary, "empty")}\nNext: cd empty && oaf doctor\n` && empty.stderr === "", "init permits empty targets");

  const extra = runNode(["init", "first", "ignored"], temporary);
  assert(extra.status === 0 && existsSync(join(temporary, "first", "oaf", "app.json")) && !existsSync(join(temporary, "ignored")), "init ignores arguments after the app name");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

const noSandbox = runNode(["sandbox"]);
assert(noSandbox.status === 1 && noSandbox.stdout === "Usage:\n  oaf sandbox run <command>\n  oaf sandbox status\n" && noSandbox.stderr === "Unknown sandbox command: (none)\n\n", "missing sandbox subcommand preserves streams and blank line");
const unknownSandbox = runNode(["sandbox", "unknown"]);
assert(unknownSandbox.status === 1 && unknownSandbox.stdout === "Usage:\n  oaf sandbox run <command>\n  oaf sandbox status\n" && unknownSandbox.stderr === "Unknown sandbox command: unknown\n\n", "unknown sandbox subcommand preserves streams and blank line");
const missingSandboxCommand = runNode(["sandbox", "run"]);
assert(missingSandboxCommand.status === 1 && missingSandboxCommand.stdout === "" && missingSandboxCommand.stderr === "Error: sandbox run requires a command.\n\n  oaf sandbox run <command>\n", "sandbox run requires a command exactly");
const blockedSandbox = runNode(["sandbox", "run", "sudo", "--network", "rm", "--confirm", "-rf", "/"]);
assert(blockedSandbox.status === 1 && blockedSandbox.stdout === "" && blockedSandbox.stderr === "[sandbox] blocked: command matches a denied pattern.\n", "sandbox removes recognized flags before blocked-command dispatch");

const agentOption = runNode(["agent", "task", "--option"]);
assert(agentOption.status === 2 && agentOption.stdout === "" && agentOption.stderr === "Error: agent command does not support options.\n", "agent options reject before provider configuration");

if (failures > 0) process.exit(1);
console.log("\nBinary dispatch checks passed.");
