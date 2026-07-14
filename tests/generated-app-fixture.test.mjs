// Focused test for the representative generated-app fixture.
// Uses only Node built-ins; no dependencies, installs, or network.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { getAppTemplates } from "../lib/templates.ts";
import {
  copyGeneratedAppFixture,
  FIXTURE_CREATED_AT,
  FIXTURE_NAME,
  FIXTURE_TEMPLATE_PATHS,
  GENERATED_APP_FIXTURE,
} from "./generated-app-fixture-helper.mjs";

let failures = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`PASS  ${message}`);
  } else {
    console.log(`FAIL  ${message}`);
    failures++;
  }
}

function walk(root, current = root) {
  const entries = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const fullPath = join(current, entry.name);
    entries.push({ path: relative(root, fullPath), directory: entry.isDirectory() });
    if (entry.isDirectory()) entries.push(...walk(root, fullPath));
  }
  return entries;
}

function matchesTemplate(actual, expected) {
  return actual === expected || actual === `${expected}\n`;
}

const copies = [];
try {
  // 1. The fixture is a recognizable generated OAF app with core markers.
  assert(existsSync(GENERATED_APP_FIXTURE), "checked-in generated-app fixture exists");
  for (const path of [
    "FIXTURE.md",
    "package.json",
    "oaf/app.json",
    "oaf/stack.json",
    "oaf/docs-pack.json",
    "oaf/doctor.mjs",
    "app/page.tsx",
    "features/example-feature/index.ts",
    "tests/sanity.test.mjs",
  ]) {
    assert(existsSync(join(GENERATED_APP_FIXTURE, path)), `fixture core path exists: ${path}`);
  }

  const packageJson = JSON.parse(readFileSync(join(GENERATED_APP_FIXTURE, "package.json"), "utf8"));
  assert(packageJson.packageManager === "pnpm@11.5.2", "fixture uses the canonical pnpm metadata");
  assert(packageJson.scripts.test === "node tests/sanity.test.mjs", "fixture exposes dependency-free validation");

  // 2. Curated generated files must stay aligned with the real init template.
  const templates = getAppTemplates(FIXTURE_NAME, FIXTURE_CREATED_AT);
  for (const path of FIXTURE_TEMPLATE_PATHS) {
    assert(path in templates, `fixture retained path remains generated: ${path}`);
    assert(
      matchesTemplate(readFileSync(join(GENERATED_APP_FIXTURE, path), "utf8"), templates[path]),
      `fixture matches current init template: ${path}`,
    );
  }

  // 3. The fixture must not contain dependency, build/cache, or secret files.
  const forbiddenDirectories = new Set(["node_modules", ".next", "dist", "build", ".cache", "coverage", ".turbo"]);
  const fixtureEntries = walk(GENERATED_APP_FIXTURE);
  const forbiddenDirectoryPaths = fixtureEntries
    .filter((entry) => entry.directory && forbiddenDirectories.has(entry.path.split(/[\\/]/).at(-1)))
    .map((entry) => entry.path);
  const environmentPaths = fixtureEntries
    .filter((entry) => /^\.env(?:\.|$)/.test(entry.path.split(/[\\/]/).at(-1)))
    .map((entry) => entry.path);
  const secretPaths = fixtureEntries
    .filter((entry) => /^(credentials\.json|id_rsa|.*\.(pem|key))$/i.test(entry.path.split(/[\\/]/).at(-1)))
    .map((entry) => entry.path);
  assert(forbiddenDirectoryPaths.length === 0, "fixture has no dependency/build/cache directories");
  assert(environmentPaths.length === 0, "fixture has no environment files");
  assert(secretPaths.length === 0, "fixture has no obvious secret files");

  // 4. Copies are independent and the source fixture is never mutated.
  const sourcePage = readFileSync(join(GENERATED_APP_FIXTURE, "app/page.tsx"), "utf8");
  const first = copyGeneratedAppFixture();
  const second = copyGeneratedAppFixture();
  copies.push(first, second);
  assert(first.workspace !== second.workspace, "fixture helper creates distinct temporary workspaces");
  assert(statSync(first.workspace).isDirectory() && statSync(second.workspace).isDirectory(), "fixture copies are directories");

  writeFileSync(join(first.workspace, "app/page.tsx"), "export default function Changed() { return null; }\n");
  assert(
    readFileSync(join(second.workspace, "app/page.tsx"), "utf8") === sourcePage,
    "mutation of one fixture copy leaves the other copy unchanged",
  );
  assert(
    readFileSync(join(GENERATED_APP_FIXTURE, "app/page.tsx"), "utf8") === sourcePage,
    "mutation of a copy leaves the checked-in fixture unchanged",
  );

  // 5. Offline validation is the real generated skeleton validation, not a fake package command.
  const doctorOutput = execFileSync("node", ["oaf/doctor.mjs"], { cwd: second.workspace, stdio: "pipe" }).toString();
  assert(/Doctor: this is a valid OAF Alpha 0 app skeleton/.test(doctorOutput), "fixture doctor passes offline");
  const sanityOutput = execFileSync("node", ["tests/sanity.test.mjs"], { cwd: second.workspace, stdio: "pipe" }).toString();
  assert(/All sanity checks passed/.test(sanityOutput), "fixture sanity test passes offline");
} finally {
  for (const copy of copies) copy.cleanup();
}

if (failures > 0) {
  console.error(`\n${failures} fixture check(s) failed.`);
  process.exit(1);
}
console.log("\nAll generated-app fixture checks passed.");
