// OAF-owned command policy. Recordability, lexical classification, execution
// authorization, and package-script trust deliberately remain separate.

import { loadStackSnapshot } from "./stack-snapshot.mjs";

const stack = loadStackSnapshot();

export const CANONICAL_COMMANDS = Object.freeze([
  { command: "pnpm test", name: "test", type: "test", kind: "package" },
  { command: "pnpm lint", name: "lint", type: "lint", kind: "package" },
  { command: "pnpm typecheck", name: "typecheck", type: "typecheck", kind: "package" },
  { command: "pnpm build", name: "build", type: "build", kind: "package" },
  { command: "git status", name: "vcs-status", type: "vcs", kind: "git" },
  { command: "git diff", name: "vcs-diff", type: "vcs", kind: "git" },
  { command: "git log --oneline", name: "vcs-log", type: "vcs", kind: "git" },
]);

export const CANONICAL_COMMAND_SET = new Set(CANONICAL_COMMANDS.map(({ command }) => command));
export const BLESSED_PACKAGE_SCRIPTS = Object.freeze({
  doctor: "node oaf/doctor.mjs",
  test: "node tests/sanity.test.mjs",
});
export const BLESSED_PACKAGE_MANAGER = `pnpm@${stack.runtime.pnpm}`;

export function canonicalCommand(command) {
  return CANONICAL_COMMANDS.find((entry) => entry.command === command) ?? null;
}

export function isVerificationCommand(command) {
  return canonicalCommand(command)?.kind === "package";
}

export function isGitInspectionCommand(command) {
  return canonicalCommand(command)?.kind === "git";
}
