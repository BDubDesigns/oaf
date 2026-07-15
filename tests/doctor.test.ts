import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DoctorCheck, DoctorCheckLabel } from "../lib/doctor.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binPath = join(root, "bin", "oaf.ts");
const labels: DoctorCheckLabel[] = [
  "oaf/app.json",
  "oaf/stack.json",
  "oaf/docs-pack.json",
  "README.md",
  "package.json",
  "app/",
  "components/",
  "features/",
  "lib/",
  "server/",
  "db/",
  "tests/",
  "e2e/",
  "public/",
  "docs/",
  "oaf/",
];
const files = labels.slice(0, 5);
const directories = labels.slice(5).map((label) => label.slice(0, -1));
/** @type {string[]} */
const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const path = mkdtempSync(join(tmpdir(), "oaf-doctor-"));
  temporaryRoots.push(path);
  return path;
}

/** @param {string} rootPath @param {string} relativePath */
function createFile(rootPath: string, relativePath: string): void {
  mkdirSync(dirname(join(rootPath, relativePath)), { recursive: true });
  writeFileSync(join(rootPath, relativePath), "");
}

/** @param {string} rootPath */
function populate(rootPath: string): void {
  for (const file of files) createFile(rootPath, file);
  for (const directory of directories) mkdirSync(join(rootPath, directory), { recursive: true });
}

/** @param {string} cwd */
function runDoctor(cwd: string) {
  return spawnSync(process.execPath, [binPath, "doctor"], { cwd, encoding: "utf8" });
}

const importDirectory = temporaryRoot();
const originalDirectory = process.cwd();
/** @type {typeof import("../lib/doctor.ts").checkApp} */
let checkApp: (dir?: string) => DoctorCheck[];
try {
  process.chdir(importDirectory);
  const doctor = await import("../lib/doctor.ts");
  checkApp = doctor.checkApp;
} finally {
  process.chdir(originalDirectory);
}

try {
  const empty = temporaryRoot();
  const emptyResults = checkApp(empty);
  assert.deepEqual(emptyResults, labels.map((label) => ({ ok: false, label })), "empty roots return the exact ordered failures");
  for (const result of emptyResults) {
    assert.deepEqual(Object.keys(result), ["ok", "label"], "results have no extra fields");
    assert.equal("path" in result, false, "results do not expose absolute paths");
  }

  const complete = temporaryRoot();
  populate(complete);
  assert.deepEqual(checkApp(complete), labels.map((label) => ({ ok: true, label })), "complete roots pass all checks in order");

  const partial = temporaryRoot();
  createFile(partial, "README.md");
  mkdirSync(join(partial, "components"));
  mkdirSync(join(partial, "docs"));
  const partialResults = checkApp(partial);
  assert.equal(partialResults.length, 16, "partial roots still return all checks");
  assert.deepEqual(partialResults.map((result) => result.label), labels, "partial roots preserve result order");
  assert.equal(partialResults[3].ok, true, "existing required files pass");
  assert.equal(partialResults[6].ok, true, "existing required directories pass");
  assert.equal(partialResults[14].ok, true, "later existing directories pass");
  assert.equal(partialResults[0].ok, false, "missing files fail");
  assert.equal(partialResults[5].ok, false, "missing directories fail");

  const fileAsDirectory = temporaryRoot();
  mkdirSync(join(fileAsDirectory, "README.md"));
  assert.equal(checkApp(fileAsDirectory)[3].ok, true, "directories at required file paths count as present");
  const directoryAsFile = temporaryRoot();
  createFile(directoryAsFile, "components");
  assert.equal(checkApp(directoryAsFile)[6].ok, true, "files at required directory paths count as present");

  const firstCurrentDirectory = temporaryRoot();
  const secondCurrentDirectory = temporaryRoot();
  createFile(secondCurrentDirectory, "README.md");
  try {
    process.chdir(firstCurrentDirectory);
    assert.equal(checkApp()[3].ok, false, "omitted directories use the current directory at call time");
    process.chdir(secondCurrentDirectory);
    assert.equal(checkApp()[3].ok, true, "later calls observe changed current directories");
    assert.deepEqual(checkApp(undefined), checkApp(), "explicit undefined uses the call-time current directory");
  } finally {
    process.chdir(originalDirectory);
  }

  const firstResults = checkApp(empty);
  const secondResults = checkApp(empty);
  assert.notStrictEqual(firstResults, secondResults, "calls return fresh arrays");
  assert.notStrictEqual(firstResults[0], secondResults[0], "calls return fresh result objects");
  firstResults[0].ok = true;
  firstResults.push({ ok: true, label: "app/" });
  assert.equal(secondResults[0].ok, false, "result mutations do not affect later calls");
  assert.equal(secondResults.length, 16, "array mutations do not affect later calls");

  for (const value of [null, 1, Symbol("directory"), {}]) {
    assert.throws(
      () => Reflect.apply(checkApp, undefined, [value]),
      (error: unknown) => error instanceof TypeError && (!("code" in error) || Reflect.get(error, "code") === "ERR_INVALID_ARG_TYPE"),
      "invalid JavaScript directories retain native TypeErrors",
    );
  }

  const successfulDoctor = runDoctor(complete);
  assert.equal(successfulDoctor.status, 0, "complete roots make the binary succeed");
  assert.equal(successfulDoctor.stderr, "", "successful doctor writes no failures");
  assert.equal(
    successfulDoctor.stdout,
    `${labels.map((label) => `PASS  ${label}`).join("\n")}\n\nDoctor: this is a valid OAF Alpha 0 app skeleton.\n`,
    "successful doctor output is exact",
  );

  const failedDoctor = runDoctor(empty);
  assert.notEqual(failedDoctor.status, 0, "empty roots make the binary fail");
  assert.equal(failedDoctor.stdout, `${labels.map((label) => `FAIL  ${label}`).join("\n")}\n`, "failed doctor lines are exact");
  assert.equal(failedDoctor.stderr, "\n16 check(s) failed. This is not a valid OAF app.\n", "failed doctor summary is exact");
} finally {
  process.chdir(originalDirectory);
  for (const path of temporaryRoots) rmSync(path, { recursive: true, force: true });
}

console.log("Doctor checks passed.");
