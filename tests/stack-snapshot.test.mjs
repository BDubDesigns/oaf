// Focused tests for the authoritative OAF Stack 0.1 snapshot.
// Uses only Node built-ins; normal checks remain offline and deterministic.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAppTemplates } from "../lib/templates.mjs";
import { loadStackSnapshot, validateStackSnapshot } from "../lib/stack-snapshot.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = join(repoRoot, "config", "stack", "oaf-stack-0.1.json");
const verificationPath = join(repoRoot, "docs", "stack-0.1-verification.md");
const fixtureRoot = join(repoRoot, "tests", "fixtures", "generated-app");
const docsPackManifestPath = join(repoRoot, "docs-packs", "stack-0.1", "manifest.json");
const EXPECTED_KEYS = {
  runtime: ["node", "pnpm"],
  framework: ["next", "react", "reactDom", "typescript"],
  data: ["postgresImage", "drizzleOrm", "drizzleKit", "pg"],
  app: ["betterAuth", "zod", "tailwindcss", "tailwindPostcss"],
  testing: ["vitest", "playwright"],
};
const COMPONENT_KEYS = Object.entries(EXPECTED_KEYS).flatMap(([section, keys]) => keys.map((key) => `${section}.${key}`));

let failures = 0;
/** @param {unknown} condition @param {string} message */
function assert(condition, message) {
  if (condition) console.log(`PASS  ${message}`);
  else {
    console.log(`FAIL  ${message}`);
    failures++;
  }
}

/** @param {() => unknown} action @param {string} message @param {string} expected */
function throws(action, message, expected) {
  try {
    action();
    assert(false, message);
  } catch (error) {
    assert(error instanceof Error && error.message === expected, message);
  }
}

/** @param {unknown} value */
function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

/** @param {string} section @param {object} value @param {string[]} expectedKeys */
function assertSectionKeys(section, value, expectedKeys) {
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort()), `${section} contains every expected component exactly once`);
}

function validSnapshot() {
  return copy(loadStackSnapshot());
}

// Snapshot exists and has the locked, exact contract.
assert(existsSync(snapshotPath), "authoritative Stack 0.1 config exists");
const snapshot = loadStackSnapshot();
assert(snapshot.id === "0.1.0", "snapshot ID is exactly 0.1.0");
assert(snapshot.status === "locked", "snapshot status is locked");
assert(/^\d{4}-\d{2}-\d{2}$/.test(snapshot.verifiedAt), "snapshot has an ISO verifiedAt date");
assert(snapshot.framework.react === snapshot.framework.reactDom, "React and React DOM match exactly");
assertSectionKeys("runtime", snapshot.runtime, EXPECTED_KEYS.runtime);
assertSectionKeys("framework", snapshot.framework, EXPECTED_KEYS.framework);
assertSectionKeys("data", snapshot.data, EXPECTED_KEYS.data);
assertSectionKeys("app", snapshot.app, EXPECTED_KEYS.app);
assertSectionKeys("testing", snapshot.testing, EXPECTED_KEYS.testing);

// Object boundary and exact-key compatibility retain the existing semantics.
for (const value of [null, [], "snapshot", 1, () => {}]) {
  throws(() => validateStackSnapshot(value), `top-level ${value === null ? "null" : typeof value} is rejected`, "stack snapshot has unknown, missing, or malformed top-level sections");
}
assert(validateStackSnapshot(validSnapshot()) !== null, "ordinary objects are accepted");
const nullPrototype = Object.assign(Object.create(null), validSnapshot());
assert(validateStackSnapshot(nullPrototype) === nullPrototype, "null-prototype objects are accepted");
class SnapshotInstance {}
const instance = Object.assign(new SnapshotInstance(), validSnapshot());
assert(validateStackSnapshot(instance) === instance, "class instances are accepted");
const missingTopLevel = validSnapshot();
delete missingTopLevel.testing;
throws(() => validateStackSnapshot(missingTopLevel), "missing top-level key is rejected", "stack snapshot has unknown, missing, or malformed top-level sections");
const extraTopLevel = validSnapshot();
extraTopLevel.extra = true;
throws(() => validateStackSnapshot(extraTopLevel), "extra enumerable own top-level key is rejected", "stack snapshot has unknown, missing, or malformed top-level sections");
const inheritedTopLevel = Object.create({ testing: validSnapshot().testing });
Object.assign(inheritedTopLevel, validSnapshot());
delete inheritedTopLevel.testing;
inheritedTopLevel.placeholder = true;
assert(validateStackSnapshot(inheritedTopLevel) === inheritedTopLevel, "inherited top-level required keys are accepted when enumerable own-key count matches");
const nonEnumerableTopLevel = validSnapshot();
Object.defineProperty(nonEnumerableTopLevel, "extra", { value: true });
assert(validateStackSnapshot(nonEnumerableTopLevel) === nonEnumerableTopLevel, "non-enumerable top-level extras are ignored");
const symbolTopLevel = validSnapshot();
symbolTopLevel[Symbol("extra")] = true;
assert(validateStackSnapshot(symbolTopLevel) === symbolTopLevel, "symbol top-level extras are ignored");
/** @type {Record<string, unknown>} */
const reordered = {};
for (const key of Object.keys(validSnapshot()).reverse()) reordered[key] = validSnapshot()[key];
assert(validateStackSnapshot(reordered).id === "0.1.0", "top-level key order does not matter");

// Identity, literals, docs-pack rules, and date behavior.
const identity = validSnapshot();
assert(validateStackSnapshot(identity) === identity, "validation returns the original object reference");
const wrongId = validSnapshot();
wrongId.id = "0.1";
throws(() => validateStackSnapshot(wrongId), "wrong ID is rejected", "stack snapshot id must be 0.1.0");
const wrongStatus = validSnapshot();
wrongStatus.status = "open";
throws(() => validateStackSnapshot(wrongStatus), "wrong status is rejected", "stack snapshot status must be locked");
for (const [value, accepted] of [["stack-0.1", true], ["STACK_0.1", true], [".stack", false], ["stack/0.1", false], ["../stack", false], ["stack 0.1", false], [1, false]]) {
  const candidate = validSnapshot();
  candidate.docsPack = value;
  if (accepted) assert(validateStackSnapshot(candidate) === candidate, `docsPack ${String(value)} is accepted`);
  else throws(() => validateStackSnapshot(candidate), `docsPack ${String(value)} is rejected`, "stack snapshot docsPack must be a known identifier");
}
const malformedDate = validSnapshot();
malformedDate.verifiedAt = "2026/07/10";
throws(() => validateStackSnapshot(malformedDate), "malformed date shape is rejected", "stack snapshot verifiedAt must be an ISO date");
const parseFailureDate = validSnapshot();
parseFailureDate.verifiedAt = "2026-99-99";
throws(() => validateStackSnapshot(parseFailureDate), "unparseable date is rejected", "stack snapshot verifiedAt is not a real date");
const parsedCalendarDate = validSnapshot();
parsedCalendarDate.verifiedAt = "2026-02-31";
assert(validateStackSnapshot(parsedCalendarDate) === parsedCalendarDate, "Date.parse-accepted calendar-looking date remains accepted");

// Every section retains its exact key and object behavior.
for (const [section, keys] of Object.entries(EXPECTED_KEYS)) {
  const valid = validSnapshot();
  assert(validateStackSnapshot(valid) === valid, `${section} valid exact shape is accepted`);
  const missing = validSnapshot();
  delete missing[section][keys[0]];
  throws(() => validateStackSnapshot(missing), `${section} missing key is rejected`, `stack snapshot ${section} section has unknown, missing, or malformed values`);
  const extra = validSnapshot();
  extra[section].extra = true;
  throws(() => validateStackSnapshot(extra), `${section} extra enumerable own key is rejected`, `stack snapshot ${section} section has unknown, missing, or malformed values`);
  const nonObject = validSnapshot();
  nonObject[section] = "not-an-object";
  throws(() => validateStackSnapshot(nonObject), `${section} non-object is rejected`, `stack snapshot ${section} section has unknown, missing, or malformed values`);
  const array = validSnapshot();
  array[section] = [];
  throws(() => validateStackSnapshot(array), `${section} array is rejected`, `stack snapshot ${section} section has unknown, missing, or malformed values`);
}
const inheritedRuntime = Object.create({ pnpm: snapshot.runtime.pnpm });
inheritedRuntime.node = snapshot.runtime.node;
inheritedRuntime.placeholder = true;
const inheritedSection = validSnapshot();
inheritedSection.runtime = inheritedRuntime;
assert(validateStackSnapshot(inheritedSection) === inheritedSection, "inherited section required keys are accepted when enumerable own-key count matches");

// Version, image, and cross-field validation retain their exact expressions.
const versionCases = [["1.2.3", true], ["^1.2.3", false], ["~1.2.3", false], ["1.2.*", false], ["1.2.3-rc.1", false], [" 1.2.3 ", false], [1, false]];
for (const [value, accepted] of versionCases) {
  const candidate = validSnapshot();
  candidate.framework.next = value;
  if (accepted) assert(validateStackSnapshot(candidate) === candidate, `version ${String(value)} is accepted`);
  else throws(() => validateStackSnapshot(candidate), `version ${String(value)} is rejected`, "framework.next must be an exact stable version");
}
const missingVersion = validSnapshot();
delete missingVersion.framework.next;
throws(() => validateStackSnapshot(missingVersion), "missing component is rejected by section shape", "stack snapshot framework section has unknown, missing, or malformed values");
for (const [value, accepted] of [[snapshot.data.postgresImage, true], ["postgres:latest", false], ["postgres:18.3-BOOKWORM", false], ["postgres:18.3-", false], ["postgres:18-bookworm", false], [1, false]]) {
  const candidate = validSnapshot();
  candidate.data.postgresImage = value;
  if (accepted) assert(validateStackSnapshot(candidate) === candidate, `Postgres image ${String(value)} is accepted`);
  else throws(() => validateStackSnapshot(candidate), `Postgres image ${String(value)} is rejected`, "data.postgresImage must be an exact postgres image tag");
}
const mismatch = validSnapshot();
mismatch.framework.reactDom = "0.0.0";
throws(() => validateStackSnapshot(mismatch), "React mismatch is rejected", "framework.react and framework.reactDom must match exactly");

// Loader returns independent caller-owned JSON data and templates retain lock-derived output.
const firstLoad = loadStackSnapshot();
const secondLoad = loadStackSnapshot();
assert(firstLoad !== secondLoad, "separate loads return separate top-level objects");
assert(firstLoad.runtime !== secondLoad.runtime && firstLoad.framework !== secondLoad.framework, "separate loads return separate nested section objects");
firstLoad.runtime.pnpm = "0.0.0";
assert(secondLoad.runtime.pnpm === snapshot.runtime.pnpm, "mutating one load cannot affect another");
assert(JSON.stringify(secondLoad) === JSON.stringify(JSON.parse(readFileSync(snapshotPath, "utf8"))), "loaded values match the checked-in config");
let serializable = true;
try { JSON.parse(JSON.stringify(secondLoad)); } catch { serializable = false; }
assert(serializable, "snapshot loader returns JSON-serializable data");
const templates = getAppTemplates("stack-test", "2000-01-01T00:00:00.000Z");
const templatePackage = JSON.parse(templates["package.json"]);
const templateStack = JSON.parse(templates["oaf/stack.json"]);
const templateDocsPack = JSON.parse(templates["oaf/docs-pack.json"]);
assert(templatePackage.packageManager === `pnpm@${snapshot.runtime.pnpm}`, "template pnpm metadata agrees with snapshot");
assert(templateStack.oafStack === snapshot.id, "generated oaf/stack.json agrees with snapshot ID");
assert(templateDocsPack.oafStack === snapshot.id && templateDocsPack.docsPack === snapshot.docsPack, "generated docs-pack marker agrees with snapshot identity");
for (const path of ["package.json", "oaf/app.json", "oaf/stack.json", "oaf/docs-pack.json", "oaf/doctor.mjs", "tests/sanity.test.mjs", "docker-compose.yml", "Dockerfile", "README.md"]) {
  assert(Object.hasOwn(templates, path), `template tree retains ${path}`);
}

// Existing snapshot evidence remains tied to the immutable lock.
const rootPackage = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const fixturePackage = JSON.parse(readFileSync(join(fixtureRoot, "package.json"), "utf8"));
const fixtureStack = JSON.parse(readFileSync(join(fixtureRoot, "oaf/stack.json"), "utf8"));
assert(rootPackage.packageManager === `pnpm@${snapshot.runtime.pnpm}`, "repository pnpm metadata agrees with snapshot");
assert(fixturePackage.packageManager === `pnpm@${snapshot.runtime.pnpm}`, "fixture pnpm metadata agrees with snapshot");
assert(fixtureStack.oafStack === snapshot.id, "fixture oaf/stack.json agrees with snapshot ID");
const docsPackManifest = JSON.parse(readFileSync(docsPackManifestPath, "utf8"));
assert(docsPackManifest.oafStack === snapshot.id && docsPackManifest.docsPack === snapshot.docsPack, "docs-pack manifest agrees with snapshot identity");
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
