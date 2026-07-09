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
  "app",
  "components",
  "features",
  "lib",
  "server",
  "db",
  "tests",
  "e2e",
  "public",
  "docs",
  "oaf",
];

// Checks whether `dir` (default: current working directory) looks like a
// canonical OAF Alpha 0 app. Returns an array of { ok, label }.
export function checkApp(dir = process.cwd()) {
  const results = [];
  for (const f of REQUIRED_FILES) {
    results.push({ ok: existsSync(join(dir, f)), label: f });
  }
  for (const d of REQUIRED_DIRS) {
    results.push({ ok: existsSync(join(dir, d)), label: `${d}/` });
  }
  return results;
}
