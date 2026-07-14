// Byte-level regression coverage for the canonical generated-app tree.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getAppTemplates } from "../lib/templates.ts";
import { BLESSED_PACKAGE_MANAGER, BLESSED_PACKAGE_SCRIPTS } from "../lib/command-policy.ts";
import { loadStackSnapshot } from "../lib/stack-snapshot.ts";

const NAME = "generated-app-fixture";
const CREATED_AT = "2000-01-01T00:00:00.000Z";
const EXPECTED_ENTRIES = [
  ["README.md", 932, "8007167013c876097628ff3423556d8f8398d131819bbea69758b167dcc73022"],
  ["package.json", 189, "cb49561cdf97078fde0991d9b9de1d6fe52cb5bc8f85baf19b5fddd91f9cb3cb"],
  ["oaf/app.json", 102, "2a4a18272c1fd3d18805e7154508c401d1cf65c998f27dd3e591f8b1075b571f"],
  ["oaf/stack.json", 25, "8243f169566e2e812faea1f2f3eb160cfca5e7eb7b1469c8e7b6fcdd4667de0b"],
  ["oaf/docs-pack.json", 52, "a8668e526d492fff730c267cbb7d2b6b20a2a89db0f21467f527edc6f28ee345"],
  ["oaf/doctor.mjs", 874, "653a45a107a0f85d47da87d9da9d46689e12158a45713815c944a3f6c2af7f37"],
  ["oaf/receipts/.gitkeep", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["tests/sanity.test.mjs", 800, "1c49f79e11d22dc36309eb5d841d8b3975bccf7fc034366dc66610fd67279b7a"],
  ["tests/unit/.gitkeep", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["tests/integration/.gitkeep", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["e2e/.gitkeep", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["public/.gitkeep", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["app/layout.tsx", 210, "a52360f1cc08d1c1c53e6fd0657662e306685680fd2a7ebdb2b0a073272bb391"],
  ["app/page.tsx", 101, "609ce9763621f9386ba94b188ee0a3cfccc3af9632c355065e9cddeacace96d9"],
  ["app/api/.gitkeep", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["components/ui/.gitkeep", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["components/shared/.gitkeep", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["features/example-feature/components/.gitkeep", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["features/example-feature/server/.gitkeep", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["features/example-feature/schemas.ts", 153, "1291bb6f00e1e7a84dd0420b6b4121426b2d20acc62da7463e5aba9573105e49"],
  ["features/example-feature/types.ts", 83, "8cccc4774162f87086222262f09a3b091e2857b815d02aaaebd2ccd8fff02e97"],
  ["features/example-feature/index.ts", 68, "a0d9104c7689a96c36a539b62858d2e3ed71ebce7adf9e13c3900e26ae2f2922"],
  ["lib/env.ts", 218, "fa1d41d35d1d8e8d858fbbac533ea1901746398fa809cebb7bb9e406f0ef3f64"],
  ["lib/result.ts", 306, "844f3a74e6fc019cce831e294efe47b0a98244157d23f934c946cf48ed99116a"],
  ["lib/utils.ts", 219, "223529f9b26ee5b6c3be2dba4c1ca232620707ecd241c01f042ae07723b72ca5"],
  ["server/auth/.gitkeep", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["server/actions/.gitkeep", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["db/schema/.gitkeep", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["db/migrations/.gitkeep", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["db/seed/.gitkeep", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["db/client.ts", 200, "5c9dd50c667d373df3a707d019c22291c92e9b56e7420515c94ce836f31c31c0"],
  ["docs/app.md", 209, "d87752f665cec79d6670a6b4f8aa7ea713b732245ddb61cb91c08adb85c3231b"],
  ["tsconfig.json", 378, "68bec825c4ba63ec70004740d6686fdcfc881beacc7742a654814457cec841e2"],
  ["next.config.ts", 104, "ab4c61f6ee100ae43610a18512f1ebcec842bb2405431e1009266173f21cf772"],
  ["postcss.config.mjs", 94, "dfac7ac2d86d326a0e5adb024e7943c181393ed17a5fcb8f0315b24c7da6ddde"],
  ["docker-compose.yml", 254, "1a21cc9548e9bd1b655d46b38bd4f18a160883e7fe551a57ad864ac6329bb928"],
  ["Dockerfile", 305, "74901c85bbc317f15d37a4a3873f72176b89778abde03ce28bbc5a0cd47f5679"],
];
const COMPLETE_TREE_DIGEST = "afa58a4a4b507c204ebeec168d8c7f7b180c051691cc1fe055124da1b1c7dd2b";
const CLEAN_MAIN_README_DIGEST = "7827f616071ce68596ce38ef4cce5542264e80886c5b06d7b84d9e816dde6e2e";

/** @param {string} content */
function digest(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** @param {Record<string, string>} tree */
function describe(tree) {
  return Object.entries(tree).map(([path, content]) => [path, Buffer.byteLength(content, "utf8"), digest(content)]);
}

const tree = getAppTemplates(NAME, CREATED_AT);
const entries = describe(tree);
assert.equal(Object.keys(tree).length, 37, "the tree has exactly 37 paths");
assert.deepEqual(entries, EXPECTED_ENTRIES, "every path, byte count, and content digest matches clean main");
assert.equal(
  digest(JSON.stringify(entries.map(([path, bytes, sha256]) => ({ path, bytes, sha256 })))),
  COMPLETE_TREE_DIGEST,
  "the ordered complete-tree digest matches clean main",
);
assert.ok(Object.values(tree).every((content) => typeof content === "string"), "every template value is a string");
assert.ok(Object.entries(tree).filter(([path]) => path.endsWith("/.gitkeep")).every(([, content]) => content === ""), "all .gitkeep values are empty");

const independent = getAppTemplates(NAME, CREATED_AT);
assert.notStrictEqual(tree, independent, "separate calls return separate objects");
assert.equal(independent["README.md"].split("bin/oaf.ts").length, 2, "README has exactly one native TypeScript binary path");
assert.equal(
  digest(independent["README.md"].replace("bin/oaf.ts", "bin/oaf.mjs")),
  CLEAN_MAIN_README_DIGEST,
  "restoring the old binary path restores clean-main README bytes exactly",
);
tree["README.md"] = "changed";
assert.notEqual(tree["README.md"], independent["README.md"], "mutating one tree does not affect another");

const changedName = getAppTemplates("other-name", CREATED_AT);
const changedCreatedAt = getAppTemplates(NAME, "2001-01-01T00:00:00.000Z");
assert.deepEqual(Object.keys(tree), Object.keys(changedName), "key order is stable");
const independentEntries = describe(independent);
assert.deepEqual(
  describe(changedName).filter(([, , sha256], index) => sha256 !== independentEntries[index][2]).map(([path]) => path),
  ["README.md", "package.json", "oaf/app.json"],
  "name changes only name-dependent templates",
);
assert.deepEqual(
  describe(changedCreatedAt).filter(([, , sha256], index) => sha256 !== independentEntries[index][2]).map(([path]) => path),
  ["oaf/app.json"],
  "createdAt changes only oaf/app.json",
);

const specialName = 'quotes " backslash \\ unicode caf\u00e9\nnext';
const special = Reflect.apply(getAppTemplates, undefined, [specialName, CREATED_AT]);
assert.ok(special["README.md"].startsWith(`# ${specialName}\n`), "README name interpolation remains raw");
assert.equal(JSON.parse(special["package.json"]).name, specialName, "package JSON retains native escaping");

const numeric = Reflect.apply(getAppTemplates, undefined, [123, 456]);
assert.equal(numeric["README.md"].startsWith("# 123\n"), true, "numeric names use native interpolation");
assert.deepEqual(JSON.parse(numeric["oaf/app.json"]), { name: 123, createdBy: "oaf", createdAt: 456 }, "numeric inputs use native JSON serialization");
const nullName = Reflect.apply(getAppTemplates, undefined, [null, CREATED_AT]);
assert.equal(nullName["README.md"].startsWith("# null\n"), true, "null names use native interpolation");
assert.equal(JSON.parse(nullName["package.json"]).name, null, "null names use native JSON serialization");
const undefinedValues = Reflect.apply(getAppTemplates, undefined, [undefined, undefined]);
assert.equal(undefinedValues["README.md"].startsWith("# undefined\n"), true, "undefined names use native interpolation");
assert.deepEqual(JSON.parse(undefinedValues["oaf/app.json"]), { createdBy: "oaf" }, "undefined values retain native JSON omission");
assert.throws(() => Reflect.apply(getAppTemplates, undefined, [1n, CREATED_AT]), TypeError, "BigInt serialization errors propagate without wrapping");
/** @type {{ self?: unknown }} */
const cyclic = {};
cyclic.self = cyclic;
assert.throws(() => Reflect.apply(getAppTemplates, undefined, ["cyclic", cyclic]), TypeError, "cyclic serialization errors propagate without wrapping");

const snapshot = loadStackSnapshot();
const packageJson = JSON.parse(independent["package.json"]);
assert.deepEqual(Object.keys(packageJson), ["name", "private", "packageManager", "scripts"], "package JSON property order is unchanged");
assert.equal(packageJson.packageManager, BLESSED_PACKAGE_MANAGER, "package manager remains command-policy-derived");
assert.deepEqual(packageJson.scripts, BLESSED_PACKAGE_SCRIPTS, "package scripts remain command-policy-derived");
const appJson = JSON.parse(independent["oaf/app.json"]);
assert.deepEqual(Object.keys(appJson), ["name", "createdBy", "createdAt"], "app JSON property order is unchanged");
assert.deepEqual(Object.keys(JSON.parse(independent["oaf/docs-pack.json"])), ["docsPack", "oafStack"], "docs-pack JSON property order is unchanged");
assert.equal(JSON.parse(independent["oaf/stack.json"]).oafStack, snapshot.id, "stack ID remains snapshot-derived");
assert.equal(JSON.parse(independent["oaf/docs-pack.json"]).docsPack, snapshot.docsPack, "docs-pack ID remains snapshot-derived");
assert.ok(independent["docker-compose.yml"].includes(`image: ${snapshot.data.postgresImage}`), "Postgres image remains snapshot-derived");

console.log("Templates checks passed.");
