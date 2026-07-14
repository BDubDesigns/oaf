// Helpers for tests that need a mutable copy of the generated-app fixture.
// The checked-in fixture is source material only; tests must never edit it.
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_NAME = "generated-app-fixture";
export const FIXTURE_CREATED_AT = "2000-01-01T00:00:00.000Z";
export const GENERATED_APP_FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "generated-app",
);

// Every retained generated file must match the output of getAppTemplates for
// FIXTURE_NAME/FIXTURE_CREATED_AT, allowing only one added final newline for
// checked-in text-file convention. FIXTURE.md is fixture-only documentation.
/** @type {import("../lib/templates.ts").AppTemplatePath[]} */
export const FIXTURE_TEMPLATE_PATHS = [
  "README.md",
  "package.json",
  "tsconfig.json",
  "oaf/app.json",
  "oaf/stack.json",
  "oaf/docs-pack.json",
  "oaf/doctor.mjs",
  "oaf/receipts/.gitkeep",
  "app/layout.tsx",
  "app/page.tsx",
  "app/api/.gitkeep",
  "components/ui/.gitkeep",
  "components/shared/.gitkeep",
  "features/example-feature/components/.gitkeep",
  "features/example-feature/server/.gitkeep",
  "features/example-feature/schemas.ts",
  "features/example-feature/types.ts",
  "features/example-feature/index.ts",
  "lib/env.ts",
  "lib/result.ts",
  "lib/utils.ts",
  "server/auth/.gitkeep",
  "server/actions/.gitkeep",
  "db/schema/.gitkeep",
  "db/migrations/.gitkeep",
  "db/seed/.gitkeep",
  "db/client.ts",
  "tests/sanity.test.mjs",
  "tests/unit/.gitkeep",
  "tests/integration/.gitkeep",
  "e2e/.gitkeep",
  "public/.gitkeep",
  "docs/app.md",
];

export function copyGeneratedAppFixture() {
  const base = mkdtempSync(join(tmpdir(), "oaf-generated-app-fixture-"));
  const workspace = join(base, "workspace");
  cpSync(GENERATED_APP_FIXTURE, workspace, { recursive: true, force: true });

  return {
    workspace,
    cleanup() {
      rmSync(base, { recursive: true, force: true });
    },
  };
}
