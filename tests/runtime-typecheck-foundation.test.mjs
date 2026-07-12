import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectDiagnosticFingerprints, countFingerprints, verifyBaseline } from "../scripts/typecheck-baseline.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(root, "tests", "fixtures", "node24-native-ts-smoke.ts");
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
assert(packageJson.engines.node === runtime.node, "package engine matches factory runtime pin");
assert(marker === runtime.node, "local Node marker matches factory runtime pin");
assert(process.versions.node === runtime.node, "test process uses the approved Node runtime pin");

const output = execFileSync(process.execPath, [fixture], { encoding: "utf8" });
assert(output.trim() === "native-typescript:ok", "Node directly executes erasable TypeScript without a loader");
assert(!readdirSync(dirname(fixture)).some((name) => name.startsWith("node24-native-ts-smoke.") && name !== "node24-native-ts-smoke.ts"), "native TypeScript smoke creates no build output");

const baseline = JSON.parse(readFileSync(join(root, "config", "typecheck-baseline.json"), "utf8"));
const current = countFingerprints(collectDiagnosticFingerprints());
assert(existsSync(join(root, "config", "typecheck-baseline.json")), "machine-readable typecheck baseline exists");
assert(verifyBaseline(current, baseline).length === 0, "baseline rejects no current diagnostic growth");
assert(
  verifyBaseline(
    [{ fingerprint: "TS9999|tests/example.mjs|1:1", count: 2 }],
    { diagnostics: [{ fingerprint: "TS9999|tests/example.mjs|1:1", count: 1 }] },
  ).length === 1,
  "baseline detects a growing diagnostic count",
);

if (failures > 0) process.exit(1);
console.log("\nRuntime typecheck foundation checks passed.");
