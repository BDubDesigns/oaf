import {
  BLESSED_PACKAGE_MANAGER,
  BLESSED_PACKAGE_SCRIPTS,
  CANONICAL_COMMANDS,
  canonicalCommand,
  isGitInspectionCommand,
  isVerificationCommand,
  type CanonicalCommand,
} from "../../lib/command-policy.ts";

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;
type ExpectedCommand = "pnpm test" | "pnpm lint" | "pnpm typecheck" | "pnpm build" | "git status" | "git diff" | "git log --oneline";
type ExpectedName = "test" | "lint" | "typecheck" | "build" | "vcs-status" | "vcs-diff" | "vcs-log";
type ExpectedType = "test" | "lint" | "typecheck" | "build" | "vcs";

type CommandIsExact = Assert<Equal<CanonicalCommand["command"], ExpectedCommand>>;
type NameIsExact = Assert<Equal<CanonicalCommand["name"], ExpectedName>>;
type TypeIsExact = Assert<Equal<CanonicalCommand["type"], ExpectedType>>;
type KindIsExact = Assert<Equal<CanonicalCommand["kind"], "package" | "git">>;
type LookupSignature = Assert<Equal<typeof canonicalCommand, (command: string) => CanonicalCommand | null>>;
type VerificationSignature = Assert<Equal<typeof isVerificationCommand, (command: string) => boolean>>;
type GitSignature = Assert<Equal<typeof isGitInspectionCommand, (command: string) => boolean>>;
type ScriptsAreExact = Assert<Equal<typeof BLESSED_PACKAGE_SCRIPTS, Readonly<{ doctor: "node oaf/doctor.mjs"; test: "node tests/sanity.test.mjs" }>>>;
type PackageManagerIsString = Assert<Equal<typeof BLESSED_PACKAGE_MANAGER, string>>;

const command: ExpectedCommand = CANONICAL_COMMANDS[0].command;
const name: ExpectedName = CANONICAL_COMMANDS[0].name;
const type: ExpectedType = CANONICAL_COMMANDS[0].type;
const kind: "package" | "git" = CANONICAL_COMMANDS[0].kind;
const found: CanonicalCommand | null = canonicalCommand("pnpm test");
const verification: boolean = isVerificationCommand("pnpm test");
const gitInspection: boolean = isGitInspectionCommand("git status");
const doctor: "node oaf/doctor.mjs" = BLESSED_PACKAGE_SCRIPTS.doctor;
const test: "node tests/sanity.test.mjs" = BLESSED_PACKAGE_SCRIPTS.test;

// @ts-expect-error Canonical command strings are closed to the seven owned commands.
const arbitraryCommand: CanonicalCommand = { command: "pnpm dev", name: "dev", type: "dev", kind: "package" };
// @ts-expect-error Canonical records cannot use a noncanonical kind.
const arbitraryKind: CanonicalCommand = { command: "pnpm test", name: "test", type: "test", kind: "shell" };
if (false) {
  // @ts-expect-error Canonical records are readonly.
  CANONICAL_COMMANDS[0].command = "pnpm dev";
  // @ts-expect-error The canonical command array is readonly.
  CANONICAL_COMMANDS.push(CANONICAL_COMMANDS[0]);
  // @ts-expect-error Blessed package scripts are readonly.
  BLESSED_PACKAGE_SCRIPTS.test = "pnpm test";
}

const compileProof: [CommandIsExact, NameIsExact, TypeIsExact, KindIsExact, LookupSignature, VerificationSignature, GitSignature, ScriptsAreExact, PackageManagerIsString] = [true, true, true, true, true, true, true, true, true];
void [compileProof, command, name, type, kind, found, verification, gitInspection, doctor, test, arbitraryCommand, arbitraryKind];
process.stdout.write("command-policy-native-typescript:ok");
