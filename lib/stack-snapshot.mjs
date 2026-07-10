// Loads the authoritative, data-only OAF Stack 0.1 snapshot.
//
// The snapshot is intentionally a fixed known config, not a plugin registry.
// Callers receive a fresh JSON-safe copy so no caller can mutate shared state.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  return isObject(value) && Object.keys(value).length === expected.length && expected.every((key) => key in value);
}

function assertExactVersion(value, label) {
  if (typeof value !== "string" || !EXACT_VERSION.test(value)) {
    throw new Error(`${label} must be an exact stable version`);
  }
}

export function validateStackSnapshot(snapshot) {
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
    if (!hasExactKeys(snapshot[section], keys)) {
      throw new Error(`stack snapshot ${section} section has unknown, missing, or malformed values`);
    }
  }

  for (const [section, keys] of Object.entries(REQUIRED_SECTIONS)) {
    for (const key of keys) {
      if (section === "data" && key === "postgresImage") continue;
      assertExactVersion(snapshot[section][key], `${section}.${key}`);
    }
  }
  if (typeof snapshot.data.postgresImage !== "string" || !POSTGRES_IMAGE.test(snapshot.data.postgresImage)) {
    throw new Error("data.postgresImage must be an exact postgres image tag");
  }
  if (snapshot.framework.react !== snapshot.framework.reactDom) {
    throw new Error("framework.react and framework.reactDom must match exactly");
  }

  return snapshot;
}

export function loadStackSnapshot() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  } catch (error) {
    throw new Error(`could not load OAF Stack 0.1 snapshot: ${error.message}`);
  }

  validateStackSnapshot(parsed);
  // Reparse to return a caller-owned plain-data copy.
  return JSON.parse(JSON.stringify(parsed));
}
