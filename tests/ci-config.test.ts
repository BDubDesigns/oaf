import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTestFiles } from "../scripts/run-tests.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = join(root, ".github", "workflows", "ci.yml");
const EXPECTED_TESTS = [
  "tests/agent-cli.test.ts",
  "tests/agent-command-authorization.test.ts",
  "tests/agent-command-tool.test.ts",
  "tests/agent-context.test.ts",
  "tests/agent-contracts.test.ts",
  "tests/agent-diagnostics.test.ts",
  "tests/agent-event-privacy.test.ts",
  "tests/agent-events.test.ts",
  "tests/agent-loop.test.ts",
  "tests/agent-path-policy.test.ts",
  "tests/agent-privacy.test.ts",
  "tests/agent-public-tool-errors.test.ts",
  "tests/agent-read-tools.test.ts",
  "tests/agent-receipt.test.ts",
  "tests/agent-tools.test.ts",
  "tests/agent-write-tool.test.ts",
  "tests/ci-config.test.ts",
  "tests/command-policy.test.ts",
  "tests/doctor.test.ts",
  "tests/generated-app-fixture.test.ts",
  "tests/oaf-binary.test.ts",
  "tests/oaf-init.test.ts",
  "tests/openai-compatible-provider.test.ts",
  "tests/runtime-typecheck-foundation.test.ts",
  "tests/sandbox.test.ts",
  "tests/stack-snapshot.test.ts",
  "tests/templates.test.ts",
];
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

function readScripts(value: Record<string, unknown>): Record<string, unknown> {
  const scripts = value.scripts;
  if (!isRecord(scripts)) throw new Error("package scripts must be an object");
  return scripts;
}

function readEngines(value: Record<string, unknown>): Record<string, unknown> {
  const engines = value.engines;
  if (!isRecord(engines)) throw new Error("package engines must be an object");
  return engines;
}

function readString(value: Record<string, unknown>, field: string): string | undefined {
  const fieldValue = value[field];
  return typeof fieldValue === "string" ? fieldValue : undefined;
}

const packageJson = readObject(join(root, "package.json"));
const runtime = readObject(join(root, "config", "runtime", "oaf-runtime.json"));
const marker = readFileSync(join(root, ".node-version"), "utf8").trim();
assert(readScripts(packageJson).test === "node scripts/run-tests.ts", "pnpm test invokes the complete test runner");
assert(readScripts(packageJson).typecheck === "tsc --noEmit --pretty false", "pnpm typecheck invokes direct strict TypeScript checking");
assert(readEngines(packageJson).node === readString(runtime, "node") && marker === readString(runtime, "node"), "factory Node declarations are consistent");
assert(readString(packageJson, "packageManager") === "pnpm@11.5.2", "package manager declaration remains exact");

const discoveredTests = getTestFiles().map((path) => relative(root, path).replaceAll("\\", "/"));
assert(JSON.stringify(discoveredTests) === JSON.stringify(EXPECTED_TESTS), "runner discovers the expected sorted top-level suites");

assert(existsSync(workflowPath), "CI workflow exists");
const workflow = readFileSync(workflowPath, "utf8");
const checkoutAction = "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683";
const setupNodeAction = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020";
assert(workflow.includes(checkoutAction), "workflow uses the exact pinned checkout action");
assert(workflow.includes(setupNodeAction), "workflow uses the exact pinned setup-node action");
assert(workflow.includes("persist-credentials: false"), "checkout disables persisted credentials");
for (const required of [
  "permissions:\n  contents: read",
  "pnpm install --frozen-lockfile",
  "pnpm typecheck",
  "pnpm test",
  "node bin/oaf.ts --help",
  "node ../../../bin/oaf.ts doctor",
  "node tests/fixtures/node24-native-ts-smoke.ts",
  "node-version-file: .node-version",
  "corepack install",
  "git status --porcelain --untracked-files=all",
]) {
  assert(workflow.includes(required), `workflow includes ${required}`);
}
assert(!/(?:secrets|openai|anthropic|api[_-]?key|docker|podman)/i.test(workflow), "workflow contains no provider secret, provider, or container command");
assert(!workflow.includes("GITHUB_TOKEN"), "workflow does not expose the GitHub token");

if (failures > 0) process.exit(1);
console.log("\nCI configuration checks passed.");
