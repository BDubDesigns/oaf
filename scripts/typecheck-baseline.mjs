import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(root, "tsconfig.json");
const baselinePath = resolve(root, "config", "typecheck-baseline.json");

/** @typedef {{ fingerprint: string, count: number }} FingerprintCount */

export function collectDiagnosticFingerprints() {
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) return [fingerprint(config.error)];
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, configPath);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  return ts
    .getPreEmitDiagnostics(program)
    .map(fingerprint)
    .sort();
}

/** @param {ts.Diagnostic} diagnostic */
function fingerprint(diagnostic) {
  const file = diagnostic.file;
  const position = file && diagnostic.start !== undefined ? file.getLineAndCharacterOfPosition(diagnostic.start) : undefined;
  const path = file ? relative(root, file.fileName).replaceAll("\\", "/") : "<config>";
  const location = position ? `${position.line + 1}:${position.character + 1}` : "0:0";
  return `TS${diagnostic.code}|${path}|${location}`;
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

/** @param {FingerprintCount[]} current @param {{ diagnostics: FingerprintCount[] }} baseline @returns {FingerprintCount[]} */
export function verifyBaseline(current, baseline) {
  const allowed = new Map(baseline.diagnostics.map(({ fingerprint, count }) => [fingerprint, count]));
  return current.filter(({ fingerprint, count }) => count > (allowed.get(fingerprint) ?? 0));
}

function writeBaseline() {
  const diagnostics = countFingerprints(collectDiagnosticFingerprints());
  writeFileSync(baselinePath, `${JSON.stringify({ version: 1, diagnostics }, null, 2)}\n`);
  console.log(`Wrote ${diagnostics.length} diagnostic fingerprints (${diagnostics.reduce((total, item) => total + item.count, 0)} diagnostics).`);
}

function checkBaseline() {
  const current = countFingerprints(collectDiagnosticFingerprints());
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const growth = verifyBaseline(current, baseline);
  if (growth.length > 0) {
    console.error(`Typecheck baseline grew by ${growth.reduce((total, item) => total + item.count, 0)} diagnostic(s):`);
    for (const item of growth) console.error(`${item.count} ${item.fingerprint}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Typecheck baseline passed: ${current.reduce((total, item) => total + item.count, 0)} current diagnostic(s), ${baseline.diagnostics.length} approved fingerprint(s).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--write") writeBaseline();
  else checkBaseline();
}
