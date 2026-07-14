import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectDiagnosticFingerprints,
  collectDiagnostics,
  countFingerprints,
  isValidFingerprint,
  parseBaseline,
  validateBaseline,
  verifyBaseline,
} from "../scripts/typecheck-baseline.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(root, "tests", "fixtures", "node24-native-ts-smoke.ts");
const helper = join(root, "tests", "fixtures", "node24-native-ts-smoke-helper.ts");
const providerFixture = join(root, "tests", "fixtures", "provider-native-typescript.ts");
const toolExecutionFixture = join(root, "tests", "fixtures", "agent-tool-execution-native-typescript.ts");
const fingerprint = `TS9999|Error|tests/example.mjs|${"a".repeat(64)}`;
let failures = 0;

/** @param {unknown} condition @param {string} message */
function assert(condition, message) {
  if (condition) console.log(`PASS  ${message}`);
  else {
    console.log(`FAIL  ${message}`);
    failures++;
  }
}

/** @param {() => unknown} action @param {string} message */
function throws(action, message) {
  try {
    action();
    assert(false, message);
  } catch (error) {
    assert(error instanceof Error && error.message === "Typecheck baseline is invalid.", message);
  }
}

/** @param {string} path @param {string} [hash] */
function fingerprintForPath(path, hash = "a") {
  return `TS9999|Error|${path}|${hash.repeat(64)}`;
}

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const runtime = JSON.parse(readFileSync(join(root, "config", "runtime", "oaf-runtime.json"), "utf8"));
const marker = readFileSync(join(root, ".node-version"), "utf8").trim();
assert(packageJson.engines.node === runtime.node, "package engine matches factory runtime pin");
assert(marker === runtime.node, "local Node marker matches factory runtime pin");
assert(process.versions.node === runtime.node, "test process uses the approved Node runtime pin");

const output = execFileSync(process.execPath, [fixture], { encoding: "utf8" });
assert(output.trim() === "native-typescript:ok", "Node directly executes two erasable TypeScript files without a loader");
const fixtureEntries = readdirSync(dirname(fixture));
assert(fixtureEntries.includes("node24-native-ts-smoke-helper.ts"), "smoke imports the explicit .ts helper");
assert(!fixtureEntries.some((name) => /^node24-native-ts-smoke.*\.(?:js|map|tsx)$/.test(name)), "native TypeScript smoke creates no JavaScript, source-map, or TSX output");
const providerOutput = execFileSync(process.execPath, [providerFixture], { encoding: "utf8" });
assert(providerOutput.trim() === "provider-native-typescript:ok", "native TypeScript provider modules execute with their explicit .ts imports");

const baseline = parseBaseline(readFileSync(join(root, "config", "typecheck-baseline.json"), "utf8"));
const current = countFingerprints(collectDiagnosticFingerprints());
assert(existsSync(join(root, "config", "typecheck-baseline.json")), "machine-readable typecheck baseline exists");
assert(verifyBaseline(current, baseline).length === 0, "baseline accepts current or reduced diagnostics");
assert(
  verifyBaseline([{ fingerprint: fingerprintForPath("tests/new-example.mjs", "b"), count: 1 }], { version: 2, diagnostics: [] }).length === 1,
  "baseline rejects a valid new fingerprint",
);
assert(
  verifyBaseline([{ fingerprint, count: 2 }], { version: 2, diagnostics: [{ fingerprint, count: 1 }] }).length === 1,
  "baseline rejects existing count growth",
);
assert(
  verifyBaseline([{ fingerprint, count: 1 }], { version: 2, diagnostics: [{ fingerprint, count: 2 }] }).length === 0,
  "baseline accepts a reduced count",
);
assert(verifyBaseline([], { version: 2, diagnostics: [{ fingerprint, count: 1 }] }).length === 0, "baseline accepts a removed fingerprint");
assert(countFingerprints([fingerprint, fingerprint])[0].count === 2, "identical diagnostics are counted without deduplication");
throws(() => validateBaseline({ version: 1, diagnostics: [] }), "unsupported schema version is rejected");
throws(() => validateBaseline({ version: 2, diagnostics: [{ fingerprint, count: 0 }] }), "malformed baseline record is rejected");
throws(() => validateBaseline({ version: 2, diagnostics: [], extra: true }), "extra baseline fields are rejected");
throws(() => validateBaseline({ version: 2, diagnostics: [{ fingerprint, count: 1, extra: true }] }), "extra baseline record fields are rejected");
throws(() => validateBaseline({ version: 2, diagnostics: [{ fingerprint, count: 1 }, { fingerprint, count: 1 }] }), "duplicate fingerprint record is rejected");
throws(() => parseBaseline("{"), "malformed baseline JSON is rejected");
for (const path of ["/home/user/oaf/lib/file.mjs", "../outside.mjs", "lib/../../outside.mjs", "lib//file.mjs", "lib\\file.mjs", "C:/repo/file.mjs", "lib/"]) {
  throws(() => validateBaseline({ version: 2, diagnostics: [{ fingerprint: fingerprintForPath(path), count: 1 }] }), `invalid fingerprint path is rejected: ${path}`);
}
for (const path of ["bin/oaf.mjs", "lib/agent/provider.ts", "scripts/typecheck-baseline.mjs", "tests/fixtures/example.ts", ".config/example.mjs"]) {
  assert(isValidFingerprint(fingerprintForPath(path)), `valid project-relative fingerprint path is accepted: ${path}`);
}
assert(baseline.diagnostics.every((diagnostic) => isValidFingerprint(diagnostic.fingerprint)), "every committed baseline fingerprint is valid");

const tempRoot = mkdtempSync(join(tmpdir(), "oaf-typecheck-config-"));
try {
  const tempConfig = join(tempRoot, "tsconfig.json");
  writeFileSync(tempConfig, JSON.stringify({ compilerOptions: { definitelyUnknownCompilerOption: true }, files: [] }));
  const configDiagnostics = countFingerprints(collectDiagnosticFingerprints(tempConfig));
  assert(configDiagnostics.some((item) => /^TS5023\|Error\|<config>\|/.test(item.fingerprint)), "unknown compiler option is collected as a config diagnostic");
  assert(verifyBaseline(configDiagnostics, { version: 2, diagnostics: [] }).length > 0, "unbaselined config diagnostic causes baseline growth");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

const newFiles = new Set([
  join(root, "scripts", "typecheck-baseline.mjs"),
  fileURLToPath(import.meta.url),
  fixture,
  helper,
  providerFixture,
  toolExecutionFixture,
]);
assert(!collectDiagnostics().some((diagnostic) => diagnostic.file && newFiles.has(diagnostic.file.fileName)), "new typecheck infrastructure is type-clean");

if (failures > 0) process.exit(1);
console.log("\nRuntime typecheck foundation checks passed.");
