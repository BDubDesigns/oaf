import { existsSync } from "node:fs";
import { join } from "node:path";

const checks = [
  ["oaf/app.json", "oaf/app.json"],
  ["oaf/stack.json", "oaf/stack.json"],
  ["oaf/docs-pack.json", "oaf/docs-pack.json"],
  ["README.md", "README.md"],
  ["package.json", "package.json"],
  ["app", "app"],
  ["components", "components"],
  ["features", "features"],
  ["lib", "lib"],
  ["server", "server"],
  ["db", "db"],
  ["tests", "tests"],
  ["e2e", "e2e"],
  ["public", "public"],
  ["docs", "docs"],
];

let failed = 0;
for (const [label, rel] of checks) {
  const ok = existsSync(rel);
  console.log((ok ? "PASS" : "FAIL") + "  " + label);
  if (!ok) failed++;
}
if (failed > 0) {
  console.error("\n" + failed + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll sanity checks passed.");
