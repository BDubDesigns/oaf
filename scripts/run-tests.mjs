import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} projectRoot */
export function getTestFiles(projectRoot = root) {
  return readdirSync(join(projectRoot, "tests"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => join(projectRoot, "tests", entry.name))
    .sort();
}

export function runTests() {
  const testFiles = getTestFiles();
  console.log(`Running ${testFiles.length} top-level test suite(s).`);
  for (const testFile of testFiles) {
    console.log(`\n=== ${testFile.slice(root.length + 1)} ===`);
    const result = spawnSync(process.execPath, [testFile], { cwd: root, stdio: "inherit" });
    if (result.error || result.status !== 0 || result.signal) {
      process.exitCode = result.status && result.status > 0 ? result.status : 1;
      return;
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runTests();
