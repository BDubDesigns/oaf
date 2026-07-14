// Focused test for minimal, local-only Alpha 1 agent context assembly.
// Uses only Node built-ins; no provider, network, tool execution, or mutation
// of the checked-in generated-app fixture.
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgentContext } from "../lib/agent/context.ts";
import { copyGeneratedAppFixture, GENERATED_APP_FIXTURE } from "./generated-app-fixture-helper.ts";

let failures = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`PASS  ${message}`);
  } else {
    console.log(`FAIL  ${message}`);
    failures++;
  }
}

async function rejects(action, pattern, message) {
  try {
    await action();
    assert(false, message);
  } catch (error) {
    assert(pattern.test(error.message), message);
  }
}

function copyOafDocsPacks() {
  const base = mkdtempSync(join(tmpdir(), "oaf-agent-context-packs-"));
  const oafRoot = join(base, "oaf-root");
  mkdirSync(oafRoot);
  cpSync(join(repoRoot, "docs-packs"), join(oafRoot, "docs-packs"), { recursive: true });
  return { oafRoot, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureCopies = [];
const temporaryRoots = [];
const sourcePage = readFileSync(join(GENERATED_APP_FIXTURE, "app/page.tsx"), "utf8");
const sourceMarker = readFileSync(join(GENERATED_APP_FIXTURE, "oaf/docs-pack.json"), "utf8");

try {
  // 1. A fresh OAF fixture loads a small, deterministic local context.
  const fresh = copyGeneratedAppFixture();
  fixtureCopies.push(fresh);
  const context = await loadAgentContext({ workspaceRoot: fresh.workspace });
  const expectedOrder = [
    "workspace:oaf/app.json",
    "workspace:oaf/stack.json",
    "workspace:oaf/docs-pack.json",
    "workspace:README.md",
    "workspace:docs/app.md",
    "docs-pack:oaf/agent-guidance.md",
    "docs-pack:oaf/stack.md",
    "docs-pack:oaf/app-structure.md",
    "docs-pack:oaf/package-policy.md",
    "docs-pack:oaf/sandbox.md",
  ];
  const order = context.documents.map((document) => `${document.source}:${document.path}`);
  assert(context.docsPack.id === "stack-0.1" && context.docsPack.oafStack === "0.1.0", "context resolves fixture docs-pack marker");
  assert(JSON.stringify(order) === JSON.stringify(expectedOrder), "context documents use the documented stable order");
  assert(context.documents.every((document) => document.content.length > 0 && document.bytes > 0), "context documents have non-empty content and byte counts");
  assert(
    context.totalBytes === context.documents.reduce((total, document) => total + document.bytes, 0),
    "context totalBytes equals the UTF-8 document-byte sum",
  );
  let serializable = true;
  try {
    JSON.parse(JSON.stringify(context));
  } catch {
    serializable = false;
  }
  assert(serializable, "context result is JSON-serializable");

  const repeated = await loadAgentContext({ workspaceRoot: fresh.workspace });
  assert(JSON.stringify(repeated) === JSON.stringify(context), "repeated context loads are deterministic");

  // 2. Required workspace validation and optional app docs behavior.
  await rejects(
    () => Reflect.apply(loadAgentContext, undefined, [{}]),
    /workspaceRoot is required/,
    "context requires workspaceRoot",
  );
  await rejects(
    () => Reflect.apply(loadAgentContext, undefined, [{ workspaceRoot: "" }]),
    /workspaceRoot is required/,
    "context rejects an empty workspaceRoot from JavaScript",
  );
  await rejects(
    () => Reflect.apply(loadAgentContext, undefined, [{ workspaceRoot: 1 }]),
    /workspaceRoot is required/,
    "context rejects a non-string workspaceRoot from JavaScript",
  );
  await rejects(
    () => Reflect.apply(loadAgentContext, undefined, [{ workspaceRoot: fresh.workspace, oafRoot: 1 }]),
    /oafRoot is required/,
    "context rejects a non-string oafRoot from JavaScript",
  );

  await rejects(
    () => loadAgentContext({ workspaceRoot: join(tmpdir(), "oaf-agent-context-missing-workspace") }),
    /workspaceRoot does not exist/,
    "context rejects a nonexistent workspace",
  );
  await rejects(
    () => loadAgentContext({ workspaceRoot: join(fresh.workspace, "README.md") }),
    /workspaceRoot must be a directory/,
    "context rejects a workspace file",
  );
  await rejects(
    () => loadAgentContext({ workspaceRoot: fresh.workspace, oafRoot: join(tmpdir(), "oaf-agent-context-missing-root") }),
    /oafRoot does not exist/,
    "context rejects a nonexistent OAF root",
  );
  await rejects(
    () => loadAgentContext({ workspaceRoot: fresh.workspace, oafRoot: join(fresh.workspace, "README.md") }),
    /oafRoot must be a directory/,
    "context rejects an OAF root file",
  );

  const nonOafRoot = mkdtempSync(join(tmpdir(), "oaf-agent-context-non-oaf-"));
  temporaryRoots.push(() => rmSync(nonOafRoot, { recursive: true, force: true }));
  await rejects(
    () => loadAgentContext({ workspaceRoot: nonOafRoot }),
    /workspace marker is missing: oaf\/app\.json/,
    "context rejects a non-OAF workspace",
  );

  const missingMarker = copyGeneratedAppFixture();
  fixtureCopies.push(missingMarker);
  unlinkSync(join(missingMarker.workspace, "oaf/docs-pack.json"));
  await rejects(
    () => loadAgentContext({ workspaceRoot: missingMarker.workspace }),
    /workspace marker is missing: oaf\/docs-pack\.json/,
    "context rejects a missing docs-pack marker",
  );

  for (const marker of ["oaf/app.json", "oaf/stack.json"]) {
    const fixture = copyGeneratedAppFixture();
    fixtureCopies.push(fixture);
    unlinkSync(join(fixture.workspace, marker));
    await rejects(
      () => loadAgentContext({ workspaceRoot: fixture.workspace }),
      new RegExp(`workspace marker is missing: ${marker.replace("/", "\\/").replace(".", "\\.")}`),
      `context rejects a missing ${marker} marker`,
    );
  }

  const malformedMarker = copyGeneratedAppFixture();
  fixtureCopies.push(malformedMarker);
  writeFileSync(join(malformedMarker.workspace, "oaf/docs-pack.json"), "not json\n");
  await rejects(
    () => loadAgentContext({ workspaceRoot: malformedMarker.workspace }),
    /oaf\/docs-pack\.json is malformed JSON/,
    "context rejects a malformed docs-pack marker",
  );

  /** @type {[string, string, RegExp, string][]} */
  const markerCases = [
    ["oaf/app.json", "[]", /oaf\/app\.json is not a valid OAF-generated app marker/, "array app marker"],
    ["oaf/app.json", JSON.stringify({ name: 1, createdBy: "oaf", createdAt: "now" }), /oaf\/app\.json is not a valid OAF-generated app marker/, "invalid app marker fields"],
    ["oaf/stack.json", "[]", /oaf\/stack\.json is malformed/, "array stack marker"],
    ["oaf/stack.json", JSON.stringify({}), /oaf\/stack\.json is malformed/, "invalid stack marker"],
    ["oaf/docs-pack.json", "null", /oaf\/docs-pack\.json is malformed/, "non-object docs-pack marker"],
    ["oaf/docs-pack.json", JSON.stringify({ docsPack: "stack-0.1" }), /oaf\/docs-pack\.json is malformed/, "invalid docs-pack marker"],
    ["oaf/docs-pack.json", JSON.stringify({ docsPack: "stack-0.1", oafStack: "wrong" }), /oaf\/docs-pack\.json does not match oaf\/stack\.json/, "mismatched stack marker"],
  ];
  for (const [marker, content, pattern, label] of markerCases) {
    const fixture = copyGeneratedAppFixture();
    fixtureCopies.push(fixture);
    writeFileSync(join(fixture.workspace, marker), content);
    await rejects(() => loadAgentContext({ workspaceRoot: fixture.workspace }), pattern, `context rejects ${label}`);
  }
  const extraMarkerFields = copyGeneratedAppFixture();
  fixtureCopies.push(extraMarkerFields);
  writeFileSync(join(extraMarkerFields.workspace, "oaf/docs-pack.json"), JSON.stringify({ docsPack: "stack-0.1", oafStack: "0.1.0", ignored: true }));
  await loadAgentContext({ workspaceRoot: extraMarkerFields.workspace });
  assert(true, "context accepts harmless extra marker fields");

  const optionalAppDocs = copyGeneratedAppFixture();
  fixtureCopies.push(optionalAppDocs);
  unlinkSync(join(optionalAppDocs.workspace, "docs/app.md"));
  const optionalContext = await loadAgentContext({ workspaceRoot: optionalAppDocs.workspace });
  assert(!optionalContext.documents.some((document) => document.path === "docs/app.md"), "missing optional app docs are omitted cleanly");

  // 3. Marker pack identifiers cannot select arbitrary paths.
  for (const [docsPack, pattern, label] of [
    ["unknown-pack", /docs-pack is missing/, "unknown docs-pack"],
    ["/tmp/pack", /docs-pack reference must not be absolute/, "absolute docs-pack reference"],
    ["C:\\pack", /docs-pack reference must not be absolute/, "Windows absolute docs-pack reference"],
    ["../stack-0.1", /docs-pack reference must not contain parent traversal/, "forward traversal docs-pack reference"],
    ["a\\..\\stack-0.1", /docs-pack reference must not contain parent traversal/, "backslash traversal docs-pack reference"],
    ["a/../stack-0.1", /docs-pack reference must not contain parent traversal/, "nested traversal docs-pack reference"],
    ["stack/0.1", /docs-pack reference contains unsupported characters/, "nested docs-pack reference"],
    ["stack@0.1", /docs-pack reference contains unsupported characters/, "unsupported docs-pack characters"],
  ]) {
    const fixture = copyGeneratedAppFixture();
    fixtureCopies.push(fixture);
    writeFileSync(
      join(fixture.workspace, "oaf/docs-pack.json"),
      JSON.stringify({ docsPack, oafStack: "0.1.0" }, null, 2),
    );
    await rejects(() => loadAgentContext({ workspaceRoot: fixture.workspace }), pattern, `context rejects ${label}`);
  }

  // 4. A selected local pack must have a valid manifest and all required files.
  const malformedManifestFixture = copyGeneratedAppFixture();
  fixtureCopies.push(malformedManifestFixture);
  const malformedManifestPacks = copyOafDocsPacks();
  temporaryRoots.push(malformedManifestPacks.cleanup);
  writeFileSync(join(malformedManifestPacks.oafRoot, "docs-packs", "stack-0.1", "manifest.json"), "not json\n");
  await rejects(
    () => loadAgentContext({ workspaceRoot: malformedManifestFixture.workspace, oafRoot: malformedManifestPacks.oafRoot }),
    /docs-pack manifest is malformed JSON/,
    "context rejects a malformed docs-pack manifest",
  );

  const missingDocsPacks = copyGeneratedAppFixture();
  fixtureCopies.push(missingDocsPacks);
  const missingDocsPacksRoot = mkdtempSync(join(tmpdir(), "oaf-agent-context-no-packs-"));
  temporaryRoots.push(() => rmSync(missingDocsPacksRoot, { recursive: true, force: true }));
  await rejects(
    () => loadAgentContext({ workspaceRoot: missingDocsPacks.workspace, oafRoot: missingDocsPacksRoot }),
    /docs-packs root is missing/,
    "context rejects a missing docs-packs root",
  );

  const missingPackDocumentFixture = copyGeneratedAppFixture();
  fixtureCopies.push(missingPackDocumentFixture);
  const missingPackDocumentPacks = copyOafDocsPacks();
  temporaryRoots.push(missingPackDocumentPacks.cleanup);
  unlinkSync(join(missingPackDocumentPacks.oafRoot, "docs-packs", "stack-0.1", "oaf", "stack.md"));
  await rejects(
    () => loadAgentContext({ workspaceRoot: missingPackDocumentFixture.workspace, oafRoot: missingPackDocumentPacks.oafRoot }),
    /docs-pack document is missing: oaf\/stack\.md/,
    "context rejects a missing required docs-pack document",
  );

  /** @type {[string, RegExp, string][]} */
  const manifestCases = [
    ["{}", /docs-pack manifest does not match the generated app marker/, "non-matching manifest object"],
    ["[]", /docs-pack manifest does not match the generated app marker/, "array manifest"],
    [JSON.stringify({ docsPack: "wrong", oafStack: "0.1.0", documents: [] }), /docs-pack manifest does not match the generated app marker/, "manifest marker mismatch"],
    [JSON.stringify({ docsPack: "stack-0.1", oafStack: "0.1.0" }), /docs-pack manifest must contain an ordered documents list/, "missing manifest documents"],
    [JSON.stringify({ docsPack: "stack-0.1", oafStack: "0.1.0", documents: [] }), /docs-pack manifest must contain an ordered documents list/, "empty manifest documents"],
    [JSON.stringify({ docsPack: "stack-0.1", oafStack: "0.1.0", documents: {} }), /docs-pack manifest must contain an ordered documents list/, "non-array manifest documents"],
    [JSON.stringify({ docsPack: "stack-0.1", oafStack: "0.1.0", documents: [null] }), /docs-pack manifest contains an invalid document entry/, "malformed manifest entry"],
    [JSON.stringify({ docsPack: "stack-0.1", oafStack: "0.1.0", documents: [{ path: 1, required: true }] }), /docs-pack manifest contains an invalid document entry/, "non-string manifest path"],
    [JSON.stringify({ docsPack: "stack-0.1", oafStack: "0.1.0", documents: [{ path: "oaf/stack.md", required: 1 }] }), /docs-pack manifest contains an invalid document entry/, "non-boolean manifest required flag"],
    [JSON.stringify({ docsPack: "stack-0.1", oafStack: "0.1.0", documents: [{ path: "oaf/stack.md", required: true }, { path: "oaf/stack.md", required: false }] }), /docs-pack manifest contains a duplicate document path: oaf\/stack\.md/, "duplicate manifest document"],
    [JSON.stringify({ docsPack: "stack-0.1", oafStack: "0.1.0", documents: [{ path: "/tmp/file", required: true }] }), /docs-pack document path must not be absolute/, "absolute manifest document"],
    [JSON.stringify({ docsPack: "stack-0.1", oafStack: "0.1.0", documents: [{ path: "a/../file", required: true }] }), /docs-pack document path must not contain parent traversal/, "traversal manifest document"],
  ];
  for (const [content, pattern, label] of manifestCases) {
    const fixture = copyGeneratedAppFixture();
    fixtureCopies.push(fixture);
    const packs = copyOafDocsPacks();
    temporaryRoots.push(packs.cleanup);
    writeFileSync(join(packs.oafRoot, "docs-packs", "stack-0.1", "manifest.json"), content);
    await rejects(() => loadAgentContext({ workspaceRoot: fixture.workspace, oafRoot: packs.oafRoot }), pattern, `context rejects ${label}`);
  }

  const optionalPackDocument = copyGeneratedAppFixture();
  fixtureCopies.push(optionalPackDocument);
  const optionalPack = copyOafDocsPacks();
  temporaryRoots.push(optionalPack.cleanup);
  writeFileSync(join(optionalPack.oafRoot, "docs-packs", "stack-0.1", "manifest.json"), JSON.stringify({ docsPack: "stack-0.1", oafStack: "0.1.0", documents: [{ path: "missing.md", required: false }, { path: "oaf/stack.md", required: true }] }));
  const optionalPackContext = await loadAgentContext({ workspaceRoot: optionalPackDocument.workspace, oafRoot: optionalPack.oafRoot });
  assert(JSON.stringify(optionalPackContext.documents.slice(-1).map((document) => document.path)) === JSON.stringify(["oaf/stack.md"]), "missing optional docs-pack documents are omitted in manifest order");

  // 5. Workspace and docs-pack symlink escapes fail closed when supported.
  const outside = mkdtempSync(join(tmpdir(), "oaf-agent-context-outside-"));
  temporaryRoots.push(() => rmSync(outside, { recursive: true, force: true }));
  const outsideFile = join(outside, "outside.md");
  writeFileSync(outsideFile, "outside\n");
  try {
    const workspaceEscape = copyGeneratedAppFixture();
    fixtureCopies.push(workspaceEscape);
    unlinkSync(join(workspaceEscape.workspace, "README.md"));
    symlinkSync(outsideFile, join(workspaceEscape.workspace, "README.md"));
    await rejects(
      () => loadAgentContext({ workspaceRoot: workspaceEscape.workspace }),
      /workspace README resolves outside its owner root through a symlink/,
      "context rejects a workspace document symlink escape",
    );

    const docsPackEscape = copyGeneratedAppFixture();
    fixtureCopies.push(docsPackEscape);
    const copiedPacks = copyOafDocsPacks();
    temporaryRoots.push(copiedPacks.cleanup);
    const packDocument = join(copiedPacks.oafRoot, "docs-packs", "stack-0.1", "oaf", "sandbox.md");
    unlinkSync(packDocument);
    symlinkSync(outsideFile, packDocument);
    await rejects(
      () => loadAgentContext({ workspaceRoot: docsPackEscape.workspace, oafRoot: copiedPacks.oafRoot }),
      /docs-pack document resolves outside its owner root through a symlink/,
      "context rejects a docs-pack document symlink escape",
    );

    const docsPacksRootEscape = copyGeneratedAppFixture();
    fixtureCopies.push(docsPacksRootEscape);
    const rootEscapePacks = copyOafDocsPacks();
    temporaryRoots.push(rootEscapePacks.cleanup);
    rmSync(join(rootEscapePacks.oafRoot, "docs-packs"), { recursive: true, force: true });
    symlinkSync(outside, join(rootEscapePacks.oafRoot, "docs-packs"));
    await rejects(() => loadAgentContext({ workspaceRoot: docsPacksRootEscape.workspace, oafRoot: rootEscapePacks.oafRoot }), /docs-packs root resolves outside its owner root through a symlink/, "context rejects a docs-packs root symlink escape");

    const selectedPackEscape = copyGeneratedAppFixture();
    fixtureCopies.push(selectedPackEscape);
    const selectedEscapePacks = copyOafDocsPacks();
    temporaryRoots.push(selectedEscapePacks.cleanup);
    rmSync(join(selectedEscapePacks.oafRoot, "docs-packs", "stack-0.1"), { recursive: true, force: true });
    symlinkSync(outside, join(selectedEscapePacks.oafRoot, "docs-packs", "stack-0.1"));
    await rejects(() => loadAgentContext({ workspaceRoot: selectedPackEscape.workspace, oafRoot: selectedEscapePacks.oafRoot }), /docs-pack resolves outside its owner root through a symlink/, "context rejects a selected docs-pack symlink escape");
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES" || error.code === "ENOTSUP") {
      console.log(`SKIP  symlink context tests unavailable: ${error.code}`);
    } else {
      throw error;
    }
  }

  const multibyte = copyGeneratedAppFixture();
  fixtureCopies.push(multibyte);
  writeFileSync(join(multibyte.workspace, "README.md"), "emoji: 😀\n");
  const multibyteContext = await loadAgentContext({ workspaceRoot: multibyte.workspace });
  const multibyteDocument = multibyteContext.documents.find((document) => document.path === "README.md");
  assert(multibyteDocument?.bytes === Buffer.byteLength("emoji: 😀\n", "utf8") && multibyteDocument.bytes > multibyteDocument.content.length, "context counts multibyte content as UTF-8 bytes");

  const nonFileWorkspaceDocument = copyGeneratedAppFixture();
  fixtureCopies.push(nonFileWorkspaceDocument);
  rmSync(join(nonFileWorkspaceDocument.workspace, "README.md"));
  mkdirSync(join(nonFileWorkspaceDocument.workspace, "README.md"));
  await rejects(() => loadAgentContext({ workspaceRoot: nonFileWorkspaceDocument.workspace }), /workspace README must be a file: README\.md/, "context requires workspace documents to be regular files");

  // 6. Context assembly is read-only; fixture source stays untouched.
  assert(readFileSync(join(GENERATED_APP_FIXTURE, "app/page.tsx"), "utf8") === sourcePage, "context load does not mutate fixture source files");
  assert(readFileSync(join(GENERATED_APP_FIXTURE, "oaf/docs-pack.json"), "utf8") === sourceMarker, "context load does not mutate fixture markers");
} finally {
  for (const fixture of fixtureCopies) fixture.cleanup();
  for (const cleanup of temporaryRoots) cleanup();
}

if (failures > 0) {
  console.error(`\n${failures} context check(s) failed.`);
  process.exit(1);
}
console.log("\nAll agent-context checks passed.");
