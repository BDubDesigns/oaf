import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTestFiles } from "../scripts/run-tests.ts";
import { copyGeneratedAppFixture } from "./generated-app-fixture-helper.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(root, "tests", "fixtures", "node24-native-ts-smoke.ts");
const helper = join(root, "tests", "fixtures", "node24-native-ts-smoke-helper.ts");
const binary = join(root, "bin", "oaf.ts");
const runner = join(root, "scripts", "run-tests.ts");
const usage = `OAF — Opinionated App Factory (Alpha 0)

Usage:
  oaf init <app-name>   Create a new OAF app skeleton
  oaf doctor            Check the current directory is an OAF app
  oaf agent <task>      Run one configured agent task
  oaf --help            Show this help\n`;
const nativeFixtures = [
  ["provider-native-typescript.ts", "provider-native-typescript:ok", "native TypeScript provider modules execute with their explicit .ts imports"],
  ["agent-path-tool-errors-native-typescript.ts", "agent-path-tool-errors-native-typescript:ok", "native TypeScript path and public tool-error modules execute with their explicit .ts imports"],
  ["command-policy-native-typescript.ts", "command-policy-native-typescript:ok", "native TypeScript command policy executes with explicit .ts imports"],
  ["sandbox-native-typescript.ts", "sandbox-native-typescript:ok", "native TypeScript sandbox executes with explicit .ts imports"],
  ["agent-context-native-typescript.ts", "agent-context-native-typescript:ok", "native TypeScript context assembly executes with explicit .ts imports"],
  ["agent-privacy-native-typescript.ts", "agent-privacy-native-typescript:ok", "native TypeScript privacy summaries execute with explicit .ts imports"],
  ["agent-cli-native-typescript.ts", "agent-cli-native-typescript:ok", "native TypeScript agent CLI executes with explicit .ts imports"],
  ["stack-snapshot-native-typescript.ts", "stack-snapshot-native-typescript:ok", "native TypeScript stack snapshot executes with explicit .ts imports"],
  ["templates-native-typescript.ts", "templates-native-typescript:ok", "native TypeScript templates execute with explicit .ts imports"],
  ["doctor-native-typescript.ts", "doctor-native-typescript:ok", "native TypeScript doctor executes with its explicit .ts import"],
] as const;
let failures = 0;

function assert(condition: unknown, message: string): void {
  if (condition) console.log(`PASS  ${message}`);
  else {
    console.log(`FAIL  ${message}`);
    failures++;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readObject(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(value)) throw new Error(`${path} must contain an object`);
  return value;
}

function readString(value: Record<string, unknown>, field: string): string | undefined {
  const fieldValue = value[field];
  return typeof fieldValue === "string" ? fieldValue : undefined;
}

const packageJson = readObject(join(root, "package.json"));
const engines = packageJson.engines;
const runtime = readObject(join(root, "config", "runtime", "oaf-runtime.json"));
const runtimeNode = readString(runtime, "node");
const marker = readFileSync(join(root, ".node-version"), "utf8").trim();
assert(isRecord(engines) && engines.node === runtimeNode, "package engine matches factory runtime pin");
assert(marker === runtimeNode, "local Node marker matches factory runtime pin");
assert(process.versions.node === runtimeNode, "test process uses the approved Node runtime pin");

const typecheckOutput = execFileSync("pnpm", ["typecheck"], { cwd: root, encoding: "utf8" });
assert(typecheckOutput === "", "strict typecheck runs directly without a diagnostic baseline");

const output = execFileSync(process.execPath, [fixture], { encoding: "utf8" });
assert(output.trim() === "native-typescript:ok", "Node directly executes two erasable TypeScript files without a loader");
const fixtureEntries = readdirSync(dirname(fixture));
assert(fixtureEntries.includes("node24-native-ts-smoke-helper.ts"), "smoke imports the explicit .ts helper");
assert(!fixtureEntries.some((name) => /^node24-native-ts-smoke.*\.(?:js|map|tsx)$/.test(name)), "native TypeScript smoke creates no JavaScript, source-map, or TSX output");
for (const [name, expectedOutput, message] of nativeFixtures) {
  const nativeFixture = join(root, "tests", "fixtures", name);
  const fixtureOutput = execFileSync(process.execPath, [nativeFixture], { encoding: "utf8" });
  assert(fixtureOutput.trim() === expectedOutput, message);
}
const copiedFixture = copyGeneratedAppFixture();
try {
  assert(existsSync(copiedFixture.workspace), "native TypeScript fixture helper creates a fresh workspace");
  assert(existsSync(join(copiedFixture.workspace, "oaf", "app.json")), "native TypeScript fixture helper imports directly and copies canonical files");
} finally {
  copiedFixture.cleanup();
}
assert(!existsSync(copiedFixture.workspace), "native TypeScript fixture helper cleanup removes its workspace");
const binaryOutput = execFileSync(process.execPath, [binary, "--help"], { encoding: "utf8" });
assert(binaryOutput === usage, "Node directly executes the TypeScript binary with exact deterministic usage output");
assert(!existsSync(join(root, "bin", "oaf.js")) && !existsSync(join(root, "bin", "oaf.js.map")), "binary execution emits no JavaScript or source map");
assert(
  ![fixture, helper, binary, runner, ...nativeFixtures.map(([name]) => join(root, "tests", "fixtures", name))].some(
    (file) => existsSync(file.replace(/\.ts$/, ".js")) || existsSync(file.replace(/\.ts$/, ".js.map")),
  ),
  "native TypeScript runtime paths emit no JavaScript or source maps",
);

const discoveryRoot = mkdtempSync(join(tmpdir(), "oaf-test-discovery-"));
try {
  const discoveryTests = join(discoveryRoot, "tests");
  mkdirSync(join(discoveryTests, "nested"), { recursive: true });
  for (const name of ["zeta.test.ts", "alpha.test.ts", "ignored.test.mjs", "ignored.test.js", "ignored.test.mts", "ignored.test.cts", "ignored.test.tsx", "contains.test.name", "fixture.ts"]) {
    writeFileSync(join(discoveryTests, name), "");
  }
  writeFileSync(join(discoveryTests, "nested", "nested.test.ts"), "");
  assert(
    JSON.stringify(getTestFiles(discoveryRoot).map((file) => basename(file))) === JSON.stringify(["alpha.test.ts", "zeta.test.ts"]),
    "runner discovers sorted top-level .test.ts files only",
  );
} finally {
  rmSync(discoveryRoot, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log("\nRuntime typecheck foundation checks passed.");
