// Loads the authoritative, data-only OAF Stack 0.1 snapshot.
//
// The snapshot is intentionally a fixed known config, not a plugin registry.
// Callers receive a fresh JSON-safe copy so no caller can mutate shared state.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface StackRuntime {
  node: string;
  pnpm: string;
}

export interface StackFramework {
  next: string;
  react: string;
  reactDom: string;
  typescript: string;
}

export interface StackData {
  postgresImage: string;
  drizzleOrm: string;
  drizzleKit: string;
  pg: string;
}

export interface StackApp {
  betterAuth: string;
  zod: string;
  tailwindcss: string;
  tailwindPostcss: string;
}

export interface StackTesting {
  vitest: string;
  playwright: string;
}

export interface StackSnapshot {
  id: "0.1.0";
  status: "locked";
  verifiedAt: string;
  docsPack: string;
  runtime: StackRuntime;
  framework: StackFramework;
  data: StackData;
  app: StackApp;
  testing: StackTesting;
}

type ValidatedSectionShapes = Record<string, unknown> & {
  runtime: Record<"node" | "pnpm", unknown>;
  framework: Record<"next" | "react" | "reactDom" | "typescript", unknown>;
  data: Record<"postgresImage" | "drizzleOrm" | "drizzleKit" | "pg", unknown>;
  app: Record<"betterAuth" | "zod" | "tailwindcss" | "tailwindPostcss", unknown>;
  testing: Record<"vitest" | "playwright", unknown>;
};

const SNAPSHOT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../config/stack/oaf-stack-0.1.json");
const TOP_LEVEL_KEYS = ["id", "status", "verifiedAt", "docsPack", "runtime", "framework", "data", "app", "testing"];
const REQUIRED_SECTIONS = {
  runtime: ["node", "pnpm"],
  framework: ["next", "react", "reactDom", "typescript"],
  data: ["postgresImage", "drizzleOrm", "drizzleKit", "pg"],
  app: ["betterAuth", "zod", "tailwindcss", "tailwindPostcss"],
  testing: ["vitest", "playwright"],
};
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const POSTGRES_IMAGE = /^postgres:\d+\.\d+-[a-z0-9]+$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  return isObject(value) && Object.keys(value).length === expected.length && expected.every((key) => key in value);
}

function assertExactVersion(value: unknown, label: string): void {
  if (typeof value !== "string" || !EXACT_VERSION.test(value)) {
    throw new Error(`${label} must be an exact stable version`);
  }
}

function validateSection(section: string, value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!hasExactKeys(value, keys)) {
    throw new Error(`stack snapshot ${section} section has unknown, missing, or malformed values`);
  }
  return value;
}

function assertValidatedSectionShapes(value: Record<string, unknown>): asserts value is ValidatedSectionShapes {
  // The preceding section-shape phase established these keys with unknown values.
}

function assertValidStackSnapshot(snapshot: unknown): asserts snapshot is StackSnapshot {
  if (!hasExactKeys(snapshot, TOP_LEVEL_KEYS)) {
    throw new Error("stack snapshot has unknown, missing, or malformed top-level sections");
  }
  if (snapshot.id !== "0.1.0") throw new Error("stack snapshot id must be 0.1.0");
  if (snapshot.status !== "locked") throw new Error("stack snapshot status must be locked");
  if (typeof snapshot.docsPack !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(snapshot.docsPack)) {
    throw new Error("stack snapshot docsPack must be a known identifier");
  }
  if (typeof snapshot.verifiedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.verifiedAt)) {
    throw new Error("stack snapshot verifiedAt must be an ISO date");
  }
  if (Number.isNaN(Date.parse(`${snapshot.verifiedAt}T00:00:00Z`))) {
    throw new Error("stack snapshot verifiedAt is not a real date");
  }

  for (const [section, keys] of Object.entries(REQUIRED_SECTIONS)) {
    validateSection(section, snapshot[section], keys);
  }
  assertValidatedSectionShapes(snapshot);

  assertExactVersion(snapshot.runtime.node, "runtime.node");
  assertExactVersion(snapshot.runtime.pnpm, "runtime.pnpm");
  assertExactVersion(snapshot.framework.next, "framework.next");
  assertExactVersion(snapshot.framework.react, "framework.react");
  assertExactVersion(snapshot.framework.reactDom, "framework.reactDom");
  assertExactVersion(snapshot.framework.typescript, "framework.typescript");
  assertExactVersion(snapshot.data.drizzleOrm, "data.drizzleOrm");
  assertExactVersion(snapshot.data.drizzleKit, "data.drizzleKit");
  assertExactVersion(snapshot.data.pg, "data.pg");
  assertExactVersion(snapshot.app.betterAuth, "app.betterAuth");
  assertExactVersion(snapshot.app.zod, "app.zod");
  assertExactVersion(snapshot.app.tailwindcss, "app.tailwindcss");
  assertExactVersion(snapshot.app.tailwindPostcss, "app.tailwindPostcss");
  assertExactVersion(snapshot.testing.vitest, "testing.vitest");
  assertExactVersion(snapshot.testing.playwright, "testing.playwright");
  if (typeof snapshot.data.postgresImage !== "string" || !POSTGRES_IMAGE.test(snapshot.data.postgresImage)) {
    throw new Error("data.postgresImage must be an exact postgres image tag");
  }
  if (snapshot.framework.react !== snapshot.framework.reactDom) {
    throw new Error("framework.react and framework.reactDom must match exactly");
  }

  // All required fields and cross-field invariants above establish this contract.
}

export function validateStackSnapshot(snapshot: unknown): StackSnapshot {
  assertValidStackSnapshot(snapshot);
  return snapshot;
}

export function loadStackSnapshot(): StackSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`could not load OAF Stack 0.1 snapshot: ${message}`);
  }

  const snapshot = validateStackSnapshot(parsed);
  // Reparse to return a caller-owned plain-data copy.
  return validateStackSnapshot(JSON.parse(JSON.stringify(snapshot)));
}
