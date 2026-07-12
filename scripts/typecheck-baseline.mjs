import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(root, "tsconfig.json");
const baselinePath = resolve(root, "config", "typecheck-baseline.json");
const BASELINE_ERROR = "Typecheck baseline is invalid.";
const FINGERPRINT = /^TS\d+\|(Warning|Error|Suggestion|Message)\|(?:<config>|[A-Za-z0-9._/-]+)\|[a-f0-9]{64}$/;

/** @typedef {{ fingerprint: string, count: number }} FingerprintCount */
/** @typedef {{ version: 2, diagnostics: FingerprintCount[] }} Baseline */

/** @param {string} projectConfigPath @returns {ts.Diagnostic[]} */
export function collectDiagnostics(projectConfigPath = configPath) {
  const config = ts.readConfigFile(projectConfigPath, ts.sys.readFile);
  const readErrors = config.error ? [config.error] : [];
  if (config.error) return readErrors;

  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(projectConfigPath), undefined, projectConfigPath);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  // Keep every source in order; duplicate diagnostics are counted intentionally.
  return [...readErrors, ...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
}

/** @param {string} projectConfigPath @returns {string[]} */
export function collectDiagnosticFingerprints(projectConfigPath = configPath) {
  return collectDiagnostics(projectConfigPath).map(fingerprint).sort();
}

/** @param {ts.Diagnostic} diagnostic */
function fingerprint(diagnostic) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const hash = createHash("sha256").update(message).digest("hex");
  const category = ts.DiagnosticCategory[diagnostic.category];
  const path = diagnostic.file ? normalizePath(diagnostic.file.fileName) : "<config>";
  return `TS${diagnostic.code}|${category}|${path}|${hash}`;
}

/** @param {string} filePath */
function normalizePath(filePath) {
  const normalized = relative(root, filePath).replaceAll("\\", "/");
  return normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/") ? "<config>" : normalized;
}

/** @param {string[]} fingerprints @returns {FingerprintCount[]} */
export function countFingerprints(fingerprints) {
  const counts = new Map();
  for (const fingerprint of fingerprints) {
    counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
  }
  return [...counts]
    .map(([fingerprint, count]) => ({ fingerprint, count }))
    .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
}

/** @param {unknown} value @returns {Baseline} */
export function validateBaseline(value) {
  if (!isRecord(value)) {
    throw new Error(BASELINE_ERROR);
  }
  if (!hasExactKeys(value, ["version", "diagnostics"]) || value.version !== 2 || !Array.isArray(value.diagnostics)) {
    throw new Error(BASELINE_ERROR);
  }
  const fingerprints = new Set();
  for (const diagnostic of value.diagnostics) {
    if (
      !isRecord(diagnostic) ||
      !hasExactKeys(diagnostic, ["fingerprint", "count"]) ||
      typeof diagnostic.fingerprint !== "string" ||
      !FINGERPRINT.test(diagnostic.fingerprint) ||
      typeof diagnostic.count !== "number" ||
      !Number.isSafeInteger(diagnostic.count) ||
      diagnostic.count <= 0 ||
      fingerprints.has(diagnostic.fingerprint)
    ) {
      throw new Error(BASELINE_ERROR);
    }
    fingerprints.add(diagnostic.fingerprint);
  }
  return /** @type {Baseline} */ (value);
}

/** @param {string} text @returns {Baseline} */
export function parseBaseline(text) {
  try {
    return validateBaseline(JSON.parse(text));
  } catch {
    throw new Error(BASELINE_ERROR);
  }
}

/** @param {FingerprintCount[]} current @param {Baseline} baseline @returns {FingerprintCount[]} */
export function verifyBaseline(current, baseline) {
  const allowed = new Map(baseline.diagnostics.map(({ fingerprint, count }) => [fingerprint, count]));
  return current.filter(({ fingerprint, count }) => count > (allowed.get(fingerprint) ?? 0));
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {Record<string, unknown>} value @param {string[]} keys */
function hasExactKeys(value, keys) {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function writeBaseline() {
  const diagnostics = countFingerprints(collectDiagnosticFingerprints());
  writeFileSync(baselinePath, `${JSON.stringify({ version: 2, diagnostics }, null, 2)}\n`);
  console.log(`Wrote ${diagnostics.length} diagnostic fingerprints (${diagnostics.reduce((total, item) => total + item.count, 0)} diagnostics).`);
}

function checkBaseline() {
  let baseline;
  try {
    baseline = parseBaseline(readFileSync(baselinePath, "utf8"));
  } catch {
    console.error(BASELINE_ERROR);
    process.exitCode = 1;
    return;
  }
  const current = countFingerprints(collectDiagnosticFingerprints());
  const growth = verifyBaseline(current, baseline);
  if (growth.length > 0) {
    console.error(`Typecheck baseline grew by ${growth.reduce((total, item) => total + item.count, 0)} diagnostic(s).`);
    process.exitCode = 1;
    return;
  }
  console.log(`Typecheck baseline passed: ${current.reduce((total, item) => total + item.count, 0)} current diagnostic(s), ${baseline.diagnostics.length} approved fingerprint(s).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--write") writeBaseline();
  else checkBaseline();
}
