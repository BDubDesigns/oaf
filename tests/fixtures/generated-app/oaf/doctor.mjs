#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";

const REQUIRED_FILES = [
  "oaf/app.json",
  "oaf/stack.json",
  "oaf/docs-pack.json",
  "README.md",
  "package.json",
];
const REQUIRED_DIRS = [
  "app", "components", "features", "lib", "server",
  "db", "tests", "e2e", "public", "docs", "oaf",
];

const dir = process.cwd();
let failed = 0;
for (const f of REQUIRED_FILES) {
  const ok = existsSync(join(dir, f));
  console.log((ok ? "PASS" : "FAIL") + "  " + f);
  if (!ok) failed++;
}
for (const d of REQUIRED_DIRS) {
  const ok = existsSync(join(dir, d));
  console.log((ok ? "PASS" : "FAIL") + "  " + d + "/");
  if (!ok) failed++;
}
if (failed > 0) {
  console.error("\n" + failed + " check(s) failed. This is not a valid OAF app.");
  process.exit(1);
}
console.log("\nDoctor: this is a valid OAF Alpha 0 app skeleton.");
