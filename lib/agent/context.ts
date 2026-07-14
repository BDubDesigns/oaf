// Minimal, local-only context assembly for the future OAF agent loop.
//
// This module reads a generated app's OAF markers and a manifest-selected
// docs-pack subset. It does not call a model, execute tools, mutate files, or
// emit events/receipts.

import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentContext,
  AgentContextDocument,
  ContextDocumentSource,
  LoadAgentContextOptions,
} from "./contracts.ts";

type OwnedFile = { path: string; content: string; bytes: number };
type DocsPackMarker = { docsPack: string; oafStack: string };
type ManifestDocument = { path: string; required: boolean };
type DocsPackManifest = { docsPack: string; oafStack: string; documents: ManifestDocument[] };

const DEFAULT_OAF_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function isInside(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

function isNodeErrorWithCode(value: unknown, code: string): boolean {
  return value !== null && typeof value === "object" && "code" in value && value.code === code;
}

function assertSafeRelativePath(path: unknown, label: string): asserts path is string {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  if (isAbsolute(path) || win32.isAbsolute(path)) {
    throw new Error(`${label} must not be absolute`);
  }
  if (path.split(/[\\/]+/).includes("..")) {
    throw new Error(`${label} must not contain parent traversal`);
  }
}

async function resolveDirectory(path: unknown, label: string): Promise<string> {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error(`${label} is required`);
  }

  let resolved: string;
  try {
    resolved = await realpath(path);
  } catch (error: unknown) {
    if (isNodeErrorWithCode(error, "ENOENT")) throw new Error(`${label} does not exist`);
    throw error;
  }
  if (!(await stat(resolved)).isDirectory()) {
    throw new Error(`${label} must be a directory`);
  }
  return resolved;
}

async function resolveOwnedDirectory(root: string, path: unknown, label: string): Promise<string> {
  assertSafeRelativePath(path, label);
  const requested = resolve(root, path);
  if (!isInside(root, requested)) {
    throw new Error(`${label} resolves outside its owner root`);
  }

  let resolved: string;
  try {
    resolved = await realpath(requested);
  } catch (error: unknown) {
    if (isNodeErrorWithCode(error, "ENOENT")) throw new Error(`${label} is missing`);
    throw error;
  }
  if (!isInside(root, resolved)) {
    throw new Error(`${label} resolves outside its owner root through a symlink`);
  }
  if (!(await stat(resolved)).isDirectory()) {
    throw new Error(`${label} must be a directory`);
  }
  return resolved;
}

function readOwnedFile(root: string, path: string, label: string): Promise<OwnedFile>;
function readOwnedFile(root: string, path: string, label: string, required: true): Promise<OwnedFile>;
function readOwnedFile(root: string, path: string, label: string, required: false): Promise<OwnedFile | null>;
function readOwnedFile(root: string, path: string, label: string, required: boolean): Promise<OwnedFile | null>;
async function readOwnedFile(root: string, path: string, label: string, required = true): Promise<OwnedFile | null> {
  assertSafeRelativePath(path, label);
  const requested = resolve(root, path);
  if (!isInside(root, requested)) {
    throw new Error(`${label} resolves outside its owner root`);
  }

  let resolved: string;
  try {
    resolved = await realpath(requested);
  } catch (error: unknown) {
    if (isNodeErrorWithCode(error, "ENOENT") && !required) return null;
    if (isNodeErrorWithCode(error, "ENOENT")) throw new Error(`${label} is missing: ${path}`);
    throw error;
  }
  if (!isInside(root, resolved)) {
    throw new Error(`${label} resolves outside its owner root through a symlink`);
  }
  if (!(await stat(resolved)).isFile()) {
    throw new Error(`${label} must be a file: ${path}`);
  }

  const content = await readFile(resolved, "utf8");
  return { path, content, bytes: Buffer.byteLength(content, "utf8") };
}

function parseJson(document: OwnedFile, label: string): unknown {
  try {
    return JSON.parse(document.content);
  } catch {
    throw new Error(`${label} is malformed JSON`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateWorkspaceMarkers(app: unknown, stack: unknown, docsPack: unknown): asserts docsPack is DocsPackMarker {
  if (!isObject(app) || typeof app.name !== "string" || app.createdBy !== "oaf" || typeof app.createdAt !== "string") {
    throw new Error("oaf/app.json is not a valid OAF-generated app marker");
  }
  if (!isObject(stack) || typeof stack.oafStack !== "string") {
    throw new Error("oaf/stack.json is malformed");
  }
  if (!isObject(docsPack) || typeof docsPack.docsPack !== "string" || typeof docsPack.oafStack !== "string") {
    throw new Error("oaf/docs-pack.json is malformed");
  }
  if (docsPack.oafStack !== stack.oafStack) {
    throw new Error("oaf/docs-pack.json does not match oaf/stack.json");
  }
}

function validateDocsPackId(id: string): void {
  assertSafeRelativePath(id, "docs-pack reference");
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
    throw new Error("docs-pack reference contains unsupported characters");
  }
}

function validateManifest(manifest: unknown, docsPackId: string, oafStack: string): asserts manifest is DocsPackManifest {
  if (!isObject(manifest) || manifest.docsPack !== docsPackId || manifest.oafStack !== oafStack) {
    throw new Error("docs-pack manifest does not match the generated app marker");
  }
  if (!Array.isArray(manifest.documents) || manifest.documents.length === 0) {
    throw new Error("docs-pack manifest must contain an ordered documents list");
  }

  const paths = new Set<string>();
  for (const document of manifest.documents) {
    if (!isObject(document) || typeof document.path !== "string" || typeof document.required !== "boolean") {
      throw new Error("docs-pack manifest contains an invalid document entry");
    }
    assertSafeRelativePath(document.path, "docs-pack document path");
    if (paths.has(document.path)) {
      throw new Error(`docs-pack manifest contains a duplicate document path: ${document.path}`);
    }
    paths.add(document.path);
  }
}

function asContextDocument(source: ContextDocumentSource, document: OwnedFile): AgentContextDocument {
  return { source, path: document.path, content: document.content, bytes: document.bytes };
}

// Load the fixed, minimal Alpha 1 context in deterministic order:
// required workspace markers, required workspace README, optional docs/app.md,
// then the manifest's ordered docs-pack allowlist. totalBytes is UTF-8 bytes,
// not a model-token estimate.
export async function loadAgentContext({ workspaceRoot, oafRoot = DEFAULT_OAF_ROOT }: LoadAgentContextOptions): Promise<AgentContext> {
  const workspace = await resolveDirectory(workspaceRoot, "workspaceRoot");

  const appMarkerDocument = await readOwnedFile(workspace, "oaf/app.json", "workspace marker");
  const stackMarkerDocument = await readOwnedFile(workspace, "oaf/stack.json", "workspace marker");
  const docsPackMarkerDocument = await readOwnedFile(workspace, "oaf/docs-pack.json", "workspace marker");
  const appMarker = parseJson(appMarkerDocument, "oaf/app.json");
  const stackMarker = parseJson(stackMarkerDocument, "oaf/stack.json");
  const docsPackMarker = parseJson(docsPackMarkerDocument, "oaf/docs-pack.json");
  validateWorkspaceMarkers(appMarker, stackMarker, docsPackMarker);
  validateDocsPackId(docsPackMarker.docsPack);

  const workspaceReadme = await readOwnedFile(workspace, "README.md", "workspace README");
  const workspaceAppDocs = await readOwnedFile(workspace, "docs/app.md", "workspace app docs", false);

  const oaf = await resolveDirectory(oafRoot, "oafRoot");
  const docsPacksRoot = await resolveOwnedDirectory(oaf, "docs-packs", "docs-packs root");
  const packRoot = await resolveOwnedDirectory(docsPacksRoot, docsPackMarker.docsPack, "docs-pack");
  const manifestDocument = await readOwnedFile(packRoot, "manifest.json", "docs-pack manifest");
  const manifest = parseJson(manifestDocument, "docs-pack manifest");
  validateManifest(manifest, docsPackMarker.docsPack, docsPackMarker.oafStack);

  const documents: AgentContextDocument[] = [
    asContextDocument("workspace", appMarkerDocument),
    asContextDocument("workspace", stackMarkerDocument),
    asContextDocument("workspace", docsPackMarkerDocument),
    asContextDocument("workspace", workspaceReadme),
  ];
  if (workspaceAppDocs) documents.push(asContextDocument("workspace", workspaceAppDocs));

  for (const entry of manifest.documents) {
    const document = await readOwnedFile(packRoot, entry.path, "docs-pack document", entry.required);
    if (document) documents.push(asContextDocument("docs-pack", document));
  }

  return {
    workspaceRoot: workspace,
    docsPack: { id: docsPackMarker.docsPack, oafStack: docsPackMarker.oafStack },
    documents,
    totalBytes: documents.reduce((total, document) => total + document.bytes, 0),
  };
}
