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
import { loadAgentContext } from "../lib/agent/context.mjs";
import { copyGeneratedAppFixture, GENERATED_APP_FIXTURE } from "./generated-app-fixture-helper.mjs";

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
    () => loadAgentContext({}),
    /workspaceRoot is required/,
    "context requires workspaceRoot",
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

  const malformedMarker = copyGeneratedAppFixture();
  fixtureCopies.push(malformedMarker);
  writeFileSync(join(malformedMarker.workspace, "oaf/docs-pack.json"), "not json\n");
  await rejects(
    () => loadAgentContext({ workspaceRoot: malformedMarker.workspace }),
    /oaf\/docs-pack\.json is malformed JSON/,
    "context rejects a malformed docs-pack marker",
  );

  const optionalAppDocs = copyGeneratedAppFixture();
  fixtureCopies.push(optionalAppDocs);
  unlinkSync(join(optionalAppDocs.workspace, "docs/app.md"));
  const optionalContext = await loadAgentContext({ workspaceRoot: optionalAppDocs.workspace });
  assert(!optionalContext.documents.some((document) => document.path === "docs/app.md"), "missing optional app docs are omitted cleanly");

  // 3. Marker pack identifiers cannot select arbitrary paths.
  for (const [docsPack, pattern, label] of [
    ["unknown-pack", /docs-pack is missing/, "unknown docs-pack"],
    ["/tmp/pack", /docs-pack reference must not be absolute/, "absolute docs-pack reference"],
    ["../stack-0.1", /docs-pack reference must not contain parent traversal/, "traversal docs-pack reference"],
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
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES" || error.code === "ENOTSUP") {
      console.log(`SKIP  symlink context tests unavailable: ${error.code}`);
    } else {
      throw error;
    }
  }

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
