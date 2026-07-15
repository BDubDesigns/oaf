import { deepEqual, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BLESSED_PACKAGE_MANAGER,
  BLESSED_PACKAGE_SCRIPTS,
  CANONICAL_COMMANDS,
  canonicalCommand,
  isGitInspectionCommand,
  isVerificationCommand,
} from "../lib/command-policy.ts";
import type { CanonicalCommand } from "../lib/command-policy.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expected: readonly CanonicalCommand[] = [
  { command: "pnpm test", name: "test", type: "test", kind: "package" },
  { command: "pnpm lint", name: "lint", type: "lint", kind: "package" },
  { command: "pnpm typecheck", name: "typecheck", type: "typecheck", kind: "package" },
  { command: "pnpm build", name: "build", type: "build", kind: "package" },
  { command: "git status", name: "vcs-status", type: "vcs", kind: "git" },
  { command: "git diff", name: "vcs-diff", type: "vcs", kind: "git" },
  { command: "git log --oneline", name: "vcs-log", type: "vcs", kind: "git" },
];

strictEqual(CANONICAL_COMMANDS.length, 7, "canonical command list has seven entries");
deepEqual(CANONICAL_COMMANDS, expected, "canonical command records retain their exact ordered vocabulary");
for (const command of CANONICAL_COMMANDS) deepEqual(Object.keys(command), ["command", "name", "type", "kind"], `${command.command} has exactly four fields`);
strictEqual(new Set(CANONICAL_COMMANDS.map((entry) => entry.command)).size, 7, "canonical command strings are unique");
strictEqual(new Set(CANONICAL_COMMANDS.map((entry) => entry.name)).size, 7, "canonical command names are unique");

for (const entry of CANONICAL_COMMANDS) {
  strictEqual(canonicalCommand(entry.command), entry, `${entry.command} returns its shared canonical record`);
  strictEqual(isVerificationCommand(entry.command), entry.kind === "package", `${entry.command} package classification is exact`);
  strictEqual(isGitInspectionCommand(entry.command), entry.kind === "git", `${entry.command} Git classification is exact`);
}

for (const command of [" pnpm test", "pnpm test ", "PNPM TEST", "pnpm test; pnpm install", "pnpm test && echo hi", "pnpm test --watch", "git status --short", "git log", "pnpm dev", "", "unknown"]) {
  strictEqual(canonicalCommand(command), null, `${JSON.stringify(command)} is noncanonical`);
  strictEqual(isVerificationCommand(command), false, `${JSON.stringify(command)} is not package verification`);
  strictEqual(isGitInspectionCommand(command), false, `${JSON.stringify(command)} is not Git inspection`);
}

strictEqual(Object.isFrozen(CANONICAL_COMMANDS), true, "canonical command array is frozen");
for (const entry of CANONICAL_COMMANDS) strictEqual(Object.isFrozen(entry), true, `${entry.command} record is frozen`);
strictEqual(Object.isFrozen(BLESSED_PACKAGE_SCRIPTS), true, "blessed scripts are frozen");
try { Reflect.set(CANONICAL_COMMANDS[0], "command", "pnpm dev"); } catch {}
try { Reflect.apply(Array.prototype.push, CANONICAL_COMMANDS, [expected[0]]); } catch {}
try { Reflect.set(BLESSED_PACKAGE_SCRIPTS, "test", "pnpm test"); } catch {}
deepEqual(CANONICAL_COMMANDS, expected, "mutation attempts cannot alter canonical policy");
deepEqual(BLESSED_PACKAGE_SCRIPTS, { doctor: "node oaf/doctor.mjs", test: "node tests/sanity.test.mjs" }, "blessed scripts retain their exact definitions");

const stack: unknown = JSON.parse(readFileSync(resolve(root, "config", "stack", "oaf-stack-0.1.json"), "utf8"));
const runtime = stack !== null && typeof stack === "object" ? Reflect.get(stack, "runtime") : undefined;
const pnpm = runtime !== null && typeof runtime === "object" ? Reflect.get(runtime, "pnpm") : undefined;
if (typeof pnpm !== "string") throw new Error("stack snapshot runtime.pnpm is invalid");
strictEqual(BLESSED_PACKAGE_MANAGER, `pnpm@${pnpm}`, "blessed package manager derives from the validated stack snapshot");
for (const malformed of [null, [], {}, true, 1]) {
  strictEqual(Reflect.apply(canonicalCommand, null, [malformed]), null, `${String(malformed)} safely returns no canonical command`);
  strictEqual(Reflect.apply(isVerificationCommand, null, [malformed]), false, `${String(malformed)} safely returns false for package verification`);
  strictEqual(Reflect.apply(isGitInspectionCommand, null, [malformed]), false, `${String(malformed)} safely returns false for Git inspection`);
}

console.log("Command policy tests passed.");
