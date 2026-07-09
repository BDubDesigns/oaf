// Smoke test for `oaf init` and `oaf doctor`.
// Uses only Node built-ins; no third-party dependencies.
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binPath = join(repoRoot, "bin", "oaf.mjs");
const base = mkdtempSync(join(tmpdir(), "oaf-init-"));

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`PASS  ${msg}`);
  } else {
    console.log(`FAIL  ${msg}`);
    failures++;
  }
}

try {
  const appDir = join(base, "test-app");

  // 1. init creates the skeleton
  execFileSync("node", [binPath, "init", "test-app"], { cwd: base, stdio: "pipe" });
  assert(existsSync(join(appDir, "oaf/app.json")), "oaf/app.json created");
  assert(existsSync(join(appDir, "oaf/stack.json")), "oaf/stack.json created");
  assert(existsSync(join(appDir, "oaf/docs-pack.json")), "oaf/docs-pack.json created");
  assert(existsSync(join(appDir, "README.md")), "README.md created");
  assert(existsSync(join(appDir, "package.json")), "package.json created");
  assert(existsSync(join(appDir, "app/layout.tsx")), "app/layout.tsx created");
  assert(existsSync(join(appDir, "db/client.ts")), "db/client.ts created");
  assert(existsSync(join(appDir, "oaf/doctor.mjs")), "oaf/doctor.mjs created");
  assert(existsSync(join(appDir, "tests/sanity.test.mjs")), "tests/sanity.test.mjs created");

  // 2. doctor passes on the generated app
  const doctorOut = execFileSync("node", [binPath, "doctor"], {
    cwd: appDir,
    stdio: "pipe",
  }).toString();
  assert(doctorOut.includes("PASS"), "doctor passes on generated app");

  // 3. init refuses an existing non-empty directory
  let refusedExisting = false;
  try {
    execFileSync("node", [binPath, "init", "test-app"], { cwd: base, stdio: "pipe" });
  } catch {
    refusedExisting = true;
  }
  assert(refusedExisting, "init refuses existing non-empty directory");

  // 4. init refuses path-traversal names
  let refusedTraversal = false;
  try {
    execFileSync("node", [binPath, "init", "../evil"], { cwd: base, stdio: "pipe" });
  } catch {
    refusedTraversal = true;
  }
  assert(refusedTraversal, "init refuses path-traversal name");
} catch (e) {
  console.error(e);
  failures++;
} finally {
  rmSync(base, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll init smoke tests passed.");
