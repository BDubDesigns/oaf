import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTestFiles } from "../scripts/run-tests.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = join(root, ".github", "workflows", "ci.yml");
const EXPECTED_TESTS = [
  "tests/agent-cli.test.mjs",
  "tests/agent-command-authorization.test.mjs",
  "tests/agent-command-tool.test.mjs",
  "tests/agent-context.test.mjs",
  "tests/agent-contracts.test.mjs",
  "tests/agent-diagnostics.test.mjs",
  "tests/agent-event-privacy.test.mjs",
  "tests/agent-events.test.mjs",
  "tests/agent-loop.test.mjs",
  "tests/agent-path-policy.test.mjs",
  "tests/agent-privacy.test.mjs",
  "tests/agent-public-tool-errors.test.mjs",
  "tests/agent-read-tools.test.mjs",
  "tests/agent-receipt.test.mjs",
  "tests/agent-tools.test.mjs",
  "tests/agent-write-tool.test.mjs",
  "tests/ci-config.test.mjs",
  "tests/command-policy.test.mjs",
  "tests/doctor.test.mjs",
  "tests/generated-app-fixture.test.mjs",
  "tests/oaf-binary.test.mjs",
  "tests/oaf-init.test.mjs",
  "tests/openai-compatible-provider.test.mjs",
  "tests/runtime-typecheck-foundation.test.mjs",
  "tests/sandbox.test.mjs",
  "tests/stack-snapshot.test.mjs",
  "tests/templates.test.mjs",
];
let failures = 0;

/** @param {unknown} condition @param {string} message */
function assert(condition, message) {
  if (condition) console.log(`PASS  ${message}`);
  else {
    console.log(`FAIL  ${message}`);
    failures++;
  }
}

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const runtime = JSON.parse(readFileSync(join(root, "config", "runtime", "oaf-runtime.json"), "utf8"));
const marker = readFileSync(join(root, ".node-version"), "utf8").trim();
assert(packageJson.scripts.test === "node scripts/run-tests.mjs", "pnpm test invokes the complete test runner");
assert(packageJson.engines.node === runtime.node && marker === runtime.node, "factory Node declarations are consistent");
assert(packageJson.packageManager === "pnpm@11.5.2", "package manager declaration remains exact");

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
