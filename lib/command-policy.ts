// OAF-owned command policy. Recordability, lexical classification, execution
// authorization, and package-script trust deliberately remain separate.

import { loadStackSnapshot } from "./stack-snapshot.ts";

const stack = loadStackSnapshot() as { runtime: { pnpm: string } };

const canonicalCommands = [
  Object.freeze({ command: "pnpm test", name: "test", type: "test", kind: "package" } as const),
  Object.freeze({ command: "pnpm lint", name: "lint", type: "lint", kind: "package" } as const),
  Object.freeze({ command: "pnpm typecheck", name: "typecheck", type: "typecheck", kind: "package" } as const),
  Object.freeze({ command: "pnpm build", name: "build", type: "build", kind: "package" } as const),
  Object.freeze({ command: "git status", name: "vcs-status", type: "vcs", kind: "git" } as const),
  Object.freeze({ command: "git diff", name: "vcs-diff", type: "vcs", kind: "git" } as const),
  Object.freeze({ command: "git log --oneline", name: "vcs-log", type: "vcs", kind: "git" } as const),
] as const;

export const CANONICAL_COMMANDS = Object.freeze(canonicalCommands);
export type CanonicalCommand = (typeof CANONICAL_COMMANDS)[number];

export const BLESSED_PACKAGE_SCRIPTS = Object.freeze({
  doctor: "node oaf/doctor.mjs",
  test: "node tests/sanity.test.mjs",
} as const);
export const BLESSED_PACKAGE_MANAGER = `pnpm@${stack.runtime.pnpm}`;

export function canonicalCommand(command: string): CanonicalCommand | null {
  if (typeof command !== "string") return null;
  return CANONICAL_COMMANDS.find((entry) => entry.command === command) ?? null;
}

export function isVerificationCommand(command: string): boolean {
  return canonicalCommand(command)?.kind === "package";
}

export function isGitInspectionCommand(command: string): boolean {
  return canonicalCommand(command)?.kind === "git";
}
