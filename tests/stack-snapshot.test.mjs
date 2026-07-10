// Focused test for the authoritative OAF Stack 0.1 snapshot.
// Uses only Node built-ins; normal checks remain offline and deterministic.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAppTemplates } from "../lib/templates.mjs";
import { loadStackSnapshot, validateStackSnapshot } from "../lib/stack-snapshot.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = join(repoRoot, "config", "stack", "oaf-stack-0.1.json");
const verificationPath = join(repoRoot, "docs", "stack-0.1-verification.md");
const fixtureRoot = join(repoRoot, "tests", "fixtures", "generated-app");
const docsPackManifestPath = join(repoRoot, "docs-packs", "stack-0.1", "manifest.json");

let failures = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`PASS  ${message}`);
  } else {
    console.log(`FAIL  ${message}`);
    failures++;
  }
}

function throws(action, pattern, message) {
  try {
    action();
    assert(false, message);
  } catch (error) {
    assert(pattern.test(error.message), message);
  }
}

const EXPECTED_KEYS = {
  runtime: ["node", "pnpm"],
  framework: ["next", "react", "reactDom", "typescript"],
  data: ["postgresImage", "drizzleOrm", "drizzleKit", "pg"],
  app: ["betterAuth", "zod", "tailwindcss", "tailwindPostcss"],
  testing: ["vitest", "playwright"],
};

const COMPONENT_KEYS = Object.entries(EXPECTED_KEYS).flatMap(([section, keys]) =>
  keys.map((key) => `${section}.${key}`),
);

// 1. Snapshot exists and has the locked, exact contract.
assert(existsSync(snapshotPath), "authoritative Stack 0.1 config exists");
const snapshot = loadStackSnapshot();
assert(snapshot.id === "0.1.0", "snapshot ID is exactly 0.1.0");
assert(snapshot.status === "locked", "snapshot status is locked");
assert(/^\d{4}-\d{2}-\d{2}$/.test(snapshot.verifiedAt), "snapshot has an ISO verifiedAt date");
assert(snapshot.framework.react === snapshot.framework.reactDom, "React and React DOM match exactly");

for (const [section, expectedKeys] of Object.entries(EXPECTED_KEYS)) {
  const keys = Object.keys(snapshot[section]).sort();
  assert(
    JSON.stringify(keys) === JSON.stringify([...expectedKeys].sort()),
    `${section} contains every expected component exactly once`,
  );
}

for (const [section, expectedKeys] of Object.entries(EXPECTED_KEYS)) {
  for (const key of expectedKeys) {
    const value = snapshot[section][key];
    assert(typeof value === "string" && value.length > 0, `${section}.${key} is non-empty`);
    if (key === "postgresImage") {
      assert(/^postgres:\d+\.\d+-[a-z0-9]+$/.test(value), "postgres image tag is exact and non-floating");
    } else {
      assert(/^\d+\.\d+\.\d+$/.test(value), `${section}.${key} is an exact stable version`);
      assert(!/(latest|\^|~|\*|x|alpha|beta|canary|nightly|rc)/i.test(value), `${section}.${key} has no range or prerelease token`);
    }
  }
}

// 2. Loader validation is strict and callers cannot mutate shared state.
const unknownSection = JSON.parse(JSON.stringify(snapshot));
unknownSection.extra = {};
throws(
  () => validateStackSnapshot(unknownSection),
  /unknown, missing, or malformed top-level sections/,
  "snapshot validation rejects unknown top-level sections",
);
const unresolvedVersion = JSON.parse(JSON.stringify(snapshot));
unresolvedVersion.framework.next = "^16.2.7";
throws(
  () => validateStackSnapshot(unresolvedVersion),
  /exact stable version/,
  "snapshot validation rejects unresolved versions",
);
const callerCopy = loadStackSnapshot();
callerCopy.runtime.pnpm = "0.0.0";
assert(loadStackSnapshot().runtime.pnpm === snapshot.runtime.pnpm, "loader returns a caller-owned copy");
let serializable = true;
try {
  JSON.parse(JSON.stringify(snapshot));
} catch {
  serializable = false;
}
assert(serializable, "snapshot loader returns JSON-serializable data");

// 3. Generated metadata and checked-in fixture metadata derive from the lock.
const templates = getAppTemplates("stack-test", "2000-01-01T00:00:00.000Z");
const templatePackage = JSON.parse(templates["package.json"]);
const templateStack = JSON.parse(templates["oaf/stack.json"]);
const templateDocsPack = JSON.parse(templates["oaf/docs-pack.json"]);
assert(templatePackage.packageManager === `pnpm@${snapshot.runtime.pnpm}`, "template pnpm metadata agrees with snapshot");
assert(templateStack.oafStack === snapshot.id, "generated oaf/stack.json agrees with snapshot ID");
assert(
  templateDocsPack.oafStack === snapshot.id && templateDocsPack.docsPack === snapshot.docsPack,
  "generated docs-pack marker agrees with snapshot identity",
);

const rootPackage = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const fixturePackage = JSON.parse(readFileSync(join(fixtureRoot, "package.json"), "utf8"));
const fixtureStack = JSON.parse(readFileSync(join(fixtureRoot, "oaf/stack.json"), "utf8"));
assert(rootPackage.packageManager === `pnpm@${snapshot.runtime.pnpm}`, "repository pnpm metadata agrees with snapshot");
assert(fixturePackage.packageManager === `pnpm@${snapshot.runtime.pnpm}`, "fixture pnpm metadata agrees with snapshot");
assert(fixtureStack.oafStack === snapshot.id, "fixture oaf/stack.json agrees with snapshot ID");

const docsPackManifest = JSON.parse(readFileSync(docsPackManifestPath, "utf8"));
assert(
  docsPackManifest.oafStack === snapshot.id && docsPackManifest.docsPack === snapshot.docsPack,
  "docs-pack manifest agrees with snapshot identity",
);

// 4. Verification evidence is checked in for every locked component.
assert(existsSync(verificationPath), "stack verification record exists");
const verification = readFileSync(verificationPath, "utf8");
assert(verification.includes(`- **Verified:** ${snapshot.verifiedAt}`), "verification record carries snapshot verifiedAt");
for (const key of COMPONENT_KEYS) {
  const row = verification.split("\n").find((line) => line.startsWith(`| \`${key}\` |`));
  assert(!!row, `verification record covers ${key}`);
  assert(/\| \d{4}-\d{2}-\d{2} \|/.test(row || ""), `verification record has an ISO release date for ${key}`);
}
assert(!/Candidate snapshot — not a final lock/.test(readFileSync(join(repoRoot, "docs", "stack-snapshots.md"), "utf8")), "human docs no longer label Stack 0.1 values as candidates");

if (failures > 0) {
  console.error(`\n${failures} stack snapshot check(s) failed.`);
  process.exit(1);
}
console.log("\nAll Stack 0.1 snapshot checks passed.");
